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
import type { AnyParams, ComponentType, SceneComponent, SceneDocument, Transform } from '../core/types';

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
  /** 新增组件（默认参数 + 类型命名），返回新 id */
  addComponent: (type: ComponentType, opts?: AddComponentOptions) => string;
  removeComponent: (id: string) => void;
  select: (id: string | null) => void;
  setVisibility: (id: string, visible: boolean) => void;
  /** 锁定占位（T-3.3 实现交互屏蔽） */
  toggleLock: (id: string) => void;
  /** 合并参数（整体经 componentSchema 校验，非法抛错且状态不变） */
  updateParams: (id: string, patch: Partial<AnyParams>) => void;
  /** 整体替换 transform（经 transformSchema 校验） */
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
  const uid = (): string => `c${++seq}`;

  return createStore<SceneState>()((set, get) => ({
    components: [],
    selectionId: null,

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
      if (id !== null && !get().components.some((c) => c.id === id)) return;
      set({ selectionId: id });
    },

    setVisibility: (id, visible) => {
      set({
        components: get().components.map((c) => (c.id === id ? { ...c, visible } : c)),
      });
    },

    toggleLock: (id) => {
      set({
        components: get().components.map((c) => (c.id === id ? { ...c, locked: !(c.locked ?? false) } : c)),
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
      const t = transformSchema.parse(transform); // 越界（如 scale<0.05）拦截
      set({
        components: get().components.map((c) => (c.id === id ? { ...c, transform: t } : c)),
      });
    },

    renameComponent: (id, name) => {
      if (!name.trim()) return;
      set({
        components: get().components.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)),
      });
    },

    toSceneDocument: () =>
      sceneDocumentSchema.parse({
        format: SCENE_FORMAT,
        saved: new Date().toISOString(),
        components: get().components.map((c) => ({ ...c, locked: c.locked ?? false })),
      }),

    loadScene: (raw) => {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const doc = normalizeScene(deserializeScene(text));
      set({
        components: doc.components as SceneEntry[],
        selectionId: null,
      });
    },

    clear: () => set({ components: [], selectionId: null }),
  }));
}

/** 应用默认单例（T-1.6 React 侧使用） */
export const sceneStore = createSceneStore();
