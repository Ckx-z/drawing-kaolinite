/**
 * 机理图图元绘制层 —— T-11.1
 *
 * 纯 Canvas 2D 绘制（无 React/three 依赖），与 annotations/draw.ts 同构：
 * 同一函数服务交互叠加层与导出合成（尺寸由调用方传入），导出位置与屏幕一致。
 * 坐标空间：叠加形态下图元层坐标 == 视口逻辑像素（ctx 已按 dpr scale，
 * 调用方保证）；纯 2D 形态（T-11.6）由调用方先 setTransform(view) 再进入本层。
 *
 * 端点解析（resolveEndpoints，纯函数可单测）：
 *  - free：几何端点 (x,y) → (x+w,y+h)；
 *  - shape：目标图元包围盒边缘最近点（锚定图元被删时 store 已退化 free）；
 *  - component：组件原点（transform.position 世界坐标）经 project 投影 →
 *    随视角实时跟随；被裁剪/转到背后时夹到视口边缘（截断提示由调用方判定）。
 */
import type { ProjectionResult } from '../annotations/draw';
import type { ArrowShape, LineShape, SceneShape, ShapeAnchor } from '../../core/shapes/schema';
import { shapeDraft } from './draft';

export interface ShapeEndpoint {
  x: number;
  y: number;
  /** component 锚定被视锥裁剪时 false（绘制端点夹边 + 虚线提示） */
  visible: boolean;
}

export interface ShapeDrawContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  shapes: SceneShape[];
  /** 世界坐标 → 视口像素（component 锚定解析；纯 2D 形态可缺省） */
  project?: (p: [number, number, number]) => ProjectionResult;
  /** 组件表（component 锚定查找；SceneEntry 形状兼容：id + transform.position） */
  components?: Array<{ id: string; transform: { position: [number, number, number] } }>;
  /** 选中图元 id：交互层画选中框 + 手柄；导出不传 */
  selectionId?: string | null;
}

/* ---------- 几何工具（hit.ts / 单测复用） ---------- */

/** 归一化包围盒（w/h 允许负值 = 拖拽方向任意；绘制/命中统一用正向框） */
export function normBox(s: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return {
    x: s.w < 0 ? s.x + s.w : s.x,
    y: s.h < 0 ? s.y + s.h : s.y,
    w: Math.abs(s.w),
    h: Math.abs(s.h),
  };
}

/** 点到矩形边缘最近点（在矩形内部时投影到最近边） */
export function nearestEdgePoint(b: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): { x: number; y: number } {
  const inside = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  if (!inside) {
    return { x: Math.min(Math.max(p.x, b.x), b.x + b.w), y: Math.min(Math.max(p.y, b.y), b.y + b.h) };
  }
  // 内部：到四边距离取最小，投影到该边
  const dl = p.x - b.x;
  const dr = b.x + b.w - p.x;
  const dt = p.y - b.y;
  const db = b.y + b.h - p.y;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return { x: b.x, y: p.y };
  if (m === dr) return { x: b.x + b.w, y: p.y };
  if (m === dt) return { x: p.x, y: b.y };
  return { x: p.x, y: b.y + b.h };
}

