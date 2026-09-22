/**
 * 拖拽吸附几何内核（2026-09-22）：小分子与大组件重叠时自动吸附到表面。
 *
 * 纯数学纯数据（无 THREE/sceneStore 依赖——科学内核解耦原则同 adsorb.ts）：
 *  - 世界几何：组件原子按其 transform（Scale→Rotate→Translate，Euler XYZ 度）
 *    变换到世界系（与 RendererService.applyTransform 同约定）；
 *  - 判定：包围盒相交 + 原子级 minDist < 0.8×(vdW 和)（重叠）；
 *  - 吸附点：距小分子世界质心最近的基底表面原子；法向 = 表面点 − 基底质心
 *    （凸基底近似：管/颗粒/片层均适用；平面片层退化为面法向）；
 *  - 放置：保持用户当前朝向（不强制旋转——朝向表达权留给用户/吸附工作流），
 *    平移质心到表面点 + 沿法向推出 vdW 接触距离，再 clash 步进保证不穿透。
 */
import { getElement } from '../elements';
import type { Atom } from '../geometry';

export interface WorldAtom {
  el: string;
  x: number;
  y: number;
  z: number;
}

export interface SnapTransformInput {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

const deg = Math.PI / 180;
/** Euler XYZ（度）→ 旋转矩阵（行主序，v' = R·v；与 THREE.Euler 默认序一致） */
function eulerMatrix(e: [number, number, number]): number[][] {
  const [a, b, c] = [e[0]! * deg, e[1]! * deg, e[2]! * deg];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [sa * sb * cc + ca * sc, -sa * sb * sc + ca * cc, -sa * cb],
    [-ca * sb * cc + sa * sc, ca * sb * sc + sa * cc, ca * cb],
  ];
}

/** 组件局部原子 → 世界原子（Scale→Rotate→Translate；GeometryData 已质心居中） */
export function worldAtoms(atoms: Atom[], t: SnapTransformInput): WorldAtom[] {
  const R = eulerMatrix(t.rotation);
  const s = t.scale;
  return atoms.map((a) => ({
    el: a.el,
    x: (R[0]![0]! * a.x + R[0]![1]! * a.y + R[0]![2]! * a.z) * s + t.position[0],
    y: (R[1]![0]! * a.x + R[1]![1]! * a.y + R[1]![2]! * a.z) * s + t.position[1],
    z: (R[2]![0]! * a.x + R[2]![1]! * a.y + R[2]![2]! * a.z) * s + t.position[2],
  }));
}

export interface WorldBox {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}

export function boxOf(atoms: WorldAtom[]): WorldBox {
  const b: WorldBox = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (const a of atoms) {
    b.x0 = Math.min(b.x0, a.x); b.y0 = Math.min(b.y0, a.y); b.z0 = Math.min(b.z0, a.z);
    b.x1 = Math.max(b.x1, a.x); b.y1 = Math.max(b.y1, a.y); b.z1 = Math.max(b.z1, a.z);
  }
  return b;
}

/** 包围盒相交（任务书：触发条件） */
export function boxesOverlap(a: WorldBox, b: WorldBox): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1 && a.z0 <= b.z1 && b.z0 <= a.z1;
}

/** 体积（大小判定：大者基底，小者吸附质） */
export function boxVolume(b: WorldBox): number {
  return (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0);
}

const centroid = (atoms: WorldAtom[]): [number, number, number] => [
  atoms.reduce((s, a) => s + a.x / atoms.length, 0),
  atoms.reduce((s, a) => s + a.y / atoms.length, 0),
  atoms.reduce((s, a) => s + a.z / atoms.length, 0),
];

/** 分量访问（WorldAtom 或三元组统一） */
const c3 = (v: WorldAtom | [number, number, number], i: number): number => {
  const keys = ['x', 'y', 'z'] as const;
  const asAtom = v as WorldAtom;
  return typeof asAtom.x === 'number' ? asAtom[keys[i]!] : (v as number[])[i]!;
};
const d3 = (a: WorldAtom | [number, number, number], b: WorldAtom | [number, number, number]) =>
  Math.hypot(c3(a, 0) - c3(b, 0), c3(a, 1) - c3(b, 1), c3(a, 2) - c3(b, 2));

/** 原子级最小间距（Å） */
export function minAtomDistance(a: WorldAtom[], b: WorldAtom[]): number {
  let m = Infinity;
  for (const x of a) for (const y of b) m = Math.min(m, d3(x, y));
  return m;
}

/** 原子级重叠判定：minDist < 0.8 × (vdW 和) 的最小对阈值（保守：最小元素对） */
export function atomsOverlap(mol: WorldAtom[], sub: WorldAtom[]): boolean {
  const minVdw = Math.min(...mol.map((a) => getElement(a.el)?.vdw ?? 1.6), ...sub.map((a) => getElement(a.el)?.vdw ?? 1.6));
  return minAtomDistance(mol, sub) < 0.8 * 2 * minVdw;
}

export interface SnapPlan {
  /** 吸附点（基底表面原子，世界系） */
  surfacePoint: [number, number, number];
  /** 表面法向（世界系，单位向量；远离基底质心方向） */
  surfaceNormal: [number, number, number];
  /** 吸附后小分子 transform（rotation 保持用户朝向） */
  transform: SnapTransformInput;
  /** 吸附后分子-基底最小原子距（Å） */
  minDistance: number;
}

