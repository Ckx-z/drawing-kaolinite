/**
 * 纯 2D 示意图模式的视口变换（T-11.6）
 *
 * 图元数据存"图元层坐标"（叠加形态 == 视口逻辑像素；示意图形态由本 view
 * 承担 pan/zoom，数据不变——两形态同一套数据/绘制/命中/导出代码）。
 * 指针屏幕坐标 → 图元层坐标：(sx - panX) / zoom（见 interaction.toLayer）。
 * 视图状态不持久化（重开回到 identity）。
 */
import { createStore } from 'zustand/vanilla';

export interface ShapeViewState {
  panX: number;
  panY: number;
  zoom: number;
  /** T-11.7 对齐吸附开关（网格 + 边缘/中心参考线） */
  snap: boolean;
  setView: (v: Partial<Omit<ShapeViewState, 'setView' | 'resetView' | 'setSnap'>>) => void;
  setSnap: (on: boolean) => void;
  resetView: () => void;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export const shapeViewStore = createStore<ShapeViewState>()((set) => ({
  panX: 0,
  panY: 0,
  zoom: 1,
  snap: true,
  setView: (v) =>
    set((s) => ({
      panX: v.panX ?? s.panX,
      panY: v.panY ?? s.panY,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom ?? s.zoom)),
    })),
  setSnap: (on) => set({ snap: on }),
  resetView: () => set({ panX: 0, panY: 0, zoom: 1 }),
}));

/** 屏幕像素 → 图元层坐标（interaction/命中统一入口） */
export function toLayerCoord(clientX: number, clientY: number, rectLeft: number, rectTop: number): { x: number; y: number } {
  const v = shapeViewStore.getState();
  return { x: (clientX - rectLeft - v.panX) / v.zoom, y: (clientY - rectTop - v.panY) / v.zoom };
}