/** 单端点解析 */
export function resolveEndpoint(
  anchor: ShapeAnchor,
  fallback: { x: number; y: number },
  shapes: SceneShape[],
  components: ShapeDrawContext['components'],
  project: ShapeDrawContext['project'],
  width: number,
  height: number,
): ShapeEndpoint {
  if (anchor.kind === 'free') return { x: fallback.x, y: fallback.y, visible: true };
  if (anchor.kind === 'shape') {
    const target = shapes.find((s) => s.id === anchor.id);
    if (!target) return { x: fallback.x, y: fallback.y, visible: true }; // 目标缺失退几何端点
    if (anchor.side) {
      const b = normBox(target);
      const pt =
        anchor.side === 'left' ? { x: b.x, y: b.y + b.h / 2 }
        : anchor.side === 'right' ? { x: b.x + b.w, y: b.y + b.h / 2 }
        : anchor.side === 'top' ? { x: b.x + b.w / 2, y: b.y }
        : { x: b.x + b.w / 2, y: b.y + b.h };
      return { ...pt, visible: true };
    }
    return { ...nearestEdgePoint(normBox(target), fallback), visible: true };
  }
  // component：组件原点世界坐标投影（随视角跟随）
  const comp = components?.find((c) => c.id === anchor.id);
  if (!comp || !project) return { x: fallback.x, y: fallback.y, visible: true };
  const p = project(comp.transform.position);
  if (p.visible) return { x: p.x, y: p.y, visible: true };
  // 被裁剪/在背后：夹到视口边缘（留 16px 边距），调用方按 visible 画截断样式
  const M = 16;
  return {
    x: Math.min(Math.max(p.x, M), width - M),
    y: Math.min(Math.max(p.y, M), height - M),
    visible: false,
  };
}

/** 双端图元（arrow/line）端点解析 */
export function resolveLineEnds(
  s: ArrowShape | LineShape,
  c: Pick<ShapeDrawContext, 'shapes' | 'components' | 'project' | 'width' | 'height'>,
): { start: ShapeEndpoint; end: ShapeEndpoint } {
  return {
    start: resolveEndpoint(s.anchors.start, { x: s.x, y: s.y }, c.shapes, c.components, c.project, c.width, c.height),
    end: resolveEndpoint(s.anchors.end, { x: s.x + s.w, y: s.y + s.h }, c.shapes, c.components, c.project, c.width, c.height),
  };
}

/* ---------- 绘制 ---------- */

const SEL_COLOR = '#3b82f6';
const HANDLE_SIZE = 7;

export function drawShapes(c: ShapeDrawContext): void {
  for (const s of c.shapes) {
    if (s.visible === false) continue;
    switch (s.type) {
      case 'rect':
        drawRect(c, s);
        break;
      case 'ellipse':
        drawEllipse(c, s);
        break;
      case 'text':
        drawText(c, s);
        break;
      case 'arrow':
        drawArrow(c, s, true);
        break;
      case 'line':
        drawArrow(c, s, false);
        break;
    }
  }
  // 选中态最后画（置顶）
  const sel = c.shapes.find((s) => s.id === c.selectionId && s.visible !== false);
  if (sel) drawSelection(c, sel);
}

function applyDash(ctx: CanvasRenderingContext2D, s: SceneShape): void {
  if (s.dash === 'dashed') ctx.setLineDash([7, 5]);
}