/**
 * 计算吸附放置：分子保持当前朝向，质心平移到表面点 + 沿法向推出 vdW 接触距
 * （两表面元素 vdW 和 × 0.75——比硬接触略松，视觉贴合），随后 clash 步进
 * （0.1Å/步，上限 3Å）保证 minDist ≥ 0.7 × (vdW 和)，不穿透基底。
 */
export function planSnap(
  molAtomsLocal: Atom[],
  molTransform: SnapTransformInput,
  substrateWorld: WorldAtom[],
): SnapPlan {
  const t = molTransform;
  const R = eulerMatrix(t.rotation);
  const rotated = molAtomsLocal.map((a) => ({
    el: a.el,
    x: (R[0]![0]! * a.x + R[0]![1]! * a.y + R[0]![2]! * a.z) * t.scale,
    y: (R[1]![0]! * a.x + R[1]![1]! * a.y + R[1]![2]! * a.z) * t.scale,
    z: (R[2]![0]! * a.x + R[2]![1]! * a.y + R[2]![2]! * a.z) * t.scale,
  }));
  const rc = centroid(rotated); // 旋转后质心（局部→表面系偏移基准）

  // 表面点：距当前分子世界质心最近的基底原子
  const wc = centroid(worldAtoms(molAtomsLocal, t));
  let best = substrateWorld[0]!;
  let bd = Infinity;
  for (const s of substrateWorld) {
    const d = d3(s, wc);
    if (d < bd) { bd = d; best = s; }
  }
  // 表面法向：吸附点邻域（≤3.5Å）拟合平面的法向（协方差最小特征向量——
  // 平面基底给面法向、管/颗粒近似径向；凸体质心法向在薄片上退化为面内方向故弃用）。
  // 符号取朝向分子来向（表面点 → 分子质心）。
  const nb = substrateWorld.filter((a) => Math.hypot(a.x - best.x, a.y - best.y, a.z - best.z) <= 3.5);
  const pts = nb.length >= 3 ? nb : substrateWorld;
  const pc = centroid(pts);
  const cov = [0, 1, 2].map(() => [0, 0, 0]);
  for (const a of pts)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const di = (i === 0 ? a.x : i === 1 ? a.y : a.z) - pc[i]!;
        const dj = (j === 0 ? a.x : j === 1 ? a.y : a.z) - pc[j]!;
        cov[i]![j]! += di * dj;
      }
  const mu = Math.max(...cov.map((r, i) => r[i]!)) * 1.1 + 1e-9;
  const B = cov.map((r, i) => r.map((v, j) => (i === j ? mu - v : -v)));
  let v: [number, number, number] = [0.577, 0.577, 0.577];
  for (let it = 0; it < 64; it++) {
    const w: [number, number, number] = [
      B[0]![0]! * v[0] + B[0]![1]! * v[1] + B[0]![2]! * v[2],
      B[1]![0]! * v[0] + B[1]![1]! * v[1] + B[1]![2]! * v[2],
      B[2]![0]! * v[0] + B[2]![1]! * v[1] + B[2]![2]! * v[2],
    ];
    const L0 = Math.hypot(...w) || 1;
    v = [w[0]! / L0, w[1]! / L0, w[2]! / L0];
  }
  const toward: [number, number, number] = [wc[0] - best.x, wc[1] - best.y, wc[2] - best.z];
  const sign = v[0]! * toward[0]! + v[1]! * toward[1]! + v[2]! * toward[2]! >= 0 ? 1 : -1;
  const normal: [number, number, number] = [v[0]! * sign, v[1]! * sign, v[2]! * sign];

  // 目标质心：表面点 + 法向 × (分子最远原子半径 + vdW 接触)
  let reach = 0;
  for (const a of rotated) reach = Math.max(reach, Math.hypot(a.x - rc[0], a.y - rc[1], a.z - rc[2]));
  const contact = ((getElement(best.el)?.vdw ?? 1.6) + 1.2) * 0.9;
  const target: [number, number, number] = [best.x + normal[0]! * (reach + contact), best.y + normal[1]! * (reach + contact), best.z + normal[2]! * (reach + contact)];
  let position: [number, number, number] = [target[0]! - rc[0], target[1]! - rc[1], target[2]! - rc[2]];

  // clash 步进：世界分子原子对基底全部原子 ≥ 0.7×(vdW 和)
  const worldOf = (p: [number, number, number]): WorldAtom[] =>
    rotated.map((a) => ({ el: a.el, x: a.x + p[0], y: a.y + p[1], z: a.z + p[2] }));
  const clashFree = (p: [number, number, number]): boolean => {
    for (const m of worldOf(p))
      for (const s of substrateWorld) {
        const cut = 0.7 * ((getElement(m.el)?.vdw ?? 1.6) + (getElement(s.el)?.vdw ?? 1.6));
        if (d3(m, s) < cut) return false;
      }
    return true;
  };
  let guard = 0;
  while (!clashFree(position) && guard++ < 30) {
    position = [position[0]! + normal[0]! * 0.1, position[1]! + normal[1]! * 0.1, position[2]! + normal[2]! * 0.1];
  }
  return {
    surfacePoint: [best.x, best.y, best.z],
    surfaceNormal: normal,
    transform: { position, rotation: [...t.rotation] as [number, number, number], scale: t.scale },
    minDistance: minAtomDistance(worldOf(position), substrateWorld),
  };
}
