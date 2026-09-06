/**
 * 渲染同步绑定 —— T-1.5
 *
 * 订阅 sceneStore，把状态差异同步到渲染端（RendererService 或测试替身）：
 *  - 新增/删除/显隐/选择/变换：即时同步；
 *  - 参数变化 → 几何重建：rAF 节流合并（同一帧多次滑块更新只重建一次）。
 * 调度器可注入（Node 单测注入手动 flush，不依赖 requestAnimationFrame）。
 * 状态层不直接 import three —— RendererLike 只描述本绑定用到的方法。
 */
import type { StoreApi } from 'zustand/vanilla';
import type { PaletteSetting, Transform } from '../core/types';
import type { SceneEntry, SceneState } from './sceneStore';

export interface RendererLike {
  addComponent: (comp: SceneEntry) => void;
  rebuildComponent: (comp: SceneEntry) => void;
  removeComponent: (id: string) => void;
  setComponentVisible: (id: string, visible: boolean) => void;
  setComponentTransform: (id: string, transform: Transform) => void;
  setSelection: (id: string | null) => void;
  /** T-4.2 色板同步（可选：旧测试替身未实现时跳过） */
  setPalette?: (p: PaletteSetting) => void;
}

export interface BindOptions {
  /** 默认 requestAnimationFrame；单测注入手动调度 */
  schedule?: (cb: () => void) => number;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function bindRenderer(
  store: StoreApi<SceneState>,
  svc: RendererLike,
  opts?: BindOptions,
): () => void {
  const schedule = opts?.schedule ?? ((cb: () => void) => requestAnimationFrame(cb));

  // 初始全量同步（T-1.6 挂载画布时调用）
  let prev = new Map(store.getState().components.map((c) => [c.id, c]));
  for (const c of prev.values()) svc.addComponent(c);
  svc.setSelection(store.getState().selectionId);
  let prevPalette = store.getState().palette;
  svc.setPalette?.(prevPalette);

  let prevSelection = store.getState().selectionId;
  const dirty = new Set<string>();
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    const current = store.getState().components;
    for (const id of dirty) {
      const comp = current.find((c) => c.id === id);
      if (comp) svc.rebuildComponent(comp); // 已被删除的 id 自然跳过
    }
    dirty.clear();
  };

  const unsubscribe = store.subscribe((state) => {
    const next = new Map(state.components.map((c) => [c.id, c]));

    for (const id of prev.keys()) {
      if (!next.has(id)) {
        svc.removeComponent(id);
        dirty.delete(id);
      }
    }
    for (const [id, comp] of next) {
      const p = prev.get(id);
      if (!p) {
        svc.addComponent(comp);
        continue;
      }
      if (!same(p.params, comp.params)) dirty.add(id);
      if (p.visible !== comp.visible) svc.setComponentVisible(id, comp.visible);
      if (!same(p.transform, comp.transform)) svc.setComponentTransform(id, comp.transform);
    }
    if (state.selectionId !== prevSelection) {
      svc.setSelection(state.selectionId);
      prevSelection = state.selectionId;
    }
    if (state.palette !== prevPalette) {
      svc.setPalette?.(state.palette);
      prevPalette = state.palette;
    }

    prev = next;
    if (dirty.size && !scheduled) {
      scheduled = true;
      schedule(flush);
    }
  });

  return unsubscribe;
}
