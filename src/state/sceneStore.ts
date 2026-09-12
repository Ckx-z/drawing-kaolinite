/**
 * 场景图状态管理 —— T-1.5（Zustand vanilla store，UI 与渲染无关）
 *
 * 设计：
 *  - createStore（zustand/vanilla）保证可在 Node 单测中直接驱动（验收要求）；
 *    React 侧（T-1.6）用 useStore(store) 桥接。
 *  - 组件条目 = SceneComponent & { id: string }：schema 校验过的合法组件 + 必需 id，
 *    与渲染层 RenderComponent 同构，rendererBinding 可直接喂给 RendererService。
 *  - 所有写操作经 zod 校验（schema 单一事实源）：updateParams/setTransform 非法即抛错且状态不变。
 *  - 渲染同步不在 store 内：bindRenderer（rendererBinding.ts）订阅差异后调渲染服务。
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { trace } from '../crashTrace';
import { attachHistory } from './history';
import {
  DEFAULT_PARAMS,
  SCENE_FORMAT,
  componentSchema,
  defaultTransformFor,
  deserializeScene,
  normalizeScene,
  sceneDocumentSchema,
  transformSchema,
} from '../core/schema';
import {
  SHAPE_DEFAULTS,
  SHAPE_TOOLS,
  shapeSchema,
  type SceneShape,
  type ShapeTool,
} from '../core/shapes/schema';
import type {
  Annotation,
  AnyParams,
  ComponentType,
  PaletteSetting,
  SceneComponent,
  SceneDocument,
  Transform,
} from '../core/types';

/** store 中的组件条目：合法组件 + 必需 id（与渲染层 RenderComponent 同构） */
export type SceneEntry = SceneComponent & { id: string };

export const TYPE_NAMES: Record<ComponentType, string> = {
  kaolinite_sheet: '高岭土片层',
  halloysite_tube: '埃洛石管',
  nanoparticle: '纳米颗粒',
  molecule: '分子',
  rubber_substrate: '橡胶基底',
  packed_layers: '密排原子层',
};

export interface AddComponentOptions {
  name?: string;
  params?: Partial<AnyParams>;
  transform?: Partial<Transform>;
  visible?: boolean;
}

export interface SceneState {
  components: SceneEntry[];
  selectionId: string | null;
  /** 全局色板设置（T-4.2；随场景 JSON 持久化） */
  palette: PaletteSetting;
  /** 标注层（T-4.4；随场景 JSON 持久化） */
  annotations: Annotation[];
  /** 新增标注（自动错位偏移），返回 id */
  addAnnotation: (a: Omit<Annotation, 'visible'> & { visible?: boolean }) => number;
  /** 按 id（数组下标）更新标注 */
  updateAnnotation: (index: number, patch: Partial<Annotation>) => void;
  removeAnnotation: (index: number) => void;
  /** 设置色板（整体替换；渲染重着色由调用方经 rendererRef 触发或绑定层同步） */
  setPalette: (p: PaletteSetting) => void;
  /** 新增组件（默认参数 + 类型命名），返回新 id */
  addComponent: (type: ComponentType, opts?: AddComponentOptions) => string;
  removeComponent: (id: string) => void;
  select: (id: string | null) => void;
  /**
   * 组件多选（T-7.3，Shift+点击）：末位为主选；结果 0 → 全清 / 1 → 转单选 /
   * ≥2 → 多选态（selectionId=null，gizmo 收起，面板显示批量操作区）。
   */
  componentSelectionIds: string[];
  toggleComponentSelection: (id: string) => void;
  selectComponentIds: (ids: string[]) => void;
  /** 批量：位置对齐到主选的某轴分量 */
  alignComponents: (axis: 0 | 1 | 2) => void;
  /** 批量：沿轴排序后首尾不动中间等距（≥3 个成员生效） */
  distributeComponents: (axis: 0 | 1 | 2) => void;
  /** 批量：统一参数（风格/单原子模式/矿物等；类型不适用该键的成员自动跳过） */
  applyParamsToSelection: (patch: Record<string, unknown>) => void;
  /** 批量：统一缩放 */
  applyScaleToSelection: (scale: number) => void;
  setVisibility: (id: string, visible: boolean) => void;
  /** 锁定/解锁（T-3.3：锁定后点击不选中、gizmo 不吸附；锁定选中组件会取消其选中） */
  toggleLock: (id: string) => void;
  /** 把若干组件编为一组（T-3.3），返回组 id */
  groupComponents: (ids: string[]) => string;
  /** 解散指定组件所在组（移除 group 标记） */
  ungroupComponents: (ids: string[]) => void;
  /** 合并参数（整体经 componentSchema 校验，非法抛错且状态不变） */
  updateParams: (id: string, patch: Partial<AnyParams>) => void;
  /**
   * 整体替换 transform（经 transformSchema 校验）。
   * T-3.3 组感知：组件属于某组时，位置/旋转取增量、缩放取比值同步到同组全部成员。
   */
  setTransform: (id: string, transform: Transform) => void;
  renameComponent: (id: string, name: string) => void;
  /** 导出为合法场景文档（kaolin-scene/v1） */
  toSceneDocument: () => SceneDocument;
  /** 载入场景（对象或 JSON 文本均可；经校验 + normalizeScene 补 id）并清空选择 */
  loadScene: (raw: unknown | string) => void;
  clear: () => void;

