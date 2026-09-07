/**
 * 标注层绘制 —— T-4.4
 *
 * 纯 Canvas 2D 绘制（无 React/three 依赖），同一函数服务三处：
 *   1. SceneCanvas 叠加 canvas（交互显示，rAF 重绘随相机同步）；
 *   2. 位图导出合成（PNG/TIFF/PDF 离屏帧上叠画）；
 *   3. 尺寸由调用方传入（交互 = 画布尺寸，导出 = 离屏尺寸）→ 投影换算后
 *      位置天然一致；字号为屏幕空间像素 → 不随相机缩放变化（验收项）。
 *
 * 比例尺：按当前缩放从 {1,2,5,10,20,50,100}Å 中选取屏幕长度 ≤160px 的最大刻度，
 * 标注以 nm 计（1nm = 10Å）。
 */

export interface DrawAnnotation {
  type: 'scalebar' | 'label';
  text?: string;
  worldLen?: number;
  target?: [number, number, number];
  offset?: [number, number];
  visible?: boolean;
}

export interface ProjectionResult {
  x: number;
  y: number;
  visible: boolean;
}

export interface AnnotationDrawContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** 世界坐标 → 屏幕像素（含视锥/后方剔除标记） */
  project: (p: [number, number, number]) => ProjectionResult;
  /** 目标点处每 Å 的像素数（比例尺刻度换算） */
  pxPerAAtTarget: number;
  annotations: DrawAnnotation[];
}

const SCALEBAR_CANDIDATES = [1, 2, 5, 10, 20, 50, 100];
const MAX_SCALEBAR_PX = 160;
const MARGIN = 24;

const fmtNm = (ang: number): string =>
  ang >= 10 ? `${Math.round(ang / 10)} nm` : `${Math.round(ang) / 10} nm`;

export function drawAnnotations(c: AnnotationDrawContext): void {
  for (const a of c.annotations) {
    if (a.visible === false) continue;
    if (a.type === 'scalebar') drawScaleBar(c, a.worldLen);
    else if (a.type === 'label') drawLabel(c, a);
  }
}

function drawScaleBar(c: AnnotationDrawContext, worldLen?: number): void {
  const { ctx, height: H, pxPerAAtTarget } = c;
  let len = worldLen;
  if (!len) {
    len = 0;
    for (const cand of SCALEBAR_CANDIDATES) {
      if (cand * pxPerAAtTarget <= MAX_SCALEBAR_PX) len = cand;
    }
  }
  if (!len) return;
  const px = len * pxPerAAtTarget;
  if (px < 4) return;

  const x1 = MARGIN;
  const y = H - MARGIN;
  const x2 = x1 + px;

  ctx.save();
  ctx.strokeStyle = '#2b2f33';
  ctx.fillStyle = '#2b2f33';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y - 5);
  ctx.lineTo(x1, y + 5);
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.moveTo(x2, y - 5);
  ctx.lineTo(x2, y + 5);
  ctx.stroke();

  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(fmtNm(len), (x1 + x2) / 2, y - 10);
  ctx.restore();
}

function drawLabel(c: AnnotationDrawContext, a: DrawAnnotation): void {
  if (!a.target || !a.text) return;
  const { ctx } = c;
  const p = c.project(a.target);
  if (!p.visible) return;
  const [dx, dy] = a.offset ?? [14, -14];
  const tx = p.x + dx;
  const ty = p.y + dy;

  ctx.save();
  // 引线：锚点 → 文本起始
  ctx.strokeStyle = '#2b2f33';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(tx - 2, ty + 2);
  ctx.stroke();
  // 锚点小圆
  ctx.fillStyle = '#2b2f33';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // 文本（白描边提升可读性）
  ctx.font = `${a.text.length > 20 ? 11 : 13}px system-ui, sans-serif`;
  ctx.textAlign = dx < 0 ? 'right' : 'left';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeText(a.text, tx, ty);
  ctx.fillStyle = '#1a1d21';
  ctx.fillText(a.text, tx, ty);
  ctx.restore();
}