function drawRect(c: ShapeDrawContext, s: SceneShape): void {
  const { ctx } = c;
  const b = normBox(s);
  ctx.save();
  ctx.lineWidth = s.lineWidth;
  ctx.strokeStyle = s.stroke;
  applyDash(ctx, s);
  if (s.rotation) {
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.rotate((s.rotation * Math.PI) / 180);
    ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  }
  if (s.fill !== 'none') {
    ctx.fillStyle = s.fill;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

function drawEllipse(c: ShapeDrawContext, s: SceneShape): void {
  const { ctx } = c;
  const b = normBox(s);
  ctx.save();
  ctx.lineWidth = s.lineWidth;
  ctx.strokeStyle = s.stroke;
  applyDash(ctx, s);
  ctx.beginPath();
  ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, (s.rotation * Math.PI) / 180, 0, Math.PI * 2);
  if (s.fill !== 'none') {
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function drawText(c: ShapeDrawContext, s: Extract<SceneShape, { type: 'text' }>): void {
  const { ctx } = c;
  ctx.save();
  ctx.font = `${s.fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = s.color;
  ctx.textBaseline = 'top';
  const lines = s.text.split('\n');
  const x = s.align === 'center' ? normBox(s).x + normBox(s).w / 2 : normBox(s).x;
  ctx.textAlign = s.align === 'center' ? 'center' : 'left';
  lines.forEach((ln, i) => {
    const y = normBox(s).y + i * (s.fontSize * 1.3);
    if (s.outline) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(ln, x, y);
    }
    ctx.fillText(ln, x, y);
  });
  ctx.restore();
}

function drawArrow(c: ShapeDrawContext, s: ArrowShape | LineShape, withHead: boolean): void {
  const { ctx } = c;
  const ends = resolveLineEnds(s, c);
  const { start: a, end: b } = ends;
  ctx.save();
  ctx.lineWidth = s.lineWidth;
  ctx.strokeStyle = s.stroke;
  applyDash(ctx, s);
  // 裁剪端点（锚定组件转到背后）：虚线提示连接"悬空"
  if (!a.visible || !b.visible) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  if (withHead) {
    const head = 'headSize' in s ? s.headSize : 10;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = s.stroke;
    ctx.fill();
  }
  // 锚定端点小圆（free 端不画）
  ctx.fillStyle = s.stroke;
  for (const [anchor, pt] of [
    [s.anchors.start, a],
    [s.anchors.end, b],
  ] as Array<[ShapeAnchor, ShapeEndpoint]>) {
    if (anchor.kind === 'free') continue;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 选中态：虚线包围框 + 8 手柄（nw n ne e se s sw w） */
export function shapeHandles(s: SceneShape): Array<{ id: string; x: number; y: number; cursor: string }> {
  const b = normBox(s);
  const { x, y, w, h } = b;
  return [
    { id: 'nw', x, y, cursor: 'nwse-resize' },
    { id: 'n', x: x + w / 2, y, cursor: 'ns-resize' },
    { id: 'ne', x: x + w, y, cursor: 'nesw-resize' },
    { id: 'e', x: x + w, y: y + h / 2, cursor: 'ew-resize' },
    { id: 'se', x: x + w, y: y + h, cursor: 'nwse-resize' },
    { id: 's', x: x + w / 2, y: y + h, cursor: 'ns-resize' },
    { id: 'sw', x, y: y + h, cursor: 'nesw-resize' },
    { id: 'w', x, y: y + h / 2, cursor: 'ew-resize' },
  ];
}

function drawSelection(c: ShapeDrawContext, s: SceneShape): void {
  const { ctx } = c;
  let b = normBox(s);
  if (s.type === 'arrow' || s.type === 'line') {
    // 连线类：用两端点解析结果的包围盒（锚定时框跟随实际端点）
    const ends = resolveLineEnds(s, c);
    const x1 = Math.min(ends.start.x, ends.end.x);
    const y1 = Math.min(ends.start.y, ends.end.y);
    b = { x: x1 - 4, y: y1 - 4, w: Math.abs(ends.end.x - ends.start.x) + 8, h: Math.abs(ends.end.y - ends.start.y) + 8 };
  }
  ctx.save();
  ctx.strokeStyle = SEL_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  for (const hd of shapeHandles(s)) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = SEL_COLOR;
    ctx.lineWidth = 1.5;
    ctx.fillRect(hd.x - HANDLE_SIZE / 2, hd.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(hd.x - HANDLE_SIZE / 2, hd.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }
  ctx.restore();
}

/** 绘制工具橡皮筋预览（overlay rAF 循环调用） */
export function drawDraft(ctx: CanvasRenderingContext2D): void {
  const d = shapeDraft.current;
  if (!d) return;
  const x = Math.min(d.x0, d.x1);
  const y = Math.min(d.y0, d.y1);
  const w = Math.abs(d.x1 - d.x0);
  const h = Math.abs(d.y1 - d.y0);
  ctx.save();
  ctx.strokeStyle = 'rgba(59,130,246,0.9)';
  ctx.fillStyle = 'rgba(59,130,246,0.08)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  if (d.tool === 'rect') {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  } else if (d.tool === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // arrow / line：起点 → 当前点
    ctx.beginPath();
    ctx.moveTo(d.x0, d.y0);
    ctx.lineTo(d.x1, d.y1);
    ctx.stroke();
    // text：框代理
    if (d.tool === 'text') ctx.strokeRect(x, y, Math.max(w, 12), Math.max(h, 18));
  }
  ctx.restore();
}
