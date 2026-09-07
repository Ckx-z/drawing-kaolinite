/**
 * 分组 SVG 矢量导出 —— T-5.3（PPT 转形状核心卖点）
 *
 * 实现说明：不用 THREE.SVGRenderer——其 Projector 只遍历几何三角形，不支持
 * InstancedMesh（本项目上万原子全靠实例化）。改为从原子/键数据直接生成 SVG：
 *   - 原子 → <circle>（透视投影 + 深度相关半径），键 → <line>（圆头端帽）；
 *   - 画家算法：组件间按包围深度远→近排序，组件内图元按深度排序；
 *   - 每组件包裹 <g id="组件名">（与图层面板命名一致）→ PPT"转换为形状→取消组合"
 *     后逐组件改色/移动；
 *   - 平色填充 + 均匀描边 = 线稿档画风（逼真光照不可矢量化的诚实取舍，D04）；
 *   - 纯函数：相机与图元数据入参，Node 可单测。
 */

import * as THREE from 'three';

export interface SvgAtom {
  el: string;
  /** 世界坐标 */
  x: number;
  y: number;
  z: number;
  /** 显示半径（世界单位，已含组件缩放） */
  r: number;
}

export interface SvgComponentInput {
  name: string;
  visible: boolean;
  atoms: SvgAtom[];
  /** 原子索引对 */
  bonds: Array<[number, number]>;
  /** 键半径（世界单位） */
  bondRadius: number;
  /** 键颜色（SVG fill/stroke 值） */
  bondColor: string;
}

export interface SvgCameraLike {
  /** 透视相机（需已完成 lookAt/位置设置） */
  fov: number;
  near: number;
  updateMatrixWorld(): void;
  matrixWorld: THREE.Matrix4;
  matrixWorldInverse: THREE.Matrix4;
  projectionMatrix: THREE.Matrix4;
}

export interface SvgExportOptions {
  width: number;
  height: number;
  /** 画布背景（缺省透明） */
  background?: string;
  /** 描边宽度（px，均匀描边） */
  strokeWidth?: number;
  /** 描边颜色 */
  strokeColor?: string;
  /** 逐元素填充色（色板解析结果） */
  elementColors: Record<string, string>;
  /** 未知元素回退色 */
  fallbackColor?: string;
}

interface Primitive {
  depth: number; // 视空间 z（越负越远）
  svg: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sanitizeId = (s: string): string =>
  s.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '') || 'component';

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/** 生成场景 SVG 文本 */
export function sceneToSVG(
  components: SvgComponentInput[],
  camera: SvgCameraLike,
  opts: SvgExportOptions,
): string {
  const { width: W, height: H } = opts;
  const strokeWidth = opts.strokeWidth ?? 1;
  const strokeColor = opts.strokeColor ?? '#2b2f33';

  // 相机矩阵（视空间 + 投影）
  const cam = camera as unknown as THREE.PerspectiveCamera;
  cam.updateMatrixWorld();
  const viewInv = camera.matrixWorldInverse;
  viewInv.copy(cam.matrixWorld).invert();
  const proj = camera.projectionMatrix;
  const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
  const pv = new THREE.Matrix4().multiplyMatrices(proj, viewInv);
  const v = new THREE.Vector3();

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  );
  if (opts.background) {
    parts.push(`<rect width="${W}" height="${H}" fill="${opts.background}"/>`);
  }

  // 组件间排序：按组件图元的最大深度（最远图元）远→近
  const compOrder = components
    .map((c, idx) => {
      let maxDepth = -Infinity;
      for (const a of c.atoms) {
        v.set(a.x, a.y, a.z).applyMatrix4(viewInv);
        if (v.z > maxDepth) maxDepth = v.z;
      }
      return { idx, depth: maxDepth };
    })
    .sort((a, b) => a.depth - b.depth); // 视空间 z 越小越远 → 远的先画

  for (const { idx } of compOrder) {
    const c = components[idx];
    if (!c.visible || !c.atoms.length) continue;
    const prims: Primitive[] = [];

    // 键：中点深度排序（线宽按中点距离缩放）
    for (const [i, j] of c.bonds) {
      const a = c.atoms[i];
      const b = c.atoms[j];
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
      v.set(mx, my, mz).applyMatrix4(viewInv);
      if (-v.z < cam.near) continue;
      const mid = new THREE.Vector3(mx, my, mz).project(cam);
      if (mid.z < -1 || mid.z > 1) continue;
      const wpx = Math.max(1, 2 * c.bondRadius * (H / 2 / (-v.z * tanHalf)));
      const ax = new THREE.Vector3(a.x, a.y, a.z).project(cam);
      const bx = new THREE.Vector3(b.x, b.y, b.z).project(cam);
      prims.push({
        depth: v.z,
        svg:
          `<line x1="${fmt(((ax.x + 1) / 2) * W)}" y1="${fmt(((1 - ax.y) / 2) * H)}" ` +
          `x2="${fmt(((bx.x + 1) / 2) * W)}" y2="${fmt(((1 - bx.y) / 2) * H)}" ` +
          `stroke="${c.bondColor}" stroke-width="${fmt(wpx)}" stroke-linecap="round"/>`,
      });
    }

    // 原子：深度相关半径
    for (const a of c.atoms) {
      v.set(a.x, a.y, a.z).applyMatrix4(viewInv);
      const dist = -v.z;
      if (dist < cam.near) continue; // 相机后方剔除
      const ndc = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(pv);
      if (ndc.z < -1 || ndc.z > 1) continue; // 视锥外
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue; // 画布横向/纵向越界
      const sx = ((ndc.x + 1) / 2) * W;
      const sy = ((1 - ndc.y) / 2) * H;
      const rpx = a.r * (H / 2 / (dist * tanHalf));
      const fill = opts.elementColors[a.el] ?? opts.fallbackColor ?? '#9AA0A6';
      prims.push({
        depth: v.z,
        svg:
          `<circle cx="${fmt(sx)}" cy="${fmt(sy)}" r="${fmt(rpx)}" ` +
          `fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`,
      });
    }

    prims.sort((a, b) => a.depth - b.depth); // 远 → 近
    parts.push(`<g id="${esc(sanitizeId(c.name))}">`);
    parts.push(...prims.map((p) => p.svg));
    parts.push(`</g>`);
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/* ---------- 标注层（T-4.4）：与位图同一投影 → 位置一致 ---------- */

export interface SvgAnnotation {
  type: 'scalebar' | 'label';
  text?: string;
  worldLen?: number;
  target?: [number, number, number];
  offset?: [number, number];
  visible?: boolean;
}

export interface SvgAnnotationOptions {
  width: number;
  height: number;
  /** 世界 → 像素（与组件图元同一投影链） */
  project: (p: [number, number, number]) => { x: number; y: number; visible: boolean };
  pxPerA: number;
  annotations: SvgAnnotation[];
  strokeWidth?: number;
}

const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100];
const SB_MAX_PX = 160;
const SB_MARGIN = 24;

