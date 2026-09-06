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
import type { SceneComponent } from '../core/types';
import { addAtoms, addBonds } from './instanced';
import { substrateMaterial } from './materials';
import { buildSubstrateGeometry } from './substrate';
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

export class RendererService {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  readonly tc: TransformControls;

  private records = new Map<string, ComponentRecord>();
  private cifText = '';
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

  constructor(private container: HTMLElement) {
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
    const { data, atomCount } = this.fillGroup(group, comp);
    this.applyTransform(comp, group);
    group.visible = comp.visible;
    this.records.set(comp.id, { comp, group, data, atomCount });
    this.scene.add(group);
  }

  /** 参数变化后全量重建该组件（其余组件不触碰） */
  rebuildComponent(comp: RenderComponent): void {
    const rec = this.records.get(comp.id);
    if (!rec) return;
    this.clearGroup(rec.group);
    rec.comp = comp;
    const { data, atomCount } = this.fillGroup(rec.group, comp);
    rec.data = data;
    rec.atomCount = atomCount;
    this.applyTransform(comp, rec.group);
    rec.group.visible = comp.visible;
  }

  removeComponent(id: string): void {
    const rec = this.records.get(id);
    if (!rec) return;
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

  /* ---------- 内部实现 ---------- */

  /** 装载组件几何到 group（params 联合在 buildData 的 switch 内收窄；基底走 null 分支） */
  private fillGroup(
    group: THREE.Group,
    comp: RenderComponent,
  ): { data: GeometryData | null; atomCount: number } {
    const data = this.buildData(comp);
    if (data) {
      const style = (comp.params as { style?: string }).style;
      const ballstick = style === '球棍' || comp.type === 'molecule';
      addAtoms(group, data.atoms, ballstick);
      if (ballstick && data.bonds.length) addBonds(group, data.atoms, data.bonds, 0.16);
      return { data, atomCount: data.atoms.length };
    }
    group.add(
      new THREE.Mesh(buildSubstrateGeometry(comp.params as SubstrateParams), substrateMaterial),
    );
    return { data: null, atomCount: 0 };
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
