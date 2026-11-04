/**
 * 渲染服务 —— T-1.4，自 demo/index.html 渲染相关代码重构为独立类
 *
 * 职责：渲染器/相机/灯光/PMREM 环境生命周期、组件→InstancedMesh 装载与重建、
 *       精确包围盒取景（InstancedMesh 的 geometry.boundingBox 只是单位球，
 *       必须按原子坐标 + 组件变换求包围盒）、拾取与选择回调、gizmo。
 * 与 demo 的行为对齐点：sRGB 线性化（背景/材质/实例色）、LOD 分档、
 *       pointerup 距离阈值 5px 拾取、gizmo 手柄不参与拾取（tc.axis）、取景系数 2.9。
 * 状态无关：由状态层（T-1.5）调用 rebuild/setVisible 等纯接口。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { trace } from '../crashTrace';
import { measureLabel } from '../core/measures';
import type { Measurement } from '../core/measures';
import { drawMeasurements } from '../ui/measure/draw';
import {
  buildCrystalSurface,
  buildHalloysiteTube,
  buildKaoliniteSheet,
  buildMolecule,
  buildPackedLayers,
  buildParticle,
} from '../core/builders';
import { mineralOf } from '../core/minerals';
import type { Atom, GeometryData } from '../core/geometry';
import type { Annotation, MoleculeParams, SceneComponent, Transform } from '../core/types';
import { drawAnnotations } from '../ui/annotations/draw';
import { createCachedEngine } from '../core/cache';
import {
  createGeometryEngine,
  type GeometryEngine,
  type GeometryRequest,
} from '../core/worker';
import { pngToPdf } from '../export/pdf';
import { encodeTIFF, resolveExportSize } from '../export/tiff';
import { smilesTo3D } from '../core/molecules/smiles';
import { formulaTo3D } from '../core/molecules/formula';
import { parseSdfOrMol } from '../core/molecules/mol';
import { resolveCanonicalFormula } from '../core/molecules/registry';
import type { SceneShape } from '../core/shapes/schema';
import { drawShapes } from '../ui/shapes/draw';
import { shapeViewStore } from '../ui/shapes/view';
import { presetPosition, type CameraPreset } from './postfx';
import { annotationsToSVG, sceneToSVG, shapesToSVG, viewTransformedShape, type SvgAtom, type SvgComponentInput } from '../export/svg';
import { activeColorFor } from './palette';
import { addAtoms, addBonds, recolorAtomMesh } from './instanced';
import { BALL_STICK_BOND_RADIUS, displayRadius } from './visualScale';
import { setActivePalette, type PaletteSetting } from './palette';
import { srgb, substrateMaterial } from './materials';
import { buildSubstrateGeometry } from './substrate';
import { materialFor, outlineMaterial, type RenderMode } from './toon';
import { createHighlightShell, findShell, setSelectionOutlineConfig, type HighlightState } from './highlight';
import { ViewportGrid, type ViewportGridStyle } from './ViewportGrid';
import { applyAppearanceToMaterial, resolveAppearance } from './appearance';
import type { ComponentAppearance } from '../core/types';
import type { SubstrateParams } from '../core/types';

interface ComponentRecord {
  comp: RenderComponent; // store 条目恒带 id（RenderComponent），id 不可缺省
  /** 组件包围盒缓存（T-7.1 BBox 级悬停拾取用）；几何重建时置空 */
  box: THREE.Box3 | null;
  group: THREE.Group;
  data: GeometryData | null;
  atomCount: number;
}

export interface ServiceStats {
  components: number;
  atoms: number;
}

/**
 * 渲染层组件：SceneComponent + 必需 id。
 * 场景文件中的组件 id 可缺省（demo 兼容），载入时经 normalizeScene 补齐后再交给本服务。
 */
export type RenderComponent = SceneComponent & { id: string };

export interface ExportOptions {
  /** 目标 dpi（96/300/600） */
  dpi: number;
  /** 版面宽度（cm），默认 16 */
  widthCM?: number;
  /** 透明底 */
  alpha?: boolean;
  /** 标注层（T-4.4）：位图导出时叠画 */
  annotations?: Annotation[];
  /** 机理图图元层（T-11.5）：位图/SVG 导出时叠画（视口坐标按比例换算） */
  shapes?: SceneShape[];
  /** 键长/键角测量（2026-09-13）：原子引用经 atomWorldPos 解析后叠画 */
  measurements?: Measurement[];
}

/**
 * 3D 视角滚轮缩放灵敏度（OrbitControls.zoomSpeed，默认 1）。
 * 2026-09-13 用户反馈滚轮缩放幅度太大 → 0.5（每次滚动变化约为原来一半）。
 * 仅作用于滚轮/触控板捏合的 dolly 通道；平移、旋转、frameAll 取景不受影响。
 */
const WHEEL_ZOOM_SPEED = 0.5;

/** SVG 导出的原子显示半径基准（与 instanced.ts 同款约定——visualScale.ts 单一事实源） */
function baseRadiusFor(el: string, ballstick: boolean): number {
  return displayRadius(el, ballstick);
}

export class RendererService {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  readonly tc: TransformControls;

  private records = new Map<string, ComponentRecord>();
  /** 吸附候选预览组（2026-09-21）：挂在主 scene 但 raycast 全禁用、导出路径统一隐藏——不参与拾取/LayerPanel/Template/Export */
  private adsorptionPreviewGroup: THREE.Group | null = null;
  /** 素材拖放位置预览组（V2 交互升级）：同上隔离——不进 store/Undo/模板/拾取/导出 */
  private placementPreviewGroup: THREE.Group | null = null;
  /** 三维透视网格（三维工作台升级 P0-A）：编辑辅助元素，导出统一隐藏 */
  private readonly viewportGrid = new ViewportGrid();
  private gridStyleVisible = true;
  /** 场景配置·线框（视觉材质开关，作用于全部可见组件的渲染材质） */
  private wireframeAll = false;
  /** 场景配置·坐标轴（世界原点 AxesHelper；编辑辅助，导出隔离） */
  private readonly axesHelper: THREE.AxesHelper;
  private axesVisible = false;
  /** 场景配置·描边线（选中对象轮廓外壳的外观配置；复用高亮外壳管线） */
  private outlineStyle: { enabled: boolean; color: string; scale: number; glow: number } = {
    enabled: true,
    color: '#e59a20',
    scale: 1.15,
    glow: 0.85,
  };

  /** 测量模式（V2 ViewportToolbar）：true 时无需按 Alt，点击原子即走 onAtomClick 拾取 */
  atomPickNoAlt = false;

  /** 组件的首个原子实例网格（Alt+点击原子等 UI 拾取用；无原子型返回 null） */
  atomMeshOf(compId: string): { userData: { atoms: Atom[] } } | null {
    const rec = this.records.get(compId);
    if (!rec) return null;
    const m = rec.group.children.find((ch) => (ch as { userData: { matKind?: string } }).userData.matKind === 'atom');
    return (m as unknown as { userData: { atoms: Atom[] } }) ?? null;
  }

  /**
   * 测量用原子坐标（2026-09-16 一致性）：atomWorldPos + 可见性——组件隐藏
   * （含纯 2D 模式整体隐藏 sceneVisible=false）返回 null，测量项在屏幕叠加
   * 与导出（PNG/SVG）两侧一致隐藏（测量标注的是原子，原子不可见则标注无意义）。
   */
  measureAtomWorldPos(compId: string, index: number): [number, number, number] | null {
    if (!this.sceneVisible) return null;
    const rec = this.records.get(compId);
    if (!rec?.comp?.visible) return null;
    return this.atomWorldPos(compId, index);
  }

