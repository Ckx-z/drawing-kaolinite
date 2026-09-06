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
import type { SceneComponent, Transform } from '../core/types';
import {
  createGeometryEngine,
  type GeometryEngine,
  type GeometryRequest,
} from '../core/worker';
import { encodeTIFF, resolveExportSize } from '../export/tiff';
import { addAtoms, addBonds, recolorAtomMesh } from './instanced';
import { setActivePalette, type PaletteSetting } from './palette';
import { substrateMaterial } from './materials';
import { buildSubstrateGeometry } from './substrate';
import { materialFor, outlineMaterial, type RenderMode } from './toon';
import type { SubstrateParams } from '../core/types';

interface ComponentRecord {
  comp: SceneComponent;
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
    this.engine = opts?.engine ?? createGeometryEngine();
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

  /* ---------- 组件生命周期 ---------- */

  addComponent(comp: RenderComponent): void {
    const group = new THREE.Group();
    group.userData.componentId = comp.id;
    const rec: ComponentRecord = { comp, group, data: null, atomCount: 0 };
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
    this.selectedId = id;
    const rec = id ? this.records.get(id) : null;
    if (rec && rec.comp.visible) this.tc.attach(rec.group);
    else this.tc.detach();
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
   * 高分辨率 PNG 导出：px = cm × dpi / 2.54（16cm@300dpi → 1890px 宽）。
   * 离屏改尺寸渲染一帧 → toDataURL → 恢复原尺寸。返回尺寸供 UI 提示。
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
      const dataUrl = this.renderer.domElement.toDataURL('image/png');
      return { dataUrl, width: w, height: h };
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
      const oc = document.createElement('canvas');
      oc.width = plan.w;
      oc.height = plan.h;
      const ctx = oc.getContext('2d');
      if (!ctx) throw new Error('无法创建 2D 画布（TIFF 导出）');
      ctx.drawImage(this.renderer.domElement, 0, 0, plan.w, plan.h);
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
    this.applyMode(rec); // T-4.1：新几何按当前档位着装（含描边外壳重建）
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
      case 'molecule':
        return buildMolecule(comp.params.kind);
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
