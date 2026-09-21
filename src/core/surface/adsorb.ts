/**
 * Adsorption Candidate Generator —— PHASE B（2026-09-20，任务书二十七~三十四）
 *
 * 几何候选（**Initial Adsorption Geometry**，非能量优化）：site（top/bridge/
 * hollow）× orientation preset（确定性旋转）→ vdW 估算距离 → steric clash
 * 检测（严重碰撞自动沿法向推出）。禁止宣称"最稳定构型/最低能构型"——本阶段
 * 无任何能量计算；geometryMethod 恒 'initial'。
 *
 * 输出为普通组件语义（molecule + transform），不建第二套场景系统；
 * 原始 canonical 资产零修改（候选只是场景实例变换）。
 */
import { getElement } from '../elements';
import type { Atom, Bond } from '../geometry';
import type { SlabResult } from './slab';

export type AdsiteKind = 'top' | 'bridge' | 'hollow';
export type OrientationKind = 'parallel' | 'tilted' | 'perpendicular' | 'methyl-down' | 'end-on';

export interface AdsorbOptions {
  site: AdsiteKind;
  orientation: OrientationKind;
  /** 分子最低原子距表面 site 点的间距（Å；默认建议由 vdW 估算，调用方可调） */
  distance?: number;
  /** site 索引（同类型 site 确定性排序后取第几个；默认 0 = 距原点最近） */
  siteIndex?: number;
}

export interface AdsorbCandidate {
  name: string;
  site: AdsiteKind;
  /** 吸附位点在 surface 局部系的坐标（JSON-safe metadata，任务书二十七） */
  siteLocalPosition: [number, number, number];
  orientation: OrientationKind;
  /** 变换后分子原子（局部坐标，已平移使质心在原点）与键（索引不变） */
  atoms: Atom[];
  bonds: Bond[];
  /** 放置变换（surface 局部系：分子质心位 + 欧拉；adapter 组合 surface transform 成世界 pose） */
  position: [number, number, number];
  rotation: [number, number, number];
  /** 分子-表面最小原子距（Å，clash 修正后） */
  minDistance: number;
  /** 初始摆放是否触发 clash 并被自动推出 */
  clashResolved: boolean;
  geometryMethod: 'initial';
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(...a);

/** 表面吸附位点（确定性）：top = 顶层原子；bridge = 顶层近邻对中点；hollow = 顶层三角质心 */
export function surfaceSites(surf: SlabResult): Record<AdsiteKind, Array<{ x: number; y: number; z: number }>> {
  const zMax = Math.max(...surf.atoms.map((a) => a.z));
  const top = surf.atoms.filter((a) => a.z > zMax - 0.6); // 真顶层（0.6Å 窗口，避免混入 0.78Å 深的次层）
  // 近邻阈值自适应：顶层最小近邻 × 1.35（固定 3.5Å 对 CeO₂(111) 的 3.83Å 近邻失效）
  let nn = Infinity;
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++)
      nn = Math.min(nn, Math.hypot(top[i]!.x - top[j]!.x, top[i]!.y - top[j]!.y));
  const CUT = Number.isFinite(nn) ? Math.max(nn * 1.35, 3.5) : 3.5;
  const sorted = (pts: Array<{ x: number; y: number; z: number }>) =>
    pts.slice().sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y) || p.x - q.x || p.y - q.y);
  const bridges: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i]!;
      const b = top[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < CUT) bridges.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: Math.max(a.z, b.z) });
    }
  const hollows: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++)
      for (let k = j + 1; k < top.length; k++) {
        const [a, b, c] = [top[i]!, top[j]!, top[k]!];
        if (Math.hypot(a.x - b.x, a.y - b.y) < CUT && Math.hypot(a.x - c.x, a.y - c.y) < CUT && Math.hypot(b.x - c.x, b.y - c.y) < CUT) {
          hollows.push({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: Math.max(a.z, b.z, c.z) });
        }
      }
  return { top: sorted(top.map((a) => ({ x: a.x, y: a.y, z: a.z }))), bridge: sorted(bridges), hollow: sorted(hollows) };
}

/**
 * 取向语义轴（2026-09-21 产品闭环，任务书十九~二十一）：优先分子拓扑真实方向，
 * 不用 PCA 短轴冒充——
 *  - C₇H₈ + methyl-down：甲基碳（转录序 3）− 苯环心（环碳 0,1,2,4,5,6 质心）；
 *  - C₃H₈ + end-on：端碳（1）− 中心碳（0）链端方向；
 *  - 其余：molecularShortAxis 回退（平面分子≈环法向）。
 */
export function adsorbateOrientAxis(
  kind: string,
  atoms: Atom[],
  orientation: OrientationKind,
): V3 {
  if (kind === 'C₇H₈' && orientation === 'methyl-down') {
    const ring = [0, 1, 2, 4, 5, 6].map((i) => atoms[i]!);
    const c = ring.reduce((acc, a) => ({ x: acc.x + a.x / ring.length, y: acc.y + a.y / ring.length, z: acc.z + a.z / ring.length }), { x: 0, y: 0, z: 0 });
    const m = atoms[3]!;
    const v: V3 = [m.x - c.x, m.y - c.y, m.z - c.z];
    const L = norm(v) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  }
  if (kind === 'C₃H₈' && orientation === 'end-on') {
    const a = atoms[0]!;
    const b = atoms[1]!;
    const v: V3 = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = norm(v) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  }
  return molecularShortAxis(atoms);
}