  /**
   * 原子世界坐标（2026-09-13 键长/键角测量）：局部坐标经组件变换（与 SVG 导出同款
   * position·rotation·scale 复合）。组件不存在/越界返回 null（测量项自动失效）。
   */
  atomWorldPos(compId: string, index: number): [number, number, number] | null {
    const rec = this.records.get(compId);
    const a = rec?.data?.atoms[index];
    if (!rec?.data || !a || !rec.comp) return null;
    const t = rec.comp.transform;
    const mtx = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(t.position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler((t.rotation[0] * Math.PI) / 180, (t.rotation[1] * Math.PI) / 180, (t.rotation[2] * Math.PI) / 180),
      ),
      new THREE.Vector3().setScalar(t.scale),
    );
    const v = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(mtx);
    return [v.x, v.y, v.z];
  }
  /** T-11.6：3D 场集体可见性（纯 2D 模式 = false；盖在组件自身 visible 之上） */
  private sceneVisible = true;
  private cifText = '';
  /** 几何生成引擎（T-2.2：默认 Worker 子线程；测试/回退注入同步引擎） */
  private readonly engine: GeometryEngine;
  /** 每组件构建序号：滑块连续拖动时丢弃过期响应（只采纳最后一次请求） */
  private buildTokens = new Map<string, number>();
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private downXY: [number, number] | null = null;
  private selectedId: string | null = null;
  private readonly onDown = (e: PointerEvent): void => this.handleDown(e);
  private readonly onUp = (e: PointerEvent): void => this.handleUp(e);

  /** 画布点击选中回调（null = 点击空白取消；additive = Shift 多选切换，T-7.3） */
  onSelect: ((id: string | null, additive?: boolean) => void) | null = null;
  /**
   * Alt+点击原子回调（2026-09-12）：命中 InstancedMesh 的具体原子实例。
   * 需配合 instanced.addAtoms 写入的 userData.atoms（桶内原子数组，实例 k = arr[k]）。
   */
  onAtomClick: ((compId: string, atom: Atom, index: number) => void) | null = null;
  /** gizmo 拖动结束帧的变换同步回调（T-1.5 状态层接入） */
  onTransformChange: ((id: string) => void) | null = null;

  /**
   * gizmo 吸附（T-7.3）：grid = 平移网格间距（Å，null 关）；angleDeg = 旋转步进（度，null 关）。
   * 直接映射 TransformControls 内置 translationSnap / rotationSnap。
   */
  setSnap(opts: { grid?: number | null; angleDeg?: number | null }): void {
    this.tc.setTranslationSnap(opts.grid ?? null);
    this.tc.setRotationSnap(opts.angleDeg != null ? (opts.angleDeg * Math.PI) / 180 : null);
  }

  /** 视口网格样式（场景 Tab：显隐/主次线颜色/不透明度） */
  setViewportGridStyle(style: ViewportGridStyle): void {
    if (style.visible !== undefined) this.gridStyleVisible = style.visible;
    this.viewportGrid.setStyle(style);
    this.viewportGrid.mesh.visible = this.sceneVisible && this.gridStyleVisible;
  }

  getViewportGridStyle(): Required<Pick<ViewportGridStyle, 'visible' | 'opacity'>> & { minorColor: string; majorColor: string } {
    const st = this.viewportGrid.getStyle();
    return {
      visible: this.gridStyleVisible,
      opacity: st.opacity ?? 0.75,
      minorColor: '#c7ced8',
      majorColor: '#a8b2c0',
    };
  }

  /** 画布背景色（场景 Tab；sRGB 线性化与既有约定一致） */
  setBackgroundColor(hex: string): void {
    this.scene.background = new THREE.Color(hex).convertSRGBToLinear();
  }

  getBackground(): string {
    const bg = this.scene.background;
    if (bg instanceof THREE.Color) return '#' + bg.getHexString();
    return '#f4f5f7';
  }

  /**
   * 场景配置·线框：切换全部可见组件渲染材质的 wireframe（含外观克隆材质，
   * applyComponentAppearance/applyGeometry 重放时保持）。线框是渲染风格开关，
   * 不影响任何科学几何；按用户选择会随导出呈现（属材质外观而非编辑辅助）。
   */
  setWireframeAll(on: boolean): void {
    this.wireframeAll = on;
    for (const rec of this.records.values()) {
      for (const child of rec.group.children) {
        const mesh = child as THREE.Mesh;
        const kind = (mesh.userData?.matKind as string | undefined) ?? '';
        if (kind === 'atom' || kind === 'bond' || kind === 'substrate') {
          (mesh.material as THREE.Material & { wireframe?: boolean }).wireframe = on;
        }
      }
    }
  }

  getWireframeAll(): boolean {
    return this.wireframeAll;
  }

  /** 场景配置·坐标轴（世界原点 AxesHelper；编辑辅助 → 导出隔离清单） */
  setAxesVisible(visible: boolean): void {
    this.axesVisible = visible;
    this.axesHelper.visible = visible;
  }

  getAxesVisible(): boolean {
    return this.axesVisible;
  }

  /**
   * 场景配置·描边线：配置选中对象轮廓外壳（复用高亮外壳管线——InstancedMesh
   * 反转法线外壳，性能与 16k 原子兼容）。enabled=false 隐藏选中描边；
   * 样式变化时重建既有外壳（廉价：仅选中组件一次）。
   */
  setSelectionOutlineStyle(style: Partial<{ enabled: boolean; color: string; scale: number; glow: number }>): void {
    this.outlineStyle = { ...this.outlineStyle, ...style };
    setSelectionOutlineConfig(this.outlineStyle);
    // 重建全部已创建的选中外壳（外壳矩阵在创建时定格 scale）
    for (const rec of this.records.values()) {
      if (!rec.group.userData.highlightsReady) continue;
      const stale = rec.group.children.filter((c) => c.userData.highlight === 'selected');
      for (const c of stale) {
        rec.group.remove(c);
        (c as THREE.InstancedMesh).dispose();
      }
      if (this.selectedId === rec.comp.id) this.setShellState(rec, 'selected');
      else rec.group.userData.highlightsReady = rec.group.children.some((c) => c.userData.highlight);
    }
  }

  getSelectionOutlineStyle() {
    return { ...this.outlineStyle };
  }

  /**
   * 组件外观（材质 Tab）：把 appearance 写入组件记录并对原子/键网格克隆独立材质
   * 套用预设；null / default 恢复共享科研材质（元素色板完整还原）。几何重建
   * （applyGeometry）自动重放；撤销/重做/载入经 binding 同步到同一入口。
   * 不改全局共享 atomMaterial/bondMaterial——组件间外观互相隔离。
   */
  setComponentAppearance(id: string, appearance: ComponentAppearance | null): void {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.comp = { ...rec.comp, appearance: appearance ?? undefined } as RenderComponent;
    if (appearance === null || appearance.preset === 'default') {
      this.applyMode(rec); // 恢复共享材质（含线稿档着装）
      return;
    }
    this.applyComponentAppearance(rec);
  }

  private applyComponentAppearance(rec: ComponentRecord): void {
    const params = rec.comp.appearance;
    if (!params) return;
    const resolved = resolveAppearance(params);
    for (const child of rec.group.children) {
      const mesh = child as THREE.Mesh;
      const kind = (mesh.userData?.matKind as string | undefined) ?? '';
      if (kind !== 'atom' && kind !== 'bond' && kind !== 'substrate') continue;
      // 克隆独立材质（每组件一份；重建时 dispose 由 clearGroup 处理）
      const mat = (mesh.material as THREE.MeshPhysicalMaterial).clone();
      applyAppearanceToMaterial(
        mat as unknown as import('./appearance').MaterialLike,
        resolved,
      );
      if (resolved.colorOverride) mat.color = srgb(new THREE.Color(resolved.colorOverride).getHex());
      mat.wireframe = this.wireframeAll;
      mesh.material = mat;
    }
  }

  getComponentAppearance(id: string): ComponentAppearance | null {
    return this.records.get(id)?.comp.appearance ?? null;
  }

  constructor(private container: HTMLElement, opts?: { engine?: GeometryEngine }) {
    // T-2.9：默认引擎外包缓存层（内容寻址，命中即免 Worker 重建）
    this.engine = opts?.engine ?? createCachedEngine(createGeometryEngine());
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4f5f7).convertSRGBToLinear();

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 6000);
    this.camera.position.set(150, 110, 190);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    // 滚轮 dolly 灵敏度（2026-09-13 用户反馈：默认 1 幅度太大）——
    // 只作用于滚轮/捏合缩放通道，平移旋转与取景操作不受影响
    this.orbit.zoomSpeed = WHEEL_ZOOM_SPEED;

    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.setSize(0.85);
    this.scene.add(this.tc);
    this.scene.add(this.viewportGrid.mesh);
    this.axesHelper = new THREE.AxesHelper(24);
    this.axesHelper.raycast = () => undefined;
    this.axesHelper.visible = false;
    this.scene.add(this.axesHelper);
    this.tc.addEventListener('dragging-changed', (e) => {
      const v = (e as unknown as { value: boolean }).value;
      this.orbit.enabled = !v;
      // 2026-09-12：拖拽中不回写 store（TransformControls 四元数自驱动，无限圈平滑；
      // 此前 objectChange 每帧回写引发：history 双快照深拷贝 + 全组件 diff + 拖拽中
      // applyTransform 竞态 + 编组时欧拉差同步跳变）——松手一次提交 = 一条撤销记录
      if (!v && this.selectedId && this.onTransformChange) this.onTransformChange(this.selectedId);
    });

    // 环境光照：PMREM 室内环境 + 主光/补光（期刊柔和质感，参数对齐 demo）
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch (err) {
      console.warn('环境贴图初始化失败：', err);
    }
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(140, 230, 170);
    this.dirLight = dirLight;
    this.scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.25);
    fillLight.position.set(-170, 90, -130);
    this.scene.add(fillLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));

    this.renderer.domElement.addEventListener('pointerdown', this.onDown);
    this.renderer.domElement.addEventListener('pointerup', this.onUp);

    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    }
    this.startLoop();
  }

  /** 片层/管生成所需的 CIF 文本（nanoparticle/molecule/substrate 不需要） */
  setCifText(text: string): void {
    this.cifText = text;
  }

  /**
   * 视角平移（键盘方向键用）：屏幕像素语义，与鼠标右键拖拽 pan 同速感。
   * 相机与观察目标沿相机 right/up 轴同步移动（OrbitControls.pan 的等价实现）。
   */
  panView(dxPx: number, dyPx: number): void {
    const h = this.renderer.domElement.clientHeight || 1;
    const offset = this.camera.position.clone().sub(this.orbit.target);
    // 换算到目标距离处的视平面尺度（fov 决定像素↔世界距离比例）
    const planeScale = (2 * offset.length() * Math.tan(((this.camera.fov / 2) * Math.PI) / 180)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(dxPx * planeScale).add(up.multiplyScalar(dyPx * planeScale));
    this.camera.position.add(move);
    this.orbit.target.add(move);
  }

  /* ---------- 组件生命周期 ---------- */

  addComponent(comp: RenderComponent): void {
    const group = new THREE.Group();
    group.userData.componentId = comp.id;
    const rec: ComponentRecord = { comp, group, data: null, atomCount: 0, box: null };
    this.records.set(comp.id, rec);
    this.applyTransform(comp, group);
    group.visible = comp.visible && this.sceneVisible;
    this.scene.add(group);
    this.requestBuild(rec, comp);
  }

  /** 参数变化后全量重建该组件（其余组件不触碰；几何经引擎异步生成） */
  rebuildComponent(comp: RenderComponent): void {
    const rec = this.records.get(comp.id);
    if (!rec) return;
    this.clearGroup(rec.group);
    rec.comp = comp;
    rec.data = null;
    rec.atomCount = 0;
    this.applyTransform(comp, rec.group);
    rec.group.visible = comp.visible && this.sceneVisible;
    this.requestBuild(rec, comp);
  }

  removeComponent(id: string): void {
    const rec = this.records.get(id);
    if (!rec) return;
    this.buildTokens.set(id, (this.buildTokens.get(id) ?? 0) + 1); // 使在途构建作废
    this.clearGroup(rec.group);
    this.scene.remove(rec.group);
    this.records.delete(id);
    this.lastRotationRead.delete(id);
    if (this.selectedId === id) this.setSelection(null);
  }

  setComponentVisible(id: string, visible: boolean): void {
    const rec = this.records.get(id);
    if (rec) rec.group.visible = visible && this.sceneVisible;
  }

  /**
   * T-11.6 纯 2D 示意图模式：3D 场景整体显隐（纯渲染层开关，不动 store 数据——
   * 切回混合形态即恢复）。隐藏时同时禁用 OrbitControls/拾取交互（事件留给图元层）。
   */
  setSceneVisible(visible: boolean): void {
    this.sceneVisible = visible;
    for (const rec of this.records.values()) {
      rec.group.visible = rec.comp.visible && visible;
    }
    this.viewportGrid.mesh.visible = visible && this.gridStyleVisible;
    this.orbit.enabled = visible;
    this.scene.background = visible
      ? new THREE.Color(0xf4f5f7).convertSRGBToLinear()
      : new THREE.Color(0xffffff).convertSRGBToLinear();
  }

  /** 仅更新变换（位置/旋转/缩放），不重建几何（gizmo 拖动与状态层同步用） */
  setComponentTransform(id: string, transform: RenderComponent['transform']): void {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.comp = { ...rec.comp, transform };
    this.applyTransform(rec.comp, rec.group);
  }

  setSelection(id: string | null): void {
    const prev = this.selectedId;
    this.selectedId = id;
    const rec = id ? this.records.get(id) : null;
    if (rec && rec.comp.visible) this.tc.attach(rec.group);
    else this.tc.detach();
    // T-7.1 选中外壳（与 gizmo 互补的轮廓高亮）
    if (prev && prev !== id) {
      const prevRec = this.records.get(prev);
      if (prevRec) this.setShellState(prevRec, 'none');
    }
    if (rec) this.setShellState(rec, 'selected');
  }

  /* ---------- 拾取高亮 / 悬停反馈（T-7.1） ---------- */

  private hoverId: string | null = null;

  /* ---------- 接触阴影与构图预设（T-4.3） ---------- */

  private readonly dirLight: THREE.DirectionalLight;
  /** 接影地板（ShadowMaterial：只显示阴影，本体透明） */
  private shadowGround: THREE.Mesh | null = null;
  private shadowsOn = false;

  /**
   * 廉价接触阴影开关（T-4.3）：方向光 shadow map（PCFSoft）+ ShadowMaterial 地板。
   * 地板贴着场景最低点略下；开销 = 每帧一次深度绘制（与主渲染同量级，60fps 达标）。
   */
  setShadows(on: boolean): void {
    this.shadowsOn = on;
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.dirLight.castShadow = on;
    if (on) {
      this.dirLight.shadow.mapSize.set(2048, 2048);
      const sc = this.dirLight.shadow.camera;
      sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260;
      sc.near = 10; sc.far = 1200;
      sc.updateProjectionMatrix();
      if (!this.shadowGround) {
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(4000, 4000),
          new THREE.ShadowMaterial({ opacity: 0.22 }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.shadowGround = ground;
        this.scene.add(ground);
      }
      // 地板贴场景最低点略下（含组件变换）
      this.scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const rec of this.records.values()) if (rec.comp.visible) this.compBox(rec, box);
      this.shadowGround.position.y = box.isEmpty() ? 0 : box.min.y - 0.8;
      this.shadowGround.visible = true;
    } else if (this.shadowGround) {
      this.shadowGround.visible = false;
    }
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData?.matKind !== 'substrate') {
        (o as THREE.Mesh).castShadow = on;
      }
    });
    // 运行时开关 shadowMap 需要材质重编译
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  getShadows(): boolean {
    return this.shadowsOn;
  }

  /** 构图预设：等距/正视/俯视/复位——保持视距只转方位（T-4.3） */
  setCameraPreset(preset: CameraPreset): void {
    const target = this.orbit.target;
    const distance = this.camera.position.distanceTo(target);
    const [x, y, z] = presetPosition(preset, [target.x, target.y, target.z], distance);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(target);
    this.orbit.update();
  }

  /** 水平线吸附：相机降到与目标同高（视线水平 → 地平线水平），保持水平方位与视距 */
  snapHorizon(): void {
    const target = this.orbit.target;
    const p = this.camera.position;
    const dist = p.distanceTo(target);
    const hx = p.x - target.x;
    const hz = p.z - target.z;
    const hl = Math.hypot(hx, hz) || 1e-6;
    const scale = dist / hl;
    this.camera.position.set(target.x + hx * scale, target.y, target.z + hz * scale);
    this.camera.lookAt(target);
    this.orbit.update();
  }

  /** 设置悬停组件（hoverStore 驱动； null 清除）。帧率无感：外壳可见性切换，O(1) */
  setHover(id: string | null): void {
    if (id === this.hoverId) return;
    if (this.hoverId) {
      const prevRec = this.records.get(this.hoverId);
      if (prevRec) this.setShellState(prevRec, this.hoverId === this.selectedId ? 'selected' : 'none');
    }
    this.hoverId = id;
    if (id) {
      const rec = this.records.get(id);
      // 选中态优先：悬停在已选中组件上保持选中色
      if (rec && id !== this.selectedId) this.setShellState(rec, 'hover');
    }
  }

  /** 组件外壳状态（none/hover/selected）：外壳缺失时惰性创建 */
  private setShellState(rec: ComponentRecord, state: HighlightState): void {
    this.ensureHighlightShells(rec);
    const hover = findShell(rec.group, 'hover');
    const select = findShell(rec.group, 'selected');
    if (hover) hover.visible = state === 'hover';
    // 场景配置·描边线关闭时，选中外壳一并隐藏（仅剩 gizmo 反馈）
    if (select) select.visible = state === 'selected' && this.outlineStyle.enabled;
  }

  private ensureHighlightShells(rec: ComponentRecord): void {
    if (rec.group.userData.highlightsReady) return;
    rec.group.userData.highlightsReady = true;
    for (const child of [...rec.group.children]) {
      if (child.userData.matKind !== 'atom') continue;
      rec.group.add(createHighlightShell(child as THREE.InstancedMesh, 'hover'));
      rec.group.add(createHighlightShell(child as THREE.InstancedMesh, 'selected'));
    }
  }

  /**
   * BBox 级轻量拾取（悬停用，T-7.1）：对每个可见组件的缓存包围盒做 ray-intersect，
   * 最近者胜。相比全量实例 raycast（16k 实例毫秒级×每帧），成本 O(组件数)。
   * 精度到组件包围盒级——悬停反馈足够；点击选中仍走全量拾取。
   */
  pickAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    let best: { id: string; dist: number } | null = null;
    const pt = new THREE.Vector3();
    for (const rec of this.records.values()) {
      if (!rec.group.visible || !rec.comp.visible) continue;
      // compBox 逐原子计算（setFromObject 不含实例矩阵）；外扩 1Å 作悬停余量
      if (!rec.box) rec.box = this.compBox(rec, new THREE.Box3()).expandByScalar(1);
      if (!raycaster.ray.intersectBox(rec.box, pt)) continue;
      const dist = pt.distanceTo(raycaster.ray.origin);
      if (!best || dist < best.dist) best = { id: rec.comp.id, dist };
    }
    return best?.id ?? null;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  /** gizmo 模式切换（ViewportToolbar G/E/S 与 ParamPanel 共用）；scale 档仅保留中央手柄 = 等比缩放（schema 统一 scale 红线） */
  setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.tc.setMode(mode);
    const perAxis = mode !== 'scale';
    this.tc.showX = perAxis;
    this.tc.showY = perAxis;
    this.tc.showZ = perAxis;
  }

  /** 读取组件当前变换（gizmo 拖动后由状态层回写 store） */
  /** 各组件上次回读的旋转角（度）——unwrap 连续化基准（2026-09-12） */
  private lastRotationRead = new Map<string, [number, number, number]>();

  /**
   * 回读组件变换。旋转角做连续化 unwrap：THREE 的欧拉分解恒在 ±180° 内，
   * 拖多圈后数值会回卷（3 圈后显示 0° 而非 1080°）——加 360k 取最接近上次
   * 回读值，使 store/面板呈现累积角度（姿态数值等价，仅表示连续）。
   */
  getComponentTransform(id: string): Transform | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    const g = rec.group;
    const d = 180 / Math.PI;
    const prev = this.lastRotationRead.get(id);
    const raw: [number, number, number] = [g.rotation.x * d, g.rotation.y * d, g.rotation.z * d];
    const rotation = raw.map((v, i) => {
      if (!prev) return v;
      // 最近邻回卷：|v + 360k − prev[i]| 最小的 k
      return v + Math.round((prev[i]! - v) / 360) * 360;
    }) as [number, number, number];
    this.lastRotationRead.set(id, rotation);
    return {
      position: [g.position.x, g.position.y, g.position.z],
      rotation,
      scale: g.scale.x,
    };
  }

  /** 组件原子数（图层面板显示用） */
  atomCountOf(id: string): number {
    return this.records.get(id)?.atomCount ?? 0;
  }

  /* ---------- 导出（T-1.7，逻辑对齐 demo exportPNG） ---------- */

  /**
   * 组件缩略图快照（模块库入库用，T-2.3）：
   * 临时隐藏其他组件与 gizmo → 渲染一帧 → 离屏画布缩放绘制 → 恢复现场。
   */
  snapshotComponent(id: string, width = 150, height = 110): string {
    return this.withEditorHelpersHidden(() => {
    const rec = this.records.get(id);
    if (!rec) return '';
    const prevVisibility: Array<[string, boolean]> = [];
    for (const [k, r] of this.records) {
      prevVisibility.push([k, r.group.visible]);
      r.group.visible = k === id && r.comp.visible;
    }
    const tcVisible = this.tc.visible;
    this.tc.visible = false;
    this.renderer.render(this.scene, this.camera);
    const oc = document.createElement('canvas');
    oc.width = width;
    oc.height = height;
    const ctx = oc.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#F4F5F7';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(this.renderer.domElement, 0, 0, width, height);
    }
    this.tc.visible = tcVisible;
    for (const [k, v] of prevVisibility) {
      const r = this.records.get(k);
      if (r) r.group.visible = v;
    }
    return oc.toDataURL('image/jpeg', 0.8);
    });
  }

  /**
   * 整景缩略图快照（组合模块入库用，T-3.1）：
   * 只隐藏 gizmo，保留所有组件当前可见性 → 渲染一帧 → 离屏画布缩放绘制。
   */
  snapshotScene(width = 150, height = 110): string {
    return this.withEditorHelpersHidden(() => {
    const tcVisible = this.tc.visible;
    this.tc.visible = false;
    this.renderer.render(this.scene, this.camera);
    const oc = document.createElement('canvas');
    oc.width = width;
    oc.height = height;
    const ctx = oc.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#F4F5F7';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(this.renderer.domElement, 0, 0, width, height);
    }
    this.tc.visible = tcVisible;
    return oc.toDataURL('image/jpeg', 0.8);
    });
  }

  /**
   * 统一模板整景缩略图（2026-09-17）：复用 snapshotWithOverlay 合成管线
   * （3D 当前帧 + 图元 + 标注叠加），模块卡片同规格（150×110 / jpeg 0.8）。
   * 直接取当前已渲染帧 → 缩略图视角 ≡ 保存视角 ≡ 恢复视角（禁止 frameAll 类取景）。
   */
  snapshotTemplate(width = 150, height = 110, shapes?: SceneShape[], annotations?: Annotation[]): string {
    // 模板缩略图不含未 Apply 吸附候选：隐藏预览渲一帧后再合成
    return this.withEditorHelpersHidden(() => {
      this.renderer.render(this.scene, this.camera);
      return this.snapshotWithOverlay(width, height, annotations ?? [], shapes).toDataURL('image/jpeg', 0.8);
    });
  }

  /**
   * 世界坐标 → 屏幕像素（当前渲染尺寸），含视锥外/相机后方剔除。
   * 交互叠加与导出合成共用（导出时以离屏 W/H 调用 → 位置一致，T-4.4）。
   */
  projectToScreen(p: [number, number, number], W: number, H: number): { x: number; y: number; visible: boolean } {
    // 投影链：world → view（matrixWorldInverse）→ clip（projectionMatrix）→ NDC。
    // 注意 projectionMatrix 必须作用于视空间坐标（作用于世界坐标是无效链路）。
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    const view = v.applyMatrix4(this.camera.matrixWorldInverse);
    const dist = -view.z;
    if (dist < this.camera.near) return { x: 0, y: 0, visible: false };
    const ndc = view.applyMatrix4(this.camera.projectionMatrix);
    if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1)
      return { x: 0, y: 0, visible: false };
    return {
      x: ((ndc.x + 1) / 2) * W,
      y: ((1 - ndc.y) / 2) * H,
      visible: true,
    };
  }

  /** 吸附候选预览：重建预览组（正常结构 + 略透明标识预览；不改变科学坐标） */
  setAdsorptionPreview(atoms: import('../core/geometry').Atom[], bonds: import('../core/geometry').Bond[]): void {
    this.clearAdsorptionPreview();
    const g = new THREE.Group();
    g.userData.adsorptionPreview = true;
    addAtoms(g, atoms, true); // 预览恒球棍（原子可辨、键清晰）
    addBonds(g, atoms, bonds, BALL_STICK_BOND_RADIUS);
    g.traverse((o) => {
      o.raycast = () => undefined; // 预览不参与拾取
      const mesh = o as THREE.Mesh;
      if (mesh.material) {
        const m = (mesh.material as THREE.Material).clone();
        m.transparent = true;
        m.opacity = 0.75; // 轻透明 = 预览标识（未 Apply）
        mesh.material = m;
      }
    });
    this.scene.add(g);
    this.adsorptionPreviewGroup = g;
  }

  /* ---------- 素材拖放位置预览（V2 交互升级：P1 直接操作工作流） ---------- */

  /** 用组件同款引擎预构建几何（内容寻址缓存命中即免重算；不产生场景组件、不进 Undo） */
  previewGeometry(req: GeometryRequest): Promise<GeometryData | null> {
    return this.engine.build(req).catch(() => null);
  }

  /** 构建拖放预览（半透明、raycast 全禁用；不进 records → 天然不参与拾取/取景/统计/导出）。scale = 落地组件的默认缩放（分子 4 等），保证预览尺寸 ≡ 放置后 */
  setPlacementPreview(atoms: Atom[], bonds: import('../core/geometry').Bond[], scale = 1): void {
    this.clearPlacementPreview();
    const g = new THREE.Group();
    g.userData.placementPreview = true;
    addAtoms(g, atoms, true); // 预览恒球棍（与吸附候选预览同约定：原子可辨）
    addBonds(g, atoms, bonds, BALL_STICK_BOND_RADIUS);
    g.scale.setScalar(scale);
    g.traverse((o) => {
      o.raycast = () => undefined;
      const mesh = o as THREE.Mesh;
      if (mesh.material) {
        const m = (mesh.material as THREE.Material).clone();
        m.transparent = true;
        m.opacity = 0.5;
        mesh.material = m;
      }
    });
    g.visible = false; // 首次 movePlacementPreview 命中画布后再显示
    this.scene.add(g);
    this.placementPreviewGroup = g;
  }

  movePlacementPreview(worldPos: [number, number, number]): void {
    const g = this.placementPreviewGroup;
    if (!g) return;
    g.position.set(worldPos[0], worldPos[1], worldPos[2]);
    g.visible = true;
  }

  /** 隐藏预览本体（指针拖出画布区间；拖拽会话继续） */
  hidePlacementPreview(): void {
    if (this.placementPreviewGroup) this.placementPreviewGroup.visible = false;
  }

  clearPlacementPreview(): void {
    if (!this.placementPreviewGroup) return;
    this.scene.remove(this.placementPreviewGroup);
    this.placementPreviewGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.placementPreviewGroup = null;
  }

  /**
   * 拖放置换点：优先命中最近可见组件表面（直接落在已有结构上，与"拖近即贴合"工作流衔接）；
   * 未命中 → 与视线垂直、过 orbit.target 的工作平面交点（可预测回退，不把所有模型丢向世界原点）。
   */
  pickPlacementPoint(clientX: number, clientY: number): [number, number, number] | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.records.values()]
      .filter((r) => r.group.visible && r.comp.visible)
      .map((r) => r.group);
    if (targets.length) {
      const hits = raycaster.intersectObjects(targets, true);
      if (hits.length) return [hits[0].point.x, hits[0].point.y, hits[0].point.z];
    }
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.orbit.target);
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, pt) ? [pt.x, pt.y, pt.z] : null;
  }

  clearAdsorptionPreview(): void {
    if (!this.adsorptionPreviewGroup) return;
    this.scene.remove(this.adsorptionPreviewGroup);
    this.adsorptionPreviewGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.adsorptionPreviewGroup = null;
  }

  /**
   * 编辑辅助元素统一隔离（三维工作台升级 P0-A）：
   * gizmo / 透视网格 / 选中·悬停高亮外壳 / 吸附候选 / 拖放置换预览——
   * 全部不进正式科研导出与缩略图；try/finally 恢复前后场景状态逐位一致。
   * 测量标注/科研图元/原子键不在此列（按用户选择正常导出）。
   */
  private withEditorHelpersHidden<T>(fn: () => T): T {
    const saved = this.collectEditorHelpers();
    for (const h of saved) h.o.visible = false;
    try {
      return fn();
    } finally {
      for (let i = saved.length - 1; i >= 0; i--) saved[i]!.o.visible = saved[i]!.v;
    }
  }

  /** 组件科学元数据（crystal_surface 结构信息 UI / 吸附失效校验用；records.data.meta） */
  getGeometryMeta(compId: string): import('../core/geometry').ScientificGeometryMeta | Record<string, number> | null {
    return this.records.get(compId)?.data?.meta ?? null;
  }

  /** 组件几何只读访问（吸附候选生成比对 surface 现状） */
  getComponentGeometry(compId: string): GeometryData | null {
    return this.records.get(compId)?.data ?? null;
  }

  /** 目标点处每 Å 像素数（比例尺刻度换算） */
  pxPerAAtTarget(H: number): number {
    const dist = this.camera.position.distanceTo(this.orbit.target);
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    return H / 2 / (Math.max(dist, 1e-3) * tanHalf);
  }

  /** 离屏渲染帧 + 标注/图元叠画 → 2D 画布（PNG/TIFF/PDF 共用；annotations/shapes 可选） */
  snapshotWithOverlay(w: number, h: number, annotations: Annotation[], shapes?: SceneShape[], measurements?: Measurement[]): HTMLCanvasElement {
    const oc = document.createElement('canvas');
    oc.width = w;
    oc.height = h;
    const ctx = oc.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布');
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
    if (annotations.length) {
      drawAnnotations({
        ctx,
        width: w,
        height: h,
        annotations,
        project: (p) => this.projectToScreen(p, w, h),
        pxPerAAtTarget: this.pxPerAAtTarget(h),
      });
    }
    // T-11.5 图元层：图元坐标 = 视口逻辑像素 → 按导出/视口比例放大；
    // component 锚定投影在离屏坐标下解析后除以 scale 折回视口坐标系，保持一致。
    // T-11.6 纯示意图模式：叠加 view 变换（zoom/pan），导出 = 所见
    if (shapes?.length) {
      const vw = this.container.clientWidth || 1;
      const vh = this.container.clientHeight || 1;
      const scale = w / vw;
      const v = shapeViewStore.getState();
      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(v.panX, v.panY);
      ctx.scale(v.zoom, v.zoom);
      drawShapes({
        ctx,
        width: vw,
        height: vh,
        shapes,
        components: [...this.records.values()].map((r) => r.comp),
        project: (p) => {
          const r = this.projectToScreen(p, w, h);
          return { x: r.x / scale, y: r.y / scale, visible: r.visible };
        },
      });
      ctx.restore();
    }
    // 键长/键角测量层（2026-09-13）：直接投影到导出坐标（与标注同链路）
    if (measurements?.length) {
      drawMeasurements({
        ctx,
        width: w,
        height: h,
        project: (p) => this.projectToScreen(p, w, h),
        resolve: (ref) => this.measureAtomWorldPos(ref.compId, ref.index),
        picks: [],
        measurements,
      });
    }
    return oc;
  }

  /**
   * 高分辨率 PNG 导出：px = cm × dpi / 2.54（16cm@300dpi → 1890px 宽）。
   * 离屏改尺寸渲染一帧 → 叠加标注 → toDataURL → 恢复原尺寸。返回尺寸供 UI 提示。
   */
  exportPNG(opts: ExportOptions): { dataUrl: string; width: number; height: number } {
    const { w, h } = resolveExportSize(
      opts.dpi,
      opts.widthCM ?? 16,
      this.container.clientWidth,
      this.container.clientHeight,
      this.renderer.capabilities.maxTextureSize,
    );
    const st = this.beginOffscreen(w, h, opts.alpha ?? false);
    try {
      const canvas = this.snapshotWithOverlay(w, h, opts.annotations ?? [], opts.shapes, opts.measurements);
      return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
    } finally {
      this.endOffscreen(st);
    }
  }

  /**
   * 高分辨率 TIFF 导出（T-5.1，期刊 300dpi+ 硬要求）：
   * 离屏渲染 → 2D 画布取像素（drawImage 自动处理 WebGL 上下翻转）→ 无压缩编码，
   * dpi 写入物理分辨率标签，透明底保留 alpha。超设备纹理上限自动按比例降级。
   */
  exportTIFF(opts: ExportOptions): {
    blob: Blob;
    width: number;
    height: number;
    degraded: boolean;
    effectiveDpi: number;
  } {
    const plan = resolveExportSize(
      opts.dpi,
      opts.widthCM ?? 16,
      this.container.clientWidth,
      this.container.clientHeight,
      this.renderer.capabilities.maxTextureSize,
    );
    const st = this.beginOffscreen(plan.w, plan.h, opts.alpha ?? false);
    try {
      const oc = this.snapshotWithOverlay(plan.w, plan.h, opts.annotations ?? [], opts.shapes, opts.measurements);
      const ctx = oc.getContext('2d');
      if (!ctx) throw new Error('无法创建 2D 画布（TIFF 导出）');
      const img = ctx.getImageData(0, 0, plan.w, plan.h);
      const buf = encodeTIFF(new Uint8Array(img.data), plan.w, plan.h, plan.effectiveDpi);
      return {
        blob: new Blob([buf], { type: 'image/tiff' }),
        width: plan.w,
        height: plan.h,
        degraded: plan.degraded,
        effectiveDpi: plan.effectiveDpi,
      };
    } finally {
      this.endOffscreen(st);
    }
  }

  stats(): ServiceStats {
    let atoms = 0;
    for (const rec of this.records.values()) atoms += rec.atomCount;
    return { components: this.records.size, atoms };
  }

  /* ---------- 取景 ---------- */

  frameComponent(id: string): void {
    const rec = this.records.get(id);
    if (rec) this.frameBox(this.compBox(rec, new THREE.Box3()));
  }

  frameAll(): void {
    const box = new THREE.Box3();
    for (const rec of this.records.values()) this.compBox(rec, box);
    box.expandByScalar(2.5);
    this.frameBox(box);
  }

  /* ---------- 生命周期 ---------- */

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.engine.dispose(); // 终止几何 Worker（同步引擎为空操作）
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onUp);
    this.orbit.dispose();
    this.tc.dispose();
    this.clearPlacementPreview();
    this.viewportGrid.dispose();
    this.axesHelper.dispose();
    for (const rec of this.records.values()) this.clearGroup(rec.group);
    this.records.clear();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  /**
   * 分组 SVG 矢量导出（T-5.3）：从原子/键数据直接生成（线稿档画风，平色+描边），
   * 每组件 <g id="组件名">。原子/键世界坐标 = 局部坐标经组件变换（含缩放半径）。
   */
  exportSVG(opts?: { background?: string; strokeWidth?: number; annotations?: Annotation[]; shapes?: SceneShape[]; measurements?: Measurement[] }): string {
    this.scene.updateMatrixWorld(true);
    const size = this.renderer.getSize(new THREE.Vector2());
    const comps: SvgComponentInput[] = [];
    for (const rec of this.records.values()) {
      const comp = rec.comp;
      const data = rec.data;
      if (!comp.visible || !data) continue;
      const mtx = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(comp.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (comp.transform.rotation[0] * Math.PI) / 180,
            (comp.transform.rotation[1] * Math.PI) / 180,
            (comp.transform.rotation[2] * Math.PI) / 180,
          ),
        ),
        new THREE.Vector3().setScalar(comp.transform.scale),
      );
      const ballstick = ((comp.params as { style?: string }).style ?? '球棍') === '球棍'; // SVG 与 3D 同款判定（含 molecule）
      const atoms: SvgAtom[] = data.atoms.map((a) => {
        const v = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(mtx);
        // 半径：颗粒自带晶粒 r；其余按显示基准（空间填充 vdw×0.92 / 球棍 cov×0.95）；世界半径含组件缩放
        const worldR =
          (a.r !== undefined ? a.r : baseRadiusFor(a.el, ballstick)) * comp.transform.scale;
        return { el: a.el, x: v.x, y: v.y, z: v.z, r: worldR };
      });
      comps.push({
        name: comp.name,
        visible: comp.visible,
        atoms,
        bonds: ballstick ? data.bonds : [], // 空间填充不画键（与 3D 渲染一致）
        bondRadius: BALL_STICK_BOND_RADIUS * comp.transform.scale, // 线稿 SVG 与 3D 同源（visualScale）
        bondColor: '#8f959c',
      });
    }
    const svgBody = sceneToSVG(comps, this.camera, {
      width: size.x,
      height: size.y,
      background: opts?.background,
      strokeWidth: opts?.strokeWidth,
      elementColors: this.elementsInScene().reduce<Record<string, string>>((acc, el) => {
        acc[el] = activeColorFor(el);
        return acc;
      }, {}),
      fallbackColor: '#9AA0A6',
    });
    const annotations = opts?.annotations ?? [];
    let extra = '';
    if (annotations.length) {
      extra += annotationsToSVG({
        width: size.x,
        height: size.y,
        annotations,
        pxPerA: this.pxPerAAtTarget(size.y),
        project: (p) => this.projectToScreen(p, size.x, size.y),
      });
    }
    // T-11.5 图元层（视口坐标 × scale = 导出坐标；T-11.6 示意图模式先叠 view 变换再导出）
    const shapes = opts?.shapes ?? [];
    if (shapes.length) {
      const vw = this.container.clientWidth || 1;
      const v = shapeViewStore.getState();
      const vshapes = v.zoom !== 1 || v.panX !== 0 || v.panY !== 0
        ? shapes.map((s) => viewTransformedShape(s, v.zoom, v.panX, v.panY))
        : shapes;
      extra += (extra ? '\n' : '') + shapesToSVG({
        width: size.x,
        height: size.y,
        scale: size.x / vw,
        shapes: vshapes,
        components: [...this.records.values()].map((r) => r.comp),
        project: (p) => this.projectToScreen(p, size.x, size.y),
      });
    }
    // 键长/键角测量层（2026-09-13）：与标注同投影，矢量输出
    const measurements = opts?.measurements ?? [];
    if (measurements.length) {
      const parts: string[] = ['<g id="measurements" stroke="#0e7490" stroke-width="1.6" fill="none">'];
      const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
      for (const m of measurements) {
        const pts = m.picks.map((r) => this.measureAtomWorldPos(r.compId, r.index)); // 可见性一致（隐藏组件/2D 模式不导出）
        if (pts.some((p) => !p)) continue;
        const scr = pts.map((p) => this.projectToScreen(p!, size.x, size.y));
        if (scr.some((p) => !p.visible)) continue;
        const [s0, s1, s2] = scr;
        if (m.kind === 'bond' && s0 && s1) {
          parts.push(`<line x1="${fmt(s0.x)}" y1="${fmt(s0.y)}" x2="${fmt(s1.x)}" y2="${fmt(s1.y)}"/>`);
          parts.push(this.measureBadgeSVG((s0.x + s1.x) / 2, (s0.y + s1.y) / 2 - 12, measureLabel('bond', [pts[0]!, pts[1]!])));
        } else if (m.kind === 'angle' && s0 && s1 && s2) {
          parts.push(`<polyline points="${fmt(s0.x)},${fmt(s0.y)} ${fmt(s1.x)},${fmt(s1.y)} ${fmt(s2.x)},${fmt(s2.y)}" fill="none"/>`);
          const a1 = Math.atan2(s0.y - s1.y, s0.x - s1.x);
          const a2d = Math.atan2(s2.y - s1.y, s2.x - s1.x);
          const large = 0;
          const sweep = a2d > a1 ? 1 : 0;
          parts.push(`<path d="M ${fmt(s1.x + 14 * Math.cos(a1))} ${fmt(s1.y + 14 * Math.sin(a1))} A 14 14 0 ${large} ${sweep} ${fmt(s1.x + 14 * Math.cos(a2d))} ${fmt(s1.y + 14 * Math.sin(a2d))}"/>`);
          const mid = (a1 + a2d) / 2 + (Math.abs(a2d - a1) > Math.PI ? Math.PI : 0);
          parts.push(this.measureBadgeSVG(s1.x + Math.cos(mid) * 34, s1.y + Math.sin(mid) * 34, measureLabel('angle', [pts[0]!, pts[1]!, pts[2]!])));
        }
      }
      parts.push('</g>');
      extra += (extra ? '\n' : '') + parts.join('\n');
    }
    if (!extra) return svgBody;
    return svgBody.replace('</svg>', `${extra}\n</svg>`);
  }

  /** 测量标签徽章（白底圆角 + 深色文字；SVG 与画布版视觉一致） */
  private measureBadgeSVG(x: number, y: number, text: string): string {
    const w = text.length * 7.2 + 10;
    return `<g><rect x="${(x - w / 2).toFixed(1)}" y="${(y - 9).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="4" fill="rgba(255,255,255,0.92)" stroke="#0e7490" stroke-width="1"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#0f172a" stroke="none">${text}</text></g>`;
  }

  /**
   * 单层隔离 PNG（T-5.4 分层导出的基础）：只渲染指定组件（其他组件与 gizmo 隐藏），
   * 透明底 RGBA。分辨率公式与 exportPNG 一致（含 maxTextureSize 降级）。
   */
  exportComponentPNG(
    id: string,
    opts: ExportOptions,
  ): { dataUrl: string; width: number; height: number } | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    const plan = resolveExportSize(
      opts.dpi,
      opts.widthCM ?? 16,
      this.container.clientWidth,
      this.container.clientHeight,
      this.renderer.capabilities.maxTextureSize,
    );
    // 隐藏其他组件（编辑辅助由 beginOffscreen 统一隔离）
    const prevVis: Array<[string, boolean]> = [];
    for (const [k, r] of this.records) {
      prevVis.push([k, r.group.visible]);
      r.group.visible = k === id && r.comp.visible;
    }
    const st = this.beginOffscreen(plan.w, plan.h, true); // 透明底
    try {
      const dataUrl = this.renderer.domElement.toDataURL('image/png');
      return { dataUrl, width: plan.w, height: plan.h };
    } finally {
      this.endOffscreen(st);
      for (const [k, v] of prevVis) {
        const r = this.records.get(k);
        if (r) r.group.visible = v;
      }
    }
  }

  /** 可见组件按深度排序（远→近，画家序）：分层 PNG 叠放顺序的依据 */
  visibleLayersByDepth(): Array<{ id: string; name: string }> {
    this.scene.updateMatrixWorld(true);
    const viewInv = this.camera.matrixWorldInverse;
    const pos = new THREE.Vector3();
    const layers = [] as Array<{ id: string; name: string; depth: number }>;
    for (const rec of this.records.values()) {
      if (!rec.comp.visible) continue;
      rec.group.getWorldPosition(pos);
      pos.applyMatrix4(viewInv);
      layers.push({ id: rec.comp.id, name: rec.comp.name, depth: pos.z });
    }
    return layers
      .sort((a, b) => a.depth - b.depth) // 视空间 z 越小越远
      .map(({ id, name }) => ({ id, name }));
  }

  /** 读取组件当前参数（动画帧间以新 progress 重建用） */
  getComponent(id: string): RenderComponent | null {
    return this.records.get(id)?.comp ?? null;
  }

  /**
   * 单层隔离渲染画布（T-10.1 动画帧用）：只渲染指定组件（其他组件与 gizmo 隐藏），
   * 离屏 2D 画布（含标注叠画）。分辨率公式与 exportPNG 一致。
   */
  exportComponentCanvas(id: string, opts: ExportOptions): HTMLCanvasElement | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    const plan = resolveExportSize(
      opts.dpi,
      opts.widthCM ?? 16,
      this.container.clientWidth,
      this.container.clientHeight,
      this.renderer.capabilities.maxTextureSize,
    );
    const prevVis: Array<[string, boolean]> = [];
    for (const [k, r] of this.records) {
      prevVis.push([k, r.group.visible]);
      r.group.visible = k === id && r.comp.visible;
    }
    const tcVisible = this.tc.visible;
    this.tc.visible = false;
    const st = this.beginOffscreen(plan.w, plan.h, false);
    try {
      return this.snapshotWithOverlay(plan.w, plan.h, opts.annotations ?? [], undefined, opts.measurements);
    } finally {
      this.endOffscreen(st);
      this.tc.visible = tcVisible;
      for (const [k, v] of prevVis) {
        const r = this.records.get(k);
        if (r) r.group.visible = v;
      }
    }
  }

  /** 等待指定组件几何构建落地（applyGeometry 派发的 kaolin-geometry-updated 事件） */
  waitForGeometry(id: string, timeoutMs = 8000): Promise<void> {
    return new Promise((res) => {
      const h = (e: Event): void => {
        if ((e as CustomEvent).detail?.id === id) {
          cleanup();
          res();
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        res();
      }, timeoutMs);
      const cleanup = (): void => {
        window.removeEventListener('kaolin-geometry-updated', h);
        clearTimeout(timer);
      };
      window.addEventListener('kaolin-geometry-updated', h);
    });
  }

  /**
   * PDF 导出（T-5.2，先位图版）：离屏渲染 → PNG dataURL → jsPDF 按物理尺寸满幅嵌入。
   * 页面尺寸 = 设定 cm 数；有效分辨率 = 位图 dpi。
   */
  exportPDF(opts: ExportOptions): { blob: Blob; widthCM: number; heightCM: number } {
    const wCM = opts.widthCM ?? 16;
    const { w, h } = resolveExportSize(
      opts.dpi,
      wCM,
      this.container.clientWidth,
      this.container.clientHeight,
      this.renderer.capabilities.maxTextureSize,
    );
    const hCM = (wCM * h) / w;
    const st = this.beginOffscreen(w, h, opts.alpha ?? false);
    try {
      const dataUrl = this.snapshotWithOverlay(w, h, opts.annotations ?? [], opts.shapes, opts.measurements).toDataURL('image/png');
      return { blob: pngToPdf(dataUrl, wCM, hCM), widthCM: wCM, heightCM: hCM };
    } finally {
      this.endOffscreen(st);
    }
  }

  /* ---------- 色板（T-4.2） ---------- */

  /** 更新全局色板并对既有原子网格重着色（不重建几何；新组件经 activeColorFor 即刻着色） */
  setPalette(p: PaletteSetting): void {
    setActivePalette(p);
    this.scene.traverse((o) => {
      if (o.userData?.matKind === 'atom') recolorAtomMesh(o as THREE.InstancedMesh);
    });
  }

  /** 场景中出现的元素集合（逐元素取色器 UI 用） */
  elementsInScene(): string[] {
    const set = new Set<string>();
    for (const rec of this.records.values()) {
      for (const a of rec.data?.atoms ?? []) set.add(a.el);
    }
    return [...set].sort();
  }

  /* ---------- 渲染档位（T-4.1 双轨渲染，D04） ---------- */

  private renderMode: RenderMode = 'render';

  getRenderMode(): RenderMode {
    return this.renderMode;
  }

  /**
   * 全局双档切换：只改材质引用与描边外壳可见性，不触碰几何（验收 <1s）。
   * 线稿档 = Toon 三阶色阶 + 原子反转法线描边；渲染档 = PBR + PMREM。
   */
  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
    for (const rec of this.records.values()) this.applyMode(rec);
  }

  /** 按 renderMode 给组件着装：换材质 + 描边外壳可见性（惰性创建） */
  private applyMode(rec: ComponentRecord): void {
    for (const child of rec.group.children) {
      const kind = child.userData.matKind as string | undefined;
      if (kind) (child as THREE.Mesh).material = materialFor(kind, this.renderMode);
      else if (child.userData.outline) child.visible = this.renderMode === 'toon';
    }
    if (this.renderMode === 'toon') this.ensureOutlines(rec);
  }

  /** 为组件的原子实例网格创建反转法线描边外壳（每实例放大 1.07，BackSide 纯色） */
  private ensureOutlines(rec: ComponentRecord): void {
    if (rec.group.userData.outlinesReady) return;
    rec.group.userData.outlinesReady = true;
    for (const child of [...rec.group.children]) {
      if (child.userData.matKind !== 'atom') continue;
      const src = child as THREE.InstancedMesh;
      const outline = new THREE.InstancedMesh(src.geometry, outlineMaterial, src.count);
      outline.userData.outline = true;
      outline.raycast = () => undefined; // 描边外壳不参与拾取
      const mtx = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      for (let k = 0; k < src.count; k++) {
        src.getMatrixAt(k, mtx);
        mtx.decompose(pos, quat, scl);
        scl.multiplyScalar(1.07);
        mtx.compose(pos, quat, scl);
        outline.setMatrixAt(k, mtx);
      }
      outline.visible = this.renderMode === 'toon';
      rec.group.add(outline);
    }
  }

  /* ---------- 内部实现 ---------- */

  /**
   * 离屏渲染会话：改尺寸/透明底渲染一帧，返回现场供 endOffscreen 恢复（PNG/TIFF 共用）。
   * P0 修复（V2 交互升级）：会话内统一隐藏全部预览组——此前 exportPNG/TIFF/PDF 走本
   * 会话而未隐藏吸附候选（未 Apply 分子会进正式导出），且结束后按从未赋值的
   * previewVisBeforeExport(false) 恢复，导致首次导出后画布预览被永久隐藏。
   */
  private beginOffscreen(
    w: number,
    h: number,
    alpha: boolean,
  ): {
    prevSize: THREE.Vector2;
    prevPR: number;
    prevBg: THREE.Color | THREE.Texture | null;
    helpers: Array<{ o: THREE.Object3D; v: boolean }>;
  } {
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevPR = this.renderer.getPixelRatio();
    const prevBg = this.scene.background;
    const helpers = this.collectEditorHelpers();
    for (const h of helpers) h.o.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (alpha) this.scene.background = null;
    this.renderer.render(this.scene, this.camera);
    return { prevSize, prevPR, prevBg, helpers };
  }

  private endOffscreen(st: {
    prevSize: THREE.Vector2;
    prevPR: number;
    prevBg: THREE.Color | THREE.Texture | null;
    helpers: Array<{ o: THREE.Object3D; v: boolean }>;
  }): void {
    for (let i = st.helpers.length - 1; i >= 0; i--) st.helpers[i]!.o.visible = st.helpers[i]!.v;
    this.scene.background = st.prevBg;
    this.renderer.setPixelRatio(st.prevPR);
    this.renderer.setSize(st.prevSize.x, st.prevSize.y, false);
    this.camera.aspect = st.prevSize.x / Math.max(1, st.prevSize.y);
    this.camera.updateProjectionMatrix();
  }

  /** 收集编辑辅助节点快照（与 withEditorHelpersHidden 同一清单——单一事实源） */
  private collectEditorHelpers(): Array<{ o: THREE.Object3D; v: boolean }> {
    const saved: Array<{ o: THREE.Object3D; v: boolean }> = [];
    const push = (o: THREE.Object3D | null | undefined): void => {
      if (o) saved.push({ o, v: o.visible });
    };
    push(this.tc);
    push(this.viewportGrid.mesh);
    push(this.axesHelper);
    push(this.adsorptionPreviewGroup);
    push(this.placementPreviewGroup);
    for (const rec of this.records.values()) {
      for (const c of rec.group.children) if (c.userData.highlight) push(c);
    }
    return saved;
  }

  /**
   * 发起几何构建（T-2.2）：基底走主线程挤出几何，其余经引擎（默认 Worker 子线程）。
   * token 保证滑块连续拖动时只采纳最后一次请求的结果；Worker 失败时同步回退一次。
   */
  private requestBuild(rec: ComponentRecord, comp: RenderComponent): void {
    if (comp.type === 'rubber_substrate') {
      this.applyGeometry(rec, comp, null);
      return;
    }
    const token = (this.buildTokens.get(comp.id) ?? 0) + 1;
    this.buildTokens.set(comp.id, token);
    // 2026-09-12：片层/管的 CIF 按组件 mineral 参数取（缺省回退全局 setCifText——高岭石）
    const cif =
      comp.type === 'kaolinite_sheet' || comp.type === 'halloysite_tube'
        ? mineralOf((comp.params as { mineral?: string }).mineral).cifText || this.cifText
        : this.cifText;
    const req: GeometryRequest = { kind: comp.type, cifText: cif, params: comp.params };
    this.engine
      .build(req)
      .then((result) => {
        if (this.buildTokens.get(comp.id) !== token) return; // 已被新请求/删除作废
        if (this.records.get(comp.id) !== rec) return;
        this.applyGeometry(rec, comp, result);
      })
      .catch(() => {
        if (this.buildTokens.get(comp.id) !== token) return;
        if (this.records.get(comp.id) !== rec) return;
        try {
          this.applyGeometry(rec, comp, this.buildData(comp)); // 同步回退（保持功能可用）
        } catch {
          /* CIF 缺失等异常：保持空几何，等下一次 rebuild */
        }
      });
  }

  /** 把构建结果装载到 group（data=null 走基底挤出几何）；完成后通知 UI 刷新原子数 */
  private applyGeometry(rec: ComponentRecord, comp: RenderComponent, data: GeometryData | null): void {
    trace(`geometry-apply ${comp.name} atoms=${data?.atoms?.length ?? 0} bonds=${data?.bonds?.length ?? 0}`);
    this.clearGroup(rec.group);
    if (data) {
      // 显示模型：molecule 与晶体组件统一读 params.style（molecule 旧数据缺省 = 球棍）
      const style = (comp.params as { style?: string }).style ?? '球棍';
      const ballstick = style === '球棍';
      addAtoms(rec.group, data.atoms, ballstick);
      if (ballstick && data.bonds.length) addBonds(rec.group, data.atoms, data.bonds, BALL_STICK_BOND_RADIUS);
      rec.data = data;
      rec.atomCount = data.atoms.length;
    } else {
      rec.group.add(
        new THREE.Mesh(buildSubstrateGeometry(comp.params as SubstrateParams), substrateMaterial),
      );
      rec.group.children[rec.group.children.length - 1].userData.matKind = 'substrate';
      rec.data = null;
      rec.atomCount = 0;
    }
    this.applyTransform(comp, rec.group);
    rec.group.visible = comp.visible;
    if (this.shadowsOn) {
      rec.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    }
    rec.box = null; // 几何已变，包围盒缓存失效（T-7.1）
    this.applyMode(rec); // T-4.1：新几何按当前档位着装（含描边外壳重建）
    if (comp.appearance) this.applyComponentAppearance(rec); // 外观重放（P2 持久化）
    // T-7.1：重建后恢复高亮状态（选中优先于悬停）
    if (this.selectedId === comp.id) this.setShellState(rec, 'selected');
    else if (this.hoverId === comp.id) this.setShellState(rec, 'hover');
    // 构建完成时点在 store 变更之外，图层面板的原子数依赖此事件刷新
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kaolin-geometry-updated', { detail: { id: comp.id } }));
    }
  }

  private buildData(comp: SceneComponent): GeometryData | null {
    switch (comp.type) {
      case 'kaolinite_sheet': {
        const cif1 = mineralOf((comp.params as { mineral?: string }).mineral).cifText || this.cifText;
        if (!cif1) throw new Error('未设置 CIF 数据（setCifText）');
        return buildKaoliniteSheet(cif1, comp.params);
      }
      case 'crystal_surface': {
        const cifS = mineralOf((comp.params as { mineral?: string }).mineral).cifText || this.cifText;
        if (!cifS) throw new Error('未设置 CIF 数据（setCifText）');
        return buildCrystalSurface(cifS, comp.params as import('../core/types').CrystalSurfaceParams);
      }
      case 'halloysite_tube': {
        const cif2 = mineralOf((comp.params as { mineral?: string }).mineral).cifText || this.cifText;
        if (!cif2) throw new Error('未设置 CIF 数据（setCifText）');
        return buildHalloysiteTube(cif2, comp.params);
      }
      case 'nanoparticle':
        return buildParticle(comp.params);
      case 'molecule': {
        const mp = comp.params as MoleculeParams;
        if (mp.mol) {
          const m = parseSdfOrMol(mp.mol); // T-2.10（与 Worker 路径同源）
          return { atoms: m.atoms, bonds: m.bonds };
        }
        if (mp.smiles) {
          const mol = smilesTo3D(mp.smiles); // T-2.8：确定性重建（存参数不存网格）
          return { atoms: mol.atoms, bonds: mol.bonds.map(([i, j]) => [i, j]) };
        }
        if (mp.formula) {
          // canonical 升级（2026-09-18）：有权威 preset 优先参考几何（与 Worker 共用 helper）
          const canonical = resolveCanonicalFormula(mp.formula);
          if (canonical) return buildMolecule(canonical);
          const mol = formulaTo3D(mp.formula); // 2026-09-08：化学式团簇（与 Worker 路径同源）
          return { atoms: mol.atoms, bonds: mol.bonds };
        }
        return buildMolecule(mp.kind);
      }
      case 'rubber_substrate':
        return null; // 基底走 THREE 挤出几何（substrate.ts）
      case 'packed_layers':
        return buildPackedLayers(comp.params);
    }
  }

  private applyTransform(comp: SceneComponent, g: THREE.Group): void {
    const t = comp.transform;
    g.position.fromArray(t.position);
    g.rotation.set((t.rotation[0] * Math.PI) / 180, (t.rotation[1] * Math.PI) / 180, (t.rotation[2] * Math.PI) / 180);
    g.scale.setScalar(t.scale);
    // 写入值同步为 unwrap 连续化锚点（外部输入 720° 后拖拽回读以 720 为基准累积）
    if (comp.id) this.lastRotationRead.set(comp.id, [...t.rotation] as [number, number, number]);
  }

  private clearGroup(g: THREE.Group): void {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose();
    });
    while (g.children.length) g.remove(g.children[0]);
    g.userData.outlinesReady = false; // 重建后描边外壳随之重建（applyMode）
    g.userData.highlightsReady = false; // T-7.1 高亮外壳同理
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 编辑地面高度：可见组件缓存包围盒最低点（无组件 = 0）；网格再低 0.25Å 防 z-fight */
  private editorGroundY(): number {
    let min = Infinity;
    const box = new THREE.Box3();
    for (const rec of this.records.values()) {
      if (!rec.comp.visible) continue;
      if (!rec.box) rec.box = this.compBox(rec, new THREE.Box3());
      box.union(rec.box);
    }
    if (!box.isEmpty()) min = box.min.y;
    return (Number.isFinite(min) ? min : 0) - 1.05;
  }

  private startLoop(): void {
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      if (this.sceneVisible && this.gridStyleVisible) {
        this.viewportGrid.setHeight(this.editorGroundY());
        this.viewportGrid.update(this.camera);
      }
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** 精确包围盒：按原子坐标 + 组件变换求（InstancedMesh 包围盒不可用） */
  private readonly _bv = new THREE.Vector3();
  private compBox(rec: ComponentRecord, box: THREE.Box3): THREE.Box3 {
    const g = rec.group;
    if (rec.data && rec.data.atoms.length) {
      const min = new THREE.Vector3(1e9, 1e9, 1e9);
      const max = new THREE.Vector3(-1e9, -1e9, -1e9);
      for (const a of rec.data.atoms) {
        this._bv
          .set(a.x * g.scale.x, a.y * g.scale.y, a.z * g.scale.z)
          .applyQuaternion(g.quaternion)
          .add(g.position);
        min.min(this._bv);
        max.max(this._bv);
      }
      box.expandByPoint(min);
      box.expandByPoint(max);
    } else {
      box.setFromObject(g);
    }
    return box;
  }

  private frameBox(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.62 + 8;
    const dir = new THREE.Vector3(1, 0.7, 1.05).normalize();
    this.camera.position.copy(center).addScaledVector(dir, radius * 2.9);
    this.orbit.target.copy(center);
  }

  private handleDown(e: PointerEvent): void {
    // 点在 gizmo 手柄上则不参与拾取
    const axis = (this.tc as unknown as { axis: string | null }).axis;
    this.downXY = axis ? null : [e.clientX, e.clientY];
  }

  private handleUp(e: PointerEvent): void {
    if (!this.downXY) return;
    const down = this.downXY;
    this.downXY = null;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    if (moved > 5 || e.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.records.values()].filter((r) => r.group.visible).map((r) => r.group);
    const hits = raycaster.intersectObjects(targets, true);
    if (hits.length) {
      const hit = hits[0];
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.componentId) o = o.parent;
      const compId = (o?.userData.componentId as string | undefined) ?? null;
      // Alt+点击原子（2026-09-12）：instanceId → 该桶原子（密排层切换"参与堆叠"等）
      if ((e.altKey || this.atomPickNoAlt) && hit.instanceId !== undefined && hit.object.userData.matKind === 'atom') {
        const bucket = hit.object.userData.atoms as Atom[] | undefined;
        const atom = bucket?.[hit.instanceId];
        if (compId && atom) {
          // P0 修复（V2 交互升级）：instanceId 是"元素桶内"索引而非全局原子索引——
          // 多元素晶体（如 CeO₂/Mg-Al LDH）此前会把桶内号当全局号传给测量/氧空位，
          // 解析到错误原子。桶数组元素与 data.atoms 为同一引用（instanced.addAtoms），
          // 按引用 indexOf 反查全局号（仅点击时一次 O(n)，无感）。
          const rec = this.records.get(compId);
          const globalIndex = rec?.data ? rec.data.atoms.indexOf(atom) : -1;
          if (globalIndex >= 0) this.onAtomClick?.(compId, atom, globalIndex);
        }
        return; // 不触发选中切换（编辑意图）
      }
      this.onSelect?.(compId, e.shiftKey);
    } else {
      this.onSelect?.(null);
    }
  }
}
