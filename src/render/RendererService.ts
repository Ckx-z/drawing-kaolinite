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
import {
  buildHalloysiteTube,
  buildKaoliniteSheet,
  buildMolecule,
  buildParticle,
} from '../core/builders';
import type { GeometryData } from '../core/geometry';
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
import { presetPosition, type CameraPreset } from './postfx';
import { annotationsToSVG, sceneToSVG, type SvgAtom, type SvgComponentInput } from '../export/svg';
import { getElement } from '../core/elements';
import { activeColorFor } from './palette';
import { addAtoms, addBonds, recolorAtomMesh } from './instanced';
import { setActivePalette, type PaletteSetting } from './palette';
import { substrateMaterial } from './materials';
import { buildSubstrateGeometry } from './substrate';
import { materialFor, outlineMaterial, type RenderMode } from './toon';
import { createHighlightShell, findShell, type HighlightState } from './highlight';
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
}

/** SVG 导出的原子显示半径基准（与 instanced.ts 同款约定） */
function baseRadiusFor(el: string, ballstick: boolean): number {
  const info = getElement(el);
  const cov = info?.cov ?? 1;
  const vdw = info?.vdw ?? 1.6;
  return ballstick ? cov * 0.95 : vdw * 0.92;
}

export class RendererService {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  readonly tc: TransformControls;

  private records = new Map<string, ComponentRecord>();
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

