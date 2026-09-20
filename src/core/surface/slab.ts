/**
 * Generic Crystal Miller Surface —— PHASE B（2026-09-20，任务书十六~二十四）
 *
 * CIF → Bulk（对称展开）→ Miller (h k l) 切割 → Slab。
 * **真实晶格数学，非视觉旋转伪造**：
 *  - 倒易格矢 G = h·a* + k·b* + l·c*（a* = 2π b×c/V …）→ 表面法向 ∝ G；
 *  - 表面重复矢量 u/v = 与 G 正交的最短直接晶格整数组合（i,j,k）·(h,k,l)=0
 *    ——由 a_i·a*_j = δ_ij 保证 t·G = n·(h,k,l)；
 *  - slab = 表面坐标系（x∥u, z∥normal）下按 z 窗口切割的周期平铺，
 *    x/y 按整数倍 u/v 折叠入窗（合法格矢平移），3D 容差去重。
 *
 * 科学边界（诚实声明，见 DECISIONS/STRUCTURE_BENCHMARK）：
 *  - termination：确定性 z0 切割（枚举原子层候选，默认取层索引 0），标记
 *    geometrySource='generated' 而非 reference——不宣称唯一正确表面；
 *  - 未做表面弛豫/缺陷修复/自动补氢——截断表面如实呈现；
 *  - 无完整周期 slab cell 重构（x/y 窗口折叠是可视化语义），不等同 DFT slab cell；
 *  - 确定性：同输入逐位同输出（无随机）。
 */
import { expandSymmetry, latticeVectors, parseCIF, computeBonds } from '../crystal';
import type { Atom } from '../geometry';
import { center } from '../crystal';

export interface MillerSlabParams {
  h: number;
  k: number;
  l: number;
  /** 表面 X/Y 尺寸（Å，沿 u/v 折叠窗口） */
  sizeX: number;
  sizeY: number;
  /** 切割厚度（Å，沿法向 z 窗口高度） */
  thickness: number;
  /** termination 候选索引（枚举原子层，确定性） */
  termination: number;
}

export interface SurfaceMeta {
  millerIndex: [number, number, number];
  /** 表面重复矢量（笛卡尔 Å）与长度 */
  u: [number, number, number];
  v: [number, number, number];
  uLen: number;
  vLen: number;
  /** z0 切割面高度候选数（termination 总数） */
  terminationCount: number;
  /** 表面系法向恒 [0,0,1]（切割定义） */
  normal: [number, number, number];
  /** 切割后组成 */
  composition: Record<string, number>;
  geometrySource: 'generated';
  relaxed: false;
}

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): number => Math.hypot(...a);
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * 表面重复矢量：与 (h,k,l) 正交的最短两条非平行直接晶格整数组合。
 * t = i·a1 + j·a2 + k·a3（笛卡尔）⊥ G ⟺ (i,j,k)·(h,k,l) = 0（倒易正交关系）。
 * 搜索 |i|,|j|,|k| ≤ 4（覆盖低指数全部常用面）；u 取最短，v 取与 u 不平行
 * 且 (u×v)·normal > 0（右手系）中最短者——确定性排序。
 */
export function surfaceRepeatVectors(
  cell: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number },
  h: number,
  k: number,
  l: number,
): { u: V3; v: V3; lattice: { a1: V3; a2: V3; a3: V3 } } {
  const L = latticeVectors(cell, false);
  const a1: V3 = [L.ax, L.ay, L.az];
  const a2: V3 = [L.bx, L.by, L.bz];
  const a3: V3 = [L.cx, L.cy, L.cz];
  // G ∝ a1* h + a2* k + a3* l（2π 因子不影响方向）
  const G = scale(
    [
      h * (cross(a2, a3)[0]) + k * (cross(a3, a1)[0]) + l * (cross(a1, a2)[0]),
      h * (cross(a2, a3)[1]) + k * (cross(a3, a1)[1]) + l * (cross(a1, a2)[1]),
      h * (cross(a2, a3)[2]) + k * (cross(a3, a1)[2]) + l * (cross(a1, a2)[2]),
    ],
    1,
  );
  const cands: Array<{ n: [number, number, number]; t: V3; len: number }> = [];
  const R = 4;
  for (let i = -R; i <= R; i++)
    for (let j = -R; j <= R; j++)
      for (let m = -R; m <= R; m++) {
        if (i === 0 && j === 0 && m === 0) continue;
        if (i * h + j * k + m * l !== 0) continue; // ⊥ G 的整数条件
        const t: V3 = [
          i * a1[0] + j * a2[0] + m * a3[0],
          i * a1[1] + j * a2[1] + m * a3[1],
          i * a1[2] + j * a2[2] + m * a3[2],
        ];
        cands.push({ n: [i, j, m], t, len: norm(t) });
      }
  cands.sort((x, y) => x.len - y.len || x.n[0] - y.n[0] || x.n[1] - y.n[1] || x.n[2] - y.n[2]);
  const u = cands[0]!;
  const nG = scale(G, 1 / (norm(G) || 1));
  let vBest = null as null | { t: V3; len: number };
  for (const c of cands) {
    if (c === u) continue;
    if (norm(cross(c.t, u.t)) < 1e-6) continue; // 与 u 平行
    if (dot(cross(u.t, c.t), nG) <= 0) continue; // 右手系（u × v ∥ +normal）
    vBest = c;
    break; // 已按长度排序 → 首个合法即最短
  }
  if (!vBest) throw new Error('未找到第二条表面重复矢量（Miller 指数异常）');
  return { u: u.t, v: vBest.t, lattice: { a1, a2, a3 } };
}