/** 分子"平面法向/短轴"= 坐标协方差最小特征向量（芳香环平面 → 环法向；链 → 垂直链向） */
function molecularShortAxis(atoms: Atom[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const a of atoms) {
    c[0] += a.x / atoms.length;
    c[1] += a.y / atoms.length;
    c[2] += a.z / atoms.length;
  }
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const a of atoms) {
    const d: V3 = [a.x - c[0], a.y - c[1], a.z - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i]![j]! += d[i]! * d[j]!;
  }
  // 幂迭代求最小特征向量：M - λI 近似（λ 取大值压缩主轴）→ 用位移法：
  // min 特征向量 ⟂ 最大两方差方向。位移矩阵 B = μI - M（μ > max diag）的最大特征向量。
  const mu = Math.max(...m.map((r, i) => r[i]!)) * 1.1 + 1e-9;
  const B = m.map((r, i) => r.map((v, j) => (i === j ? mu - v : -v)));
  let v: V3 = [0.577, 0.577, 0.577];
  for (let it = 0; it < 64; it++) {
    const w: V3 = [
      B[0]![0]! * v[0] + B[0]![1]! * v[1] + B[0]![2]! * v[2],
      B[1]![0]! * v[0] + B[1]![1]! * v[1] + B[1]![2]! * v[2],
      B[2]![0]! * v[0] + B[2]![1]! * v[1] + B[2]![2]! * v[2],
    ];
    const L = norm(w) || 1;
    v = [w[0] / L, w[1] / L, w[2] / L];
  }
  return v;
}

const applyR = (R: number[][], v: V3): V3 => [dot(R[0]! as V3, v), dot(R[1]! as V3, v), dot(R[2]! as V3, v)];

/** 欧拉角（度，XYZ 序）→ 旋转矩阵（纯数学，scene transform 组合复用，任务书十二） */
export function eulerDegToMatrix(e: V3): number[][] {
  const [a, b, c] = [(e[0] * Math.PI) / 180, (e[1] * Math.PI) / 180, (e[2] * Math.PI) / 180];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [sa * sb * cc + ca * sc, -sa * sb * sc + ca * cc, -sa * cb],
    [-ca * sb * cc + sa * sc, ca * sb * sc + sa * cc, ca * cb],
  ];
}

/** 矩阵 → XYZ 欧拉角（度；R = Rx(a)·Ry(b)·Rz(c)，与 THREE.Euler 默认序一致） */
export function matrixToEulerDeg(R: number[][]): V3 {
  // 通用两分支分解（2026-09-21b 修复：单 asin 分支在 b>90° 时给出假解——
  // 组合旋转 Rw 落入第二分支导致世界 pose 偏差 Å 级）
  const sb = Math.max(-1, Math.min(1, R[2]![0]!));
  const b1 = Math.asin(sb);
  const cb1 = Math.cos(b1); // ≥ 0（主分支）
  if (cb1 > 1e-6) {
    const a = Math.atan2(-R[2]![1]!, R[2]![2]!);
    const c = Math.atan2(-R[1]![0]!, R[0]![0]!);
    return [(a * 180) / Math.PI, (b1 * 180) / Math.PI, (c * 180) / Math.PI];
  }
  if (cb1 < 1e-6 && Math.abs(sb) > 1 - 1e-9) {
    // 真万向锁：b=±90°，c 并入 a（取 c=0）
    const a = Math.atan2(R[1]![2]!, R[1]![1]!) * (sb > 0 ? 1 : -1);
    return [(a * 180) / Math.PI, (sb * 90), 0];
  }
  // 第二分支：b' = 180° - b1（cos b < 0）
  const b2 = Math.PI - b1;
  const a2 = Math.atan2(R[2]![1]!, -R[2]![2]!);
  const c2 = Math.atan2(R[1]![0]!, -R[0]![0]!);
  return [(a2 * 180) / Math.PI, (b2 * 180) / Math.PI, (c2 * 180) / Math.PI];
}


/**
 * 生成一个吸附候选（确定性）。分子先按 orientation 旋转（短轴 → 目标方向），
 * 再平移到 site 上方使最低原子距 site 顶面 distance；与表面任意原子对
 * min < 0.7×(vdW_i+vdW_j) 视为严重碰撞 → 沿 +z 步进 0.1Å 推出（上限 3Å）。
 */
