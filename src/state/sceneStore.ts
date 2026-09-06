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
import type {
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
  /** 设置色板（整体替换；渲染重着色由调用方经 rendererRef 触发或绑定层同步） */
  setPalette: (p: PaletteSetting) => void;
  /** 新增组件（默认参数 + 类型命名），返回新 id */
  addComponent: (type: ComponentType, opts?: AddComponentOptions) => string;
  removeComponent: (id: string) => void;
  select: (id: string | null) => void;
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
}

export type SceneStore = StoreApi<SceneState>;

export function createSceneStore(): SceneStore {
  let seq = 0;
  let groupSeq = 0;
  const uid = (): string => `c${++seq}`;

  return createStore<SceneState>()((set, get) => ({
    components: [],
    selectionId: null,
    palette: {},

    setPalette: (p) => set({ palette: p }),

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
      set({
        components: rest,
        selectionId: get().selectionId === id ? null : get().selectionId,
      });
    },

    select: (id) => {
      if (id !== null) {
        // T-3.3：锁定组件点击不选中（画布拾取与图层面板统一屏蔽）
        const comp = get().components.find((c) => c.id === id);
        if (!comp || comp.locked) return;
      }
      set({ selectionId: id });
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
      // T-3.3 组感知：位置/旋转取增量，缩放取比值，同步到同组全部成员
      const dPos = t.position.map((v, i) => v - comp.transform.position[i]) as Transform['position'];
      const dRot = t.rotation.map((v, i) => v - comp.transform.rotation[i]) as Transform['rotation'];
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
      return sceneDocumentSchema.parse({
        format: SCENE_FORMAT,
        saved: new Date().toISOString(),
        components: get().components.map((c) => ({ ...c, locked: c.locked ?? false })),
        ...(palette.id || palette.overrides ? { palette } : {}),
      });
    },

    loadScene: (raw) => {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const doc = normalizeScene(deserializeScene(text));
      set({
        components: doc.components as SceneEntry[],
        selectionId: null,
        palette: doc.palette ?? {}, // T-4.2：旧场景文件无 palette → 回默认色板
      });
    },

    clear: () => set({ components: [], selectionId: null }),
  }));
}

/** 应用默认单例（T-1.6 React 侧使用）；T-2.1 起全部写操作自动入撤销/重做历史栈 */
export const sceneStore = createSceneStore();

/** 单例历史栈：UI 快捷键（Ctrl/Cmd+Z / Ctrl+Shift+Z）与撤销重做入口 */
export const sceneHistory = attachHistory(sceneStore);