/** 生成标注 SVG 片段（比例尺 + 文本引线），字体大小为屏幕空间像素（不随缩放变化） */
export function annotationsToSVG(o: SvgAnnotationOptions): string {
  const { width: W, height: H } = o;
  const parts: string[] = [];
  for (const a of o.annotations) {
    if (a.visible === false) continue;
    if (a.type === 'scalebar') {
      let len = a.worldLen ?? 0;
      for (const cand of SCALE_STEPS) if (cand * o.pxPerA <= SB_MAX_PX) len = cand;
      if (!len) continue;
      const px = len * o.pxPerA;
      if (px < 4) continue;
      const x1 = SB_MARGIN;
      const y = H - SB_MARGIN;
      const x2 = x1 + px;
      const nm = len >= 10 ? Math.round(len / 10) : Math.round(len * 10) / 100;
      parts.push(
        `<g id="scalebar">` +
          `<line x1="${fmt(x1)}" y1="${fmt(y)}" x2="${fmt(x2)}" y2="${fmt(y)}" stroke="#2b2f33" stroke-width="2"/>` +
          `<line x1="${fmt(x1)}" y1="${fmt(y - 5)}" x2="${fmt(x1)}" y2="${fmt(y + 5)}" stroke="#2b2f33" stroke-width="2"/>` +
          `<line x1="${fmt(x2)}" y1="${fmt(y - 5)}" x2="${fmt(x2)}" y2="${fmt(y + 5)}" stroke="#2b2f33" stroke-width="2"/>` +
          `<text x="${fmt((x1 + x2) / 2)}" y="${fmt(y - 10)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#2b2f33">${esc(nm + ' nm')}</text>` +
          `</g>`,
      );
    } else if (a.type === 'label' && a.target && a.text) {
      const p = o.project(a.target);
      if (!p.visible) continue;
      const [dx, dy] = a.offset ?? [14, -14];
      const tx = p.x + dx;
      const ty = p.y + dy;
      const anchor = dx < 0 ? 'end' : 'start';
      parts.push(
        `<g id="label-${esc(a.text).slice(0, 8)}">` +
          `<line x1="${fmt(p.x)}" y1="${fmt(p.y)}" x2="${fmt(tx - 2)}" y2="${fmt(ty + 2)}" stroke="#2b2f33" stroke-width="1"/>` +
          `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="2.5" fill="#2b2f33"/>` +
          `<text x="${fmt(tx)}" y="${fmt(ty)}" text-anchor="${anchor}" font-family="system-ui, sans-serif" font-size="13" fill="#1a1d21" stroke="white" stroke-width="3" paint-order="stroke">${esc(a.text)}</text>` +
          `</g>`,
      );
    }
  }
  void W;
  return parts.join('\n');
}