export function generateAdsorbCandidate(
  surf: SlabResult,
  mol: { atoms: Atom[]; bonds: Bond[] },
  opts: AdsorbOptions,
  adsorbateKind = '',
): AdsorbCandidate {
  const sites = surfaceSites(surf);
  const list = sites[opts.site];
  if (!list?.length) throw new Error(`表面无 ${opts.site} 吸附位点`);
  const site = list[Math.max(0, Math.min(opts.siteIndex ?? 0, list.length - 1))]!;

  // 目标朝向（表面系 z = 法向）：正交基投影构造（行 = 新基轴，applyR 即投影）
  // targetZ = 旋转后分子短轴（环法向）应指向的方向
  let targetZ: V3;
  switch (opts.orientation) {
    case 'parallel':
      targetZ = [0, 0, 1];
      break; // 平躺
    case 'perpendicular':
      targetZ = [1, 0, 0];
      break; // 立起（短轴 ∥ x）
    case 'tilted': {
      const t = (30 * Math.PI) / 180;
      targetZ = [Math.sin(t), 0, Math.cos(t)];
      break; // 倾 30°
    }
    case 'methyl-down':
    case 'end-on':
      targetZ = [0, 0, -1];
      break; // 翻转（端基朝下）
  }
  // 两段合成：R0 把取向语义轴（拓扑优先，见 adsorbateOrientAxis）对到 z；R1 把 z 对到 targetZ。
  const shortAxis = adsorbateOrientAxis(adsorbateKind, mol.atoms, opts.orientation);
  const mk = (zIn: V3): number[][] => {
    const ref: V3 = Math.abs(zIn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const c = cross(ref, zIn);
    const L = norm(c) || 1;
    const x: V3 = [c[0] / L, c[1] / L, c[2] / L];
    const y: V3 = cross(zIn, x);
    return [x, y, [...zIn] as V3];
  };
  const R0 = mk(shortAxis);
  const R1 = mk(targetZ);
  // R = R1 ∘ R0（先 R0 后 R1）
  const R: number[][] = [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(R1[i]! as V3, [dot(R0[0]! as V3, [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0]), dot(R0[1]! as V3, [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0]), dot(R0[2]! as V3, [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0])] as V3)));

  const rotated = mol.atoms.map((a) => {
    const r = applyR(R, [a.x, a.y, a.z]);
    return { el: a.el, label: a.label, x: r[0], y: r[1], z: r[2] };
  });
  const zMin = Math.min(...rotated.map((a) => a.z));
  const dist = opts.distance ?? 3.0;
  const dz = site.z + dist - zMin;
  let placedAtoms = rotated.map((a) => ({ ...a, x: a.x + site.x, y: a.y + site.y, z: a.z + dz }));

  // Clash 检测 + 沿法向推出
  const clashAt = (atoms: typeof placedAtoms): number => {
    let min = Infinity;
    for (const m of atoms)
      for (const s of surf.atoms) {
        const d = Math.hypot(m.x - s.x, m.y - s.y, m.z - s.z);
        const cut = 0.7 * ((getElement(m.el)?.vdw ?? 1.6) + (getElement(s.el)?.vdw ?? 1.6));
        if (d < cut) return -1; // 严重碰撞
        min = Math.min(min, d);
      }
    return min;
  };
  let clashResolved = false;
  let minD = clashAt(placedAtoms);
  for (let push = 0; push < 30 && minD < 0; push++) {
    placedAtoms = placedAtoms.map((a) => ({ ...a, z: a.z + 0.1 }));
    minD = clashAt(placedAtoms);
    clashResolved = true;
  }
  if (minD < 0) throw new Error('吸附候选无法解除空间碰撞（检查 distance 参数）');

  const rot = matrixToEulerDeg(R);
  // position = 放置平移 T（质心居中分子旋转后质心 = T）——组件 transform
  // {position:T, rotation:rot, scale:1} 渲染原子与 atoms 逐位一致（测试锁定）
  const cx = placedAtoms.reduce((a, x) => a + x.x / placedAtoms.length, 0);
  const cy = placedAtoms.reduce((a, x) => a + x.y / placedAtoms.length, 0);
  const cz = placedAtoms.reduce((a, x) => a + x.z / placedAtoms.length, 0);
  return {
    name: `${opts.orientation}-${opts.site}${opts.siteIndex ?? 0}`,
    site: opts.site,
    siteLocalPosition: [site.x, site.y, site.z],
    orientation: opts.orientation,
    atoms: placedAtoms,
    bonds: mol.bonds.map((b) => [...b] as Bond),
    position: [cx, cy, cz],
    rotation: rot,
    minDistance: minD,
    clashResolved,
    geometryMethod: 'initial',
  };
}

/** 标准候选集（任务书三十三/三十四）：4 取向 × 指定 site，确定性顺序 */
export function generateAdsorptionCandidates(
  surf: SlabResult,
  mol: { atoms: Atom[]; bonds: Bond[] },
  site: AdsiteKind = 'top',
  distance?: number,
  adsorbateKind = '',
): AdsorbCandidate[] {
  // 取向按吸附物给出真实语义集：甲苯含 methyl-down（环心→甲基碳轴），
  // 丙烷含 end-on（链端方向）；其余分子给前三通用取向
  const orients: OrientationKind[] =
    adsorbateKind === 'C₃H₈' ? ['parallel', 'tilted', 'perpendicular', 'end-on'] : ['parallel', 'tilted', 'perpendicular', 'methyl-down'];
  return orients.map((o) => generateAdsorbCandidate(surf, mol, { site, orientation: o, distance }, adsorbateKind));
}
