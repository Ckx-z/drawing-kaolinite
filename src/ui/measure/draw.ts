/**
 * 键长/键角测量绘制（2026-09-13）——屏幕 rAF 叠画与位图导出共用。
 * 坐标由调用方投影（projectToScreen），本层只画：拾取高亮圈 / 键长线+中点标签 /
 * 键角折线+顶点弧+标签。标签文本 = measureLabel（世界坐标算好传入）。
 */
import type { AtomRef, Measurement, Vec3 } from '../../core/measures';
import { measureLabel } from '../../core/measures';

export interface MeasureDrawCtx {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** 世界坐标 → 屏幕（visible=false 的点整条跳过） */
  project: (p: Vec3) => { x: number; y: number; visible: boolean };
  /** 原子引用 → 世界坐标（组件删除/越界返回 null，该项跳过） */
  resolve: (ref: AtomRef) => Vec3 | null;
  picks: AtomRef[];
  measurements: Measurement[];
}

const COLOR = '#0e7490'; // 深青：与标注/图元色系区分
const PICK_COLOR = '#f59e0b';

function labelBadge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.font = '600 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const h = 18;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

/** 测量层入口（无有效点时静默跳过） */
export function drawMeasurements(o: MeasureDrawCtx): void {
  const { ctx, project, resolve, picks, measurements } = o;

  // 拾取高亮圈
  for (const p of picks) {
    const w = resolve(p);
    if (!w) continue;
    const s = project(w);
    if (!s.visible) continue;
    ctx.strokeStyle = PICK_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const m of measurements) {
    const pts = m.picks.map(resolve).filter((v): v is Vec3 => v !== null);
    if (pts.length !== m.picks.length) continue; // 有原子失效 → 整条隐藏
    const scr = pts.map(project);
    if (scr.some((s) => !s.visible)) continue;
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([]);

    if (m.kind === 'bond') {
      ctx.beginPath();
      ctx.moveTo(scr[0]!.x, scr[0]!.y);
      ctx.lineTo(scr[1]!.x, scr[1]!.y);
      ctx.stroke();
      const mx = (scr[0]!.x + scr[1]!.x) / 2;
      const my = (scr[0]!.y + scr[1]!.y) / 2;
      labelBadge(ctx, mx, my - 12, measureLabel('bond', pts));
    } else {
      // 键角：折线 + 顶点小弧
      const a = scr[0]!;
      const v = scr[1]!;
      const c = scr[2]!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(v.x, v.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      const a1 = Math.atan2(a.y - v.y, a.x - v.x);
      const a2 = Math.atan2(c.y - v.y, c.x - v.x);
      ctx.beginPath();
      ctx.arc(v.x, v.y, 14, a1, a2, Math.abs(a2 - a1) > Math.PI);
      ctx.stroke();
      // 标签放顶点外侧（两臂夹角平分线反向）
      const mid = (a1 + a2) / 2 + (Math.abs(a2 - a1) > Math.PI ? Math.PI : 0);
      labelBadge(ctx, v.x + Math.cos(mid) * 34, v.y + Math.sin(mid) * 34, measureLabel('angle', pts));
    }
  }
}