/**
 * Miller slab 生成（确定性）。原子 = 对称展开单胞 × 晶格平移平铺 → 表面坐标系
 * → z 窗口切割 + x/y 周期折叠 → 去重 → 居中。bonds 按共价半径重判。
 */
export interface SlabResult {
  atoms: Atom[];
  bonds: import('../geometry').Bond[];
  meta: SurfaceMeta;
}

export function buildMillerSlab(cifText: string, p: MillerSlabParams): SlabResult {
  if (p.h === 0 && p.k === 0 && p.l === 0) throw new Error('Miller 指数 (000) 无效');
  const parsed = parseCIF(cifText);
  const base = expandSymmetry(parsed.atoms, parsed.symops);
  const { u, v, lattice } = surfaceRepeatVectors(parsed.cell, p.h, p.k, p.l);
  // 表面正交基：z = normal（G 方向），x = u 归一（u ⊥ G），y = z × x
  const g: V3 = [
    p.h * (cross(lattice.a2, lattice.a3)[0]) + p.k * (cross(lattice.a3, lattice.a1)[0]) + p.l * (cross(lattice.a1, lattice.a2)[0]),
    p.h * (cross(lattice.a2, lattice.a3)[1]) + p.k * (cross(lattice.a3, lattice.a1)[1]) + p.l * (cross(lattice.a1, lattice.a2)[1]),
    p.h * (cross(lattice.a2, lattice.a3)[2]) + p.k * (cross(lattice.a3, lattice.a1)[2]) + p.l * (cross(lattice.a1, lattice.a2)[2]),
  ];
  const zAxis = scale(g, 1 / (norm(g) || 1));
  const xAxis = scale(u, 1 / norm(u));
  const yAxis = cross(zAxis, xAxis);
  const uLen = norm(u);
  const vLen = norm(v);

  // 平铺范围：表面系窗口需求折回晶格平移数（保守覆盖 + buffer）
  const cellD = Math.max(parsed.cell.a, parsed.cell.b, parsed.cell.c);
  const N = Math.ceil((Math.max(p.sizeX, p.sizeY) + p.thickness + cellD * 2) / cellD) + 1;

  // 变换单胞原子到表面系
  const frac = base.map((a) => {
    const c: V3 = [
      a.fx * lattice.a1[0] + a.fy * lattice.a2[0] + a.fz * lattice.a3[0],
      a.fx * lattice.a1[1] + a.fy * lattice.a2[1] + a.fz * lattice.a3[1],
      a.fx * lattice.a1[2] + a.fy * lattice.a2[2] + a.fz * lattice.a3[2],
    ];
    return { el: a.el, label: a.label, x: dot(c, xAxis), y: dot(c, yAxis), z: dot(c, zAxis) };
  });

  // 全部平移候选 → 面内斜坐标折叠（r_面内 = αu + βv，α/β mod 1——u/v 斜格的
  // 正确周期语义；矩形各向独立取模在斜格上会产生非法余数位置）+ 整数 u/v 副本铺窗
  const zAll: number[] = [];
  const placed: Array<{ el: string; label: string; x: number; y: number; z: number }> = [];
  // u/v 在正交表面系的 2D 分量（xAxis ∥ u → u2d=(uLen,0)；v2d=(vX,vY)）
  const u2d: [number, number] = [uLen, 0];
  const v2d: [number, number] = [dot(v, xAxis), dot(v, yAxis)];
  // [u2d v2d] 2×2 求逆：正交系面内矢量 → 斜坐标 (α, β)
  const det = u2d[0] * v2d[1] - u2d[1] * v2d[0];
  const inv = Math.abs(det) > 1e-9
    ? { a: v2d[1] / det, b: -v2d[0] / det, c: -u2d[1] / det, d: u2d[0] / det }
    : { a: 1, b: 0, c: 0, d: 1 }; // 退化保护（理论不触发：u,v 不平行）
  const nx = Math.ceil(p.sizeX / uLen) + 1;
  const ny = Math.ceil(p.sizeY / vLen) + 1;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++)
      for (let m = 0; m <= N; m++) {
        const t: V3 = [
          i * lattice.a1[0] + j * lattice.a2[0] + m * lattice.a3[0],
          i * lattice.a1[1] + j * lattice.a2[1] + m * lattice.a3[1],
          i * lattice.a1[2] + j * lattice.a2[2] + m * lattice.a3[2],
        ];
        for (const a of frac) {
          const sx = a.x + dot(t, xAxis);
          const sy = a.y + dot(t, yAxis);
          const sz = a.z + dot(t, zAxis);
          // 面内斜坐标：正交系 (sx,sy) → 面内矢量 → αu+βv 分数坐标 → mod 1
          const alpha = inv.a * sx + inv.b * sy;
          const beta = inv.c * sx + inv.d * sy;
          const fa = alpha - Math.floor(alpha);
          const fb = beta - Math.floor(beta);
          const bx = fa * u2d[0] + fb * v2d[0];
          const by = fa * u2d[1] + fb * v2d[1];
          for (let iu = -nx; iu <= nx; iu++) {
            for (let iv = -ny; iv <= ny; iv++) {
              const wx = bx + iu * u2d[0] + iv * v2d[0];
              const wy = by + iu * u2d[1] + iv * v2d[1];
              if (wx < -p.sizeX / 2 || wx >= p.sizeX / 2) continue;
              if (wy < -p.sizeY / 2 || wy >= p.sizeY / 2) continue;
              placed.push({ el: a.el, label: a.label, x: wx, y: wy, z: sz });
            }
          }
          zAll.push(sz);
        }
      }

  // z 层枚举（0.5Å 合并）→ 满层判定（原子数 ≥ 50% 同层最大值）：
  // termination 候选 = 满层集合（确定性升序）；切割窗 [满层-0.25, 窗内最高满层]
  // ——两端不产生半原子残层（截断面终止于完整层，Ce/O 终止即 termination 语义）
  const zSorted = [...new Set(zAll.map((z) => Math.round(z * 1000) / 1000))].sort((a, b) => a - b);
  const zLayers: number[] = [];
  for (const z of zSorted) {
    if (!zLayers.length || z - zLayers[zLayers.length - 1]! > 0.5) zLayers.push(z);
    else zLayers[zLayers.length - 1] = (zLayers[zLayers.length - 1]! + z) / 2;
  }
  const layerCount = new Map<number, number>();
  for (const a of placed) {
    // 就近层归属（容差 0.3）
    let best = zLayers[0]!;
    for (const z of zLayers) if (Math.abs(a.z - z) < Math.abs(a.z - best)) best = z;
    layerCount.set(best, (layerCount.get(best) ?? 0) + 1);
  }
  const maxCount = Math.max(...layerCount.values());
  const fullLayers = zLayers.filter((z) => (layerCount.get(z) ?? 0) >= maxCount * 0.5);
  const terminationCount = fullLayers.length;
  if (!terminationCount) throw new Error('表面切割未找到完整原子层');
  const term = Math.max(0, Math.min(p.termination, terminationCount - 1));
  const z0 = fullLayers[term]! - 0.25;
  const zCeil = (() => {
    let top = z0;
    for (const z of fullLayers) if (z >= z0 && z <= z0 + p.thickness) top = z;
    return top + 0.25;
  })();

  // z 窗口过滤（满层间，无残层）+ 3D 去重（周期折叠可能重复映入）
  const inSlab = placed.filter((a) => a.z >= z0 && a.z <= zCeil);
  const dedup: typeof inSlab = [];
  for (const a of inSlab) {
    let dup = false;
    for (const b of dedup) {
      if (a.el === b.el && norm(sub([a.x, a.y, a.z], [b.x, b.y, b.z])) < 0.3) {
        dup = true;
        break;
      }
    }
    if (!dup) dedup.push(a);
  }

  const zMid = (z0 + zCeil) / 2;
  const atoms: Atom[] = dedup.map((a) => ({ el: a.el, label: a.label, x: a.x, y: a.y, z: a.z - zMid }));
  const composition: Record<string, number> = {};
  for (const a of atoms) composition[a.el] = (composition[a.el] ?? 0) + 1;
  const { atoms: centered } = center(atoms);
  return {
    atoms: centered,
    bonds: computeBonds(centered),
    meta: {
      millerIndex: [p.h, p.k, p.l],
      u,
      v,
      uLen,
      vLen,
      terminationCount,
      normal: [0, 0, 1],
      composition,
      geometrySource: 'generated',
      relaxed: false,
    },
  };
}