  /* ---------- 机理图图元层（T-11.1） ---------- */
  /** 图元列表（数组顺序 = Z 序） */
  shapes: SceneShape[];
  /** 图元选中 id 列表（末位为主选；与组件 selectionId 互斥） */
  shapeSelectionIds: string[];
  /** 当前图元工具（select 时图元命中优先、空白透传 3D 拾取） */
  tool: ShapeTool;
  /** 新增图元（默认样式 + 调用方几何；schema 校验），返回 id */
  addShape: (partial: Partial<SceneShape> & { type: SceneShape['type'] }) => string;
  /** 合并更新图元（整体经 shapeSchema 校验，非法抛错且状态不变） */
  updateShape: (id: string, patch: Partial<SceneShape>) => void;
  removeShape: (id: string) => void;
  /** 选中图元（单选语义；锁定图元不可选；与组件选中互斥）。null = 清空 */
  selectShape: (id: string | null) => void;
  /** Ctrl/⌘+点击切换累加（多选；编组/整体移动用） */
  toggleShapeSelection: (id: string) => void;
  /** 批量选中（框选/图层多选） */
  selectShapes: (ids: string[]) => void;
  setTool: (tool: ShapeTool) => void;
  /** Z 序调整：'front'/'back' 置顶置底，'forward'/'backward' 升降一级 */
  moveShapeOrder: (id: string, dir: 'front' | 'back' | 'forward' | 'backward') => void;
  /** 多选图元编组（T-11.4；组内整体移动），返回组 id */
  groupShapes: (ids: string[]) => string | null;
  /** 解散图元编组 */
  ungroupShapes: (ids: string[]) => void;
  /** 画布形态（T-11.6）：mixed = 3D 混合（默认）；diagram = 纯 2D 示意图（3D 隐藏 + 视口 pan/zoom）。视图状态不持久化 */
  mode: 'mixed' | 'diagram';
  setMode: (mode: 'mixed' | 'diagram') => void;
  /** 模板库版本号（T-11.8）：存/删模板后 bump，驱动模板分区刷新（视图信号，不持久化） */
  templateSeq: number;
  bumpTemplates: () => void;
}

export type SceneStore = StoreApi<SceneState>;

