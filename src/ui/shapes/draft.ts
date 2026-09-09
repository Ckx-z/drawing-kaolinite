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
