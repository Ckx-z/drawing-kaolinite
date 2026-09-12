/**
 * 图元命中检测 —— T-11.2（纯函数，Node 可单测）
 *
 * 命中优先级 = Z 序顶层优先（数组从后往前扫描）。
 * 连线/箭头按"点到线段距离 ≤ 线宽 + 容差"；框类含边框附近的边命中
 * （描边可点，纯填充内部也命中——与直觉一致）。
 */
import type { SceneShape } from '../../core/shapes/schema';
import { arrowCtrlPoint, nearestEdgePoint, normBox, resolveLineEnds, shapeHandles } from './draw';

export interface HitCtx {
  shapes: SceneShape[];
  components?: Array<{ id: string; transform: { position: [number, number, number] } }>;
  project?: (p: [number, number, number]) => { x: number; y: number; visible: boolean };
  width: number;
  height: number;
}

/** 点到线段距离（标准投影法） */
export function ptSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 单形状命中（tol = 额外容差 px） */
export function hitShape(s: SceneShape, px: number, py: number, ctx: Pick<HitCtx, 'components' | 'project' | 'width' | 'height'>, tol = 4): boolean {
  if (s.visible === false || s.locked) return false;
  const strokeTol = s.lineWidth / 2 + tol;
  if (s.type === 'arrow' || s.type === 'line') {
    const ends = resolveLineEnds(s, { shapes: [], components: ctx.components, project: ctx.project, width: ctx.width, height: ctx.height });
    const bow = 'bow' in s ? s.bow : 0;
    if (!bow) {
      return ptSegDist(px, py, ends.start.x, ends.start.y, ends.end.x, ends.end.y) <= strokeTol;
    }
    // 弧线：贝塞尔 16 段采样折线，逐段取最小距离（bow 几何与绘制 arrowCtrlPoint 同源）
    const q = arrowCtrlPoint(ends.start, ends.end, bow);
    let best = Infinity;
    let prev: { x: number; y: number } = ends.start;
    const N = 16;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const mt = 1 - t;
      const pt = {
        x: mt * mt * ends.start.x + 2 * mt * t * q.x + t * t * ends.end.x,
        y: mt * mt * ends.start.y + 2 * mt * t * q.y + t * t * ends.end.y,
      };
      best = Math.min(best, ptSegDist(px, py, prev.x, prev.y, pt.x, pt.y));
      prev = pt;
    }
    return best <= strokeTol;
  }
  const b = normBox(s);
  if (s.type === 'ellipse') {
    // 归一化椭圆方程（含线宽容差）
    const rx = b.w / 2 + strokeTol;
    const ry = b.h / 2 + strokeTol;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (px - (b.x + b.w / 2)) / rx;
    const ny = (py - (b.y + b.h / 2)) / ry;
    const inside = nx * nx + ny * ny;
    if (s.fill !== 'none') return inside <= 1;
    return inside <= 1; // 描边圈：整圈内部命中（空心点选边缘太难，v1 从宽）
  }
  // rect / text：包围盒（边框附近或内部）
  const inBox = px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
  if (!inBox) return false;
  if (s.fill !== 'none' && s.type === 'rect') return true;
  // 无填充：边框附近命中 OR 内部命中（v1 从宽：内部也命中，便于拖拽）
  return true;
}

/** 顶层优先命中；返回图元或 null */
export function hitTest(ctx: HitCtx, px: number, py: number): SceneShape | null {
  for (let i = ctx.shapes.length - 1; i >= 0; i--) {
    const s = ctx.shapes[i]!;
    if (s.visible === false) continue;
    if (hitShape(s, px, py, ctx)) return s;
  }
  return null;
}

/** 手柄命中（仅选中图元）：返回手柄 id 或 null */
export function hitHandle(s: SceneShape, px: number, py: number, tol = 7): string | null {
  for (const h of shapeHandles(s)) {
    if (Math.abs(px - h.x) <= tol && Math.abs(py - h.y) <= tol) return h.id;
  }
  return null;
}

/** 拖拽手柄时按手柄方向调整包围盒（锚定不动对侧边；w/h 允许变负，提交前归一化） */
export function applyHandle(
  s: SceneShape,
  handle: string,
  px: number,
  py: number,
): { x: number; y: number; w: number; h: number } {
  const b = normBox(s);
  let { x, y, w, h } = b;
  switch (handle) {
    case 'nw':
      w = b.x + b.w - px;
      h = b.y + b.h - py;
      x = px;
      y = py;
      break;
    case 'n':
      h = b.y + b.h - py;
      y = py;
      break;
    case 'ne':
      w = px - b.x;
      h = b.y + b.h - py;
      y = py;
      break;
    case 'e':
      w = px - b.x;
      break;
    case 'se':
      w = px - b.x;
      h = py - b.y;
      break;
    case 's':
      h = py - b.y;
      break;
    case 'sw':
      w = b.x + b.w - px;
      h = py - b.y;
      x = px;
      break;
    case 'w':
      w = b.x + b.w - px;
      x = px;
      break;
  }
  return { x, y, w: Math.abs(w) < 2 ? 2 : w, h: Math.abs(h) < 2 ? 2 : h };
}

/** 箭头端点命中（拖端点改锚定）：'start' | 'end' | null（容差 10px） */
export function hitEndpoint(s: SceneShape, px: number, py: number, ctx: Pick<HitCtx, 'components' | 'project' | 'width' | 'height'>, tol = 10): 'start' | 'end' | null {
  if (s.type !== 'arrow' && s.type !== 'line') return null;
  const ends = resolveLineEnds(s, { shapes: [], components: ctx.components, project: ctx.project, width: ctx.width, height: ctx.height });
  if (Math.hypot(px - ends.start.x, py - ends.start.y) <= tol) return 'start';
  if (Math.hypot(px - ends.end.x, py - ends.end.y) <= tol) return 'end';
  return null;
}

export { nearestEdgePoint };