export function createSceneStore(): SceneStore {
  let seq = 0;
  let groupSeq = 0;
  let shapeSeq = 0;
  const uid = (): string => `c${++seq}`;
  const shapeUid = (): string => `s${++shapeSeq}`;

  return createStore<SceneState>()((set, get) => ({
    components: [],
    selectionId: null,
    componentSelectionIds: [],
    palette: {},
    annotations: [],
    shapes: [],
    shapeSelectionIds: [],
    tool: 'select',
    mode: 'mixed',
    templateSeq: 0,

    setMode: (mode) => set({ mode }),
    bumpTemplates: () => set((s) => ({ templateSeq: s.templateSeq + 1 })),

    setPalette: (p) => set({ palette: p }),

    addAnnotation: (a) => {
      const next = [...get().annotations, { visible: true, ...a }];
      set({ annotations: next });
      return next.length - 1;
    },
    updateAnnotation: (index, patch) => {
      set({
        annotations: get().annotations.map((a, i) => (i === index ? { ...a, ...patch } : a)),
      });
    },
    removeAnnotation: (index) => {
      set({ annotations: get().annotations.filter((_, i) => i !== index) });
    },

    addComponent: (type, opts) => {
      const id = uid();
      const count = get().components.filter((c) => c.type === type).length;
      const raw = {
        id,
        type,
        name: opts?.name ?? `${TYPE_NAMES[type]} ${count + 1}`,
        params: { ...DEFAULT_PARAMS[type], ...(opts?.params ?? {}) },
        transform: { ...defaultTransformFor(type), ...(opts?.transform ?? {}) },
        visible: opts?.visible ?? true,
        locked: false,
      };
      const comp = componentSchema.parse(raw) as SceneEntry; // 参数越界在此拦截
      set({ components: [...get().components, comp] });
      return id;
    },

    removeComponent: (id) => {
      const rest = get().components.filter((c) => c.id !== id);
      if (rest.length === get().components.length) return;
      // T-11.3 级联：锚定该组件的箭头/连线端点退化为 free（保留几何端点）
      const shapes = get().shapes.map((s) => {
        if (s.type !== 'arrow' && s.type !== 'line') return s;
        let changed = false;
        const anchors = { ...s.anchors };
        for (const end of ['start', 'end'] as const) {
          const a = anchors[end];
          if (a.kind === 'component' && a.id === id) {
            anchors[end] = { kind: 'free' };
            changed = true;
          }
        }
        return changed ? ({ ...s, anchors } as SceneShape) : s;
      });
      set({
        components: rest,
        shapes,
        selectionId: get().selectionId === id ? null : get().selectionId,
      });
    },

    select: (id) => {
      if (id !== null) {
        // T-3.3：锁定组件点击不选中（画布拾取与图层面板统一屏蔽）
        const comp = get().components.find((c) => c.id === id);
        if (!comp || comp.locked) return;
      }
      set({
        selectionId: id,
        shapeSelectionIds: id !== null ? [] : get().shapeSelectionIds,
        componentSelectionIds: id !== null ? [] : get().componentSelectionIds,
      });
    },

    toggleComponentSelection: (id) => {
      const comp = get().components.find((c) => c.id === id);
      if (!comp || comp.locked) return;
      // 基准 = 现有多选；无则从单选起步（Shift 语义：在现有选择上叠加）
      const curSel = get().selectionId;
      const base: string[] = get().componentSelectionIds.length
        ? get().componentSelectionIds
        : curSel
          ? [curSel]
          : [];
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      if (next.length === 0) set({ componentSelectionIds: [], selectionId: null, shapeSelectionIds: [] });
      else if (next.length === 1) set({ componentSelectionIds: [], selectionId: next[0]!, shapeSelectionIds: [] });
      else set({ componentSelectionIds: next, selectionId: null, shapeSelectionIds: [] });
    },

    selectComponentIds: (ids) => {
      const comps = get().components;
      const wanted = ids.filter((id) => {
        const c = comps.find((x) => x.id === id);
        return !!c && !c.locked;
      });
      if (wanted.length === 0) set({ componentSelectionIds: [], selectionId: null, shapeSelectionIds: [] });
      else if (wanted.length === 1) set({ componentSelectionIds: [], selectionId: wanted[0]!, shapeSelectionIds: [] });
      else set({ componentSelectionIds: wanted, selectionId: null, shapeSelectionIds: [] });
    },

    alignComponents: (axis) => {
      const ids = get().componentSelectionIds;
      if (ids.length < 2) return;
      const leader = get().components.find((c) => c.id === ids[ids.length - 1]);
      if (!leader) return;
      const target = leader.transform.position[axis];
      const wanted = new Set(ids);
      set({
        components: get().components.map((c) => {
          if (!wanted.has(c.id) || c.locked || c.id === leader.id) return c;
          const position = c.transform.position.map((v, i) => (i === axis ? target : v)) as Transform['position'];
          return { ...c, transform: transformSchema.parse({ ...c.transform, position }) };
        }),
      });
    },

    distributeComponents: (axis) => {
      const ids = get().componentSelectionIds;
      if (ids.length < 3) return;
      const wanted = new Set(ids);
      const members = get()
        .components.filter((c) => wanted.has(c.id) && !c.locked)
        .sort((a, b) => a.transform.position[axis] - b.transform.position[axis]);
      if (members.length < 3) return;
      const first = members[0]!.transform.position[axis];
      const last = members[members.length - 1]!.transform.position[axis];
      const step = (last - first) / (members.length - 1);
      const targetOf = new Map(members.map((c, i) => [c.id, first + i * step]));
      set({
        components: get().components.map((c) => {
          const t = targetOf.get(c.id);
          if (t === undefined) return c;
          const position = c.transform.position.map((v, i) => (i === axis ? t : v)) as Transform['position'];
          return { ...c, transform: transformSchema.parse({ ...c.transform, position }) };
        }),
      });
    },

    applyParamsToSelection: (patch) => {
      const ids = new Set(get().componentSelectionIds);
      if (ids.size < 2) return;
      set({
        components: get().components.map((c) => {
          if (!ids.has(c.id) || c.locked) return c;
          try {
            // strictObject 拒绝不适用该类型的参数键 → 该成员自动跳过（如矿物键遇 molecule）
            return componentSchema.parse({ ...c, params: { ...c.params, ...patch } }) as typeof c;
          } catch {
            return c;
          }
        }),
      });
    },

    applyScaleToSelection: (scale) => {
      const ids = new Set(get().componentSelectionIds);
      if (ids.size < 2) return;
      set({
        components: get().components.map((c) => {
          if (!ids.has(c.id) || c.locked) return c;
          return { ...c, transform: transformSchema.parse({ ...c.transform, scale }) };
        }),
      });
    },

    setVisibility: (id, visible) => {
      set({
        components: get().components.map((c) => (c.id === id ? { ...c, visible } : c)),
      });
    },

    toggleLock: (id) => {
      const target = get().components.find((c) => c.id === id);
      if (!target) return;
      const locked = !(target.locked ?? false);
      set({
        components: get().components.map((c) => (c.id === id ? { ...c, locked } : c)),
        // 锁定当前选中组件 → 取消选中（gizmo 随之脱附）
        selectionId: locked && get().selectionId === id ? null : get().selectionId,
      });
    },

    groupComponents: (ids) => {
      const gid = `g${++groupSeq}`;
      const wanted = new Set(ids);
      let any = false;
      const components = get().components.map((c) => {
        if (!wanted.has(c.id)) return c;
        any = true;
        return { ...c, group: gid };
      });
      if (any) set({ components });
      return gid;
    },

    ungroupComponents: (ids) => {
      const wanted = new Set(ids);
      set({
        components: get().components.map((c) => {
          if (!wanted.has(c.id) || !c.group) return c;
          const rest = { ...c };
          delete rest.group;
          return rest;
        }),
      });
    },

    updateParams: (id, patch) => {
      const comp = get().components.find((c) => c.id === id);
      if (!comp) return;
      const merged = { ...comp, params: { ...comp.params, ...patch } };
      const parsed = componentSchema.parse(merged) as SceneEntry; // 非法参数抛 ZodError，状态不变
      set({ components: get().components.map((c) => (c.id === id ? parsed : c)) });
    },

    setTransform: (id, transform) => {
      const comp = get().components.find((c) => c.id === id);
      if (!comp) return;
      const t = transformSchema.parse(transform); // 越界（如 scale<0.05）拦截
      const members = comp.group
        ? get().components.filter((c) => c.group === comp.group)
        : [comp];
      if (members.length <= 1) {
        set({
          components: get().components.map((c) => (c.id === id ? { ...c, transform: t } : c)),
        });
        return;
      }
      // T-3.3 组感知：位置/旋转取增量，缩放取比值，同步到同组全部成员。
      // 旋转增量取最短角差（2026-09-12）：欧拉分解在 ±180° wrap / 万向锁附近翻转时，
      // 逐分量裸差会把等价姿态当成 ±360° 转动同步给同组成员（拖拽跳变的根因）
      const shortestAngle = (d: number): number => ((d + 180) % 360 + 360) % 360 - 180;
      const dPos = t.position.map((v, i) => v - comp.transform.position[i]) as Transform['position'];
      const dRot = t.rotation.map((v, i) => shortestAngle(v - comp.transform.rotation[i])) as Transform['rotation'];
      const ratio = t.scale / comp.transform.scale;
      set({
        components: get().components.map((c) => {
          if (c.group === comp.group) {
            return {
              ...c,
              transform: transformSchema.parse({
                position: c.transform.position.map((v, i) => v + dPos[i]) as Transform['position'],
                rotation: c.transform.rotation.map((v, i) => v + dRot[i]) as Transform['rotation'],
                scale: c.transform.scale * ratio,
              }),
            };
          }
          return c;
        }),
      });
    },

    renameComponent: (id, name) => {
      if (!name.trim()) return;
      set({
        components: get().components.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)),
      });
    },

    toSceneDocument: () => {
      const palette = get().palette;
      const annotations = get().annotations;
      const shapes = get().shapes;
      return sceneDocumentSchema.parse({
        format: SCENE_FORMAT,
        saved: new Date().toISOString(),
        components: get().components.map((c) => ({ ...c, locked: c.locked ?? false })),
        ...(palette.id || palette.overrides ? { palette } : {}),
        ...(annotations.length ? { annotations } : {}),
        ...(shapes.length ? { shapes } : {}),
      });
    },

    loadScene: (raw) => {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const doc = normalizeScene(deserializeScene(text));
      set({
        components: doc.components as SceneEntry[],
        selectionId: null,
        palette: doc.palette ?? {}, // T-4.2：旧场景文件无 palette → 回默认色板
        annotations: doc.annotations ?? [], // T-4.4：旧场景无标注 → 空
        shapes: (doc.shapes ?? []).map((s) => shapeSchema.parse(s)), // T-11.1：补默认字段
        shapeSelectionIds: [],
        tool: 'select',
      });
    },

    clear: () =>
      set({ components: [], selectionId: null, annotations: [], shapes: [], shapeSelectionIds: [], tool: 'select' }),

    /* ---------- 图元层写操作（T-11.1；模式与组件写操作一致） ---------- */

    addShape: (partial) => {
      const id = shapeUid();
      const type = partial.type;
      const base = SHAPE_DEFAULTS[type];
      const raw = {
        ...base,
        ...partial,
        id,
        x: partial.x ?? 80,
        y: partial.y ?? 80,
        rotation: partial.rotation ?? 0,
        visible: partial.visible ?? true,
        locked: false,
      };
      const shape = shapeSchema.parse(raw) as SceneShape; // 几何/样式越界在此拦截
      set({ shapes: [...get().shapes, shape] });
      return id;
    },

    updateShape: (id, patch) => {
      const target = get().shapes.find((s) => s.id === id);
      if (!target) return;
      const merged = { ...target, ...patch } as SceneShape;
      const parsed = shapeSchema.parse(merged) as SceneShape; // 非法样式抛 ZodError，状态不变
      set({ shapes: get().shapes.map((s) => (s.id === id ? parsed : s)) });
    },

    removeShape: (id) => {
      const rest = get().shapes.filter((s) => s.id !== id);
      if (rest.length === get().shapes.length) return;
      // 级联：锚定该图元的箭头/连线端点退化为 free（保留当前几何端点，S2/S3 拖拽可重接）
      const removed = get().shapes.find((s) => s.id === id);
      const shapes = rest.map((s) => {
        if (s.type !== 'arrow' && s.type !== 'line') return s;
        let changed = false;
        const anchors = { ...s.anchors };
        for (const end of ['start', 'end'] as const) {
          const a = anchors[end];
          if (a.kind === 'shape' && a.id === id) {
            anchors[end] = { kind: 'free' };
            changed = true;
          }
        }
        return changed ? ({ ...s, anchors } as SceneShape) : s;
      });
      set({
        shapes,
        shapeSelectionIds: get().shapeSelectionIds.filter((sid) => sid !== id),
      });
      void removed; // （锁定校验等后续扩展点）
    },

    selectShape: (id) => {
      if (id !== null) {
        const shape = get().shapes.find((s) => s.id === id);
        if (!shape || shape.locked) return;
        set({ shapeSelectionIds: [id], selectionId: null });
        return;
      }
      set({ shapeSelectionIds: [] });
    },

    toggleShapeSelection: (id) => {
      const shape = get().shapes.find((s) => s.id === id);
      if (!shape || shape.locked) return;
      const cur = get().shapeSelectionIds;
      set({
        shapeSelectionIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
        selectionId: null,
        componentSelectionIds: [], // T-7.3 与组件多选互斥
      });
    },

    selectShapes: (ids) => {
      const lock = new Set(get().shapes.filter((s) => s.locked).map((s) => s.id));
      const next = ids.filter((id) => !lock.has(id));
      set({ shapeSelectionIds: next, selectionId: next.length ? null : get().selectionId });
    },

    setTool: (tool) => {
      if (!(SHAPE_TOOLS as readonly string[]).includes(tool)) return;
      trace(`setTool ${tool}`);
      set({ tool });
    },

    moveShapeOrder: (id, dir) => {
      const shapes = [...get().shapes];
      const i = shapes.findIndex((s) => s.id === id);
      if (i < 0) return;
      const [item] = shapes.splice(i, 1);
      if (!item) return;
      const j =
        dir === 'front' ? shapes.length
        : dir === 'back' ? 0
        : dir === 'forward' ? Math.min(shapes.length, i + 1)
        : Math.max(0, i - 1);
      shapes.splice(j, 0, item);
      set({ shapes });
    },

    groupShapes: (ids) => {
      if (ids.length < 2) return null;
      const gid = `sg${++groupSeq}`;
      const wanted = new Set(ids);
      set({
        shapes: get().shapes.map((s) => (wanted.has(s.id) ? ({ ...s, group: gid } as SceneShape) : s)),
      });
      return gid;
    },

    ungroupShapes: (ids) => {
      const wanted = new Set(ids);
      set({
        shapes: get().shapes.map((s) => {
          if (!wanted.has(s.id) || !s.group) return s;
          const rest = { ...s };
          delete rest.group;
          return rest as SceneShape;
        }),
      });
    },
  }));
}

/** 应用默认单例（T-1.6 React 侧使用）；T-2.1 起全部写操作自动入撤销/重做历史栈 */
export const sceneStore = createSceneStore();

/** 单例历史栈：UI 快捷键（Ctrl/Cmd+Z / Ctrl+Shift+Z）与撤销重做入口 */
export const sceneHistory = attachHistory(sceneStore);