  /** 画布点击选中回调（null = 点击空白取消） */
  onSelect: ((id: string | null) => void) | null = null;
  /** gizmo 拖动结束帧的变换同步回调（T-1.5 状态层接入） */
  onTransformChange: ((id: string) => void) | null = null;

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

    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.setSize(0.85);
    this.scene.add(this.tc);
    this.tc.addEventListener('dragging-changed', (e) => {
      const v = (e as unknown as { value: boolean }).value;
      this.orbit.enabled = !v;
    });
    this.tc.addEventListener('objectChange', () => {
      if (this.selectedId && this.onTransformChange) this.onTransformChange(this.selectedId);
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
    group.visible = comp.visible;
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
    rec.group.visible = comp.visible;
    this.requestBuild(rec, comp);
  }

  removeComponent(id: string): void {
    const rec = this.records.get(id);
    if (!rec) return;
    this.buildTokens.set(id, (this.buildTokens.get(id) ?? 0) + 1); // 使在途构建作废
    this.clearGroup(rec.group);
    this.scene.remove(rec.group);
    this.records.delete(id);
    if (this.selectedId === id) this.setSelection(null);
  }

  setComponentVisible(id: string, visible: boolean): void {
    const rec = this.records.get(id);
    if (rec) rec.group.visible = visible;
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
    if (select) select.visible = state === 'selected';
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

  /** gizmo 模式切换（ParamPanel 移动/旋转按钮） */
  setGizmoMode(mode: 'translate' | 'rotate'): void {
    this.tc.setMode(mode);
  }

  /** 读取组件当前变换（gizmo 拖动后由状态层回写 store） */
  getComponentTransform(id: string): Transform | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    const g = rec.group;
    const d = 180 / Math.PI;
    return {
      position: [g.position.x, g.position.y, g.position.z],
      rotation: [g.rotation.x * d, g.rotation.y * d, g.rotation.z * d],
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
  }

  /**
   * 整景缩略图快照（组合模块入库用，T-3.1）：
   * 只隐藏 gizmo，保留所有组件当前可见性 → 渲染一帧 → 离屏画布缩放绘制。
   */
  snapshotScene(width = 150, height = 110): string {
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

  /** 目标点处每 Å 像素数（比例尺刻度换算） */
  pxPerAAtTarget(H: number): number {
    const dist = this.camera.position.distanceTo(this.orbit.target);
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    return H / 2 / (Math.max(dist, 1e-3) * tanHalf);
  }

  /** 离屏渲染帧 + 标注叠画 → 2D 画布（PNG/TIFF/PDF 共用；annotations 可选） */
  snapshotWithOverlay(w: number, h: number, annotations: Annotation[]): HTMLCanvasElement {
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
      const canvas = this.snapshotWithOverlay(w, h, opts.annotations ?? []);
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
      const oc = this.snapshotWithOverlay(plan.w, plan.h, opts.annotations ?? []);
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
  exportSVG(opts?: { background?: string; strokeWidth?: number; annotations?: Annotation[] }): string {
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
      const ballstick = (comp.params as { style?: string }).style === '球棍' || comp.type === 'molecule';
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
        bondRadius: 0.16 * comp.transform.scale,
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
    if (!annotations.length) return svgBody;
    const annotSvg = annotationsToSVG({
      width: size.x,
      height: size.y,
      annotations,
      pxPerA: this.pxPerAAtTarget(size.y),
      project: (p) => this.projectToScreen(p, size.x, size.y),
    });
    return svgBody.replace('</svg>', `${annotSvg}\n</svg>`);
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
    // 隐藏其他组件与 gizmo（在 beginOffscreen 渲染前生效）
    const prevVis: Array<[string, boolean]> = [];
    for (const [k, r] of this.records) {
      prevVis.push([k, r.group.visible]);
      r.group.visible = k === id && r.comp.visible;
    }
    const tcVisible = this.tc.visible;
    this.tc.visible = false;
    const st = this.beginOffscreen(plan.w, plan.h, true); // 透明底
    try {
      const dataUrl = this.renderer.domElement.toDataURL('image/png');
      return { dataUrl, width: plan.w, height: plan.h };
    } finally {
      this.endOffscreen(st);
      this.tc.visible = tcVisible;
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
      return this.snapshotWithOverlay(plan.w, plan.h, opts.annotations ?? []);
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
      const dataUrl = this.snapshotWithOverlay(w, h, opts.annotations ?? []).toDataURL('image/png');
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

  /** 离屏渲染会话：改尺寸/透明底渲染一帧，返回现场供 endOffscreen 恢复（PNG/TIFF 共用） */
  private beginOffscreen(
    w: number,
    h: number,
    alpha: boolean,
  ): { prevSize: THREE.Vector2; prevPR: number; prevBg: THREE.Color | THREE.Texture | null } {
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevPR = this.renderer.getPixelRatio();
    const prevBg = this.scene.background;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (alpha) this.scene.background = null;
    this.renderer.render(this.scene, this.camera);
    return { prevSize, prevPR, prevBg };
  }

  private endOffscreen(st: {
    prevSize: THREE.Vector2;
    prevPR: number;
    prevBg: THREE.Color | THREE.Texture | null;
  }): void {
    this.scene.background = st.prevBg;
    this.renderer.setPixelRatio(st.prevPR);
    this.renderer.setSize(st.prevSize.x, st.prevSize.y, false);
    this.camera.aspect = st.prevSize.x / Math.max(1, st.prevSize.y);
    this.camera.updateProjectionMatrix();
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
    const req: GeometryRequest = { kind: comp.type, cifText: this.cifText, params: comp.params };
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
    this.clearGroup(rec.group);
    if (data) {
      const style = (comp.params as { style?: string }).style;
      const ballstick = style === '球棍' || comp.type === 'molecule';
      addAtoms(rec.group, data.atoms, ballstick);
      if (ballstick && data.bonds.length) addBonds(rec.group, data.atoms, data.bonds, 0.16);
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
      case 'kaolinite_sheet':
        if (!this.cifText) throw new Error('未设置 CIF 数据（setCifText）');
        return buildKaoliniteSheet(this.cifText, comp.params);
      case 'halloysite_tube':
        if (!this.cifText) throw new Error('未设置 CIF 数据（setCifText）');
        return buildHalloysiteTube(this.cifText, comp.params);
      case 'nanoparticle':
        return buildParticle(comp.params);
      case 'molecule': {
        const mp = comp.params as MoleculeParams;
        if (mp.smiles) {
          const mol = smilesTo3D(mp.smiles); // T-2.8：确定性重建（存参数不存网格）
          return { atoms: mol.atoms, bonds: mol.bonds.map(([i, j]) => [i, j]) };
        }
        if (mp.formula) {
          const mol = formulaTo3D(mp.formula); // 2026-09-08：化学式团簇（与 Worker 路径同源）
          return { atoms: mol.atoms, bonds: mol.bonds };
        }
        return buildMolecule(mp.kind);
      }
      case 'rubber_substrate':
        return null; // 基底走 THREE 挤出几何（substrate.ts）
    }
  }

  private applyTransform(comp: SceneComponent, g: THREE.Group): void {
    const t = comp.transform;
    g.position.fromArray(t.position);
    g.rotation.set((t.rotation[0] * Math.PI) / 180, (t.rotation[1] * Math.PI) / 180, (t.rotation[2] * Math.PI) / 180);
    g.scale.setScalar(t.scale);
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

  private startLoop(): void {
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
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
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !o.userData.componentId) o = o.parent;
      this.onSelect?.((o?.userData.componentId as string | undefined) ?? null);
    } else {
      this.onSelect?.(null);
    }
  }
}
