/**
 * 绘制橡皮筋状态（独立模块避免 draw ↔ interaction 循环依赖）
 * interaction 写入，overlay rAF 循环读取绘制。
 */
import type { ShapeTool } from '../../core/shapes/schema';

export interface ShapeDraft {
  tool: ShapeTool;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const shapeDraft: { current: ShapeDraft | null } = { current: null };

/** 对齐参考线（T-11.7）：拖拽时 interaction 写入（图元层坐标），overlay 画洋红线 */
export interface GuideLine {
  axis: 'v' | 'h';
  at: number;
}
export const shapeGuides: { current: GuideLine[] } = { current: [] };
