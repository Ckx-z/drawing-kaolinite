/**
 * 几何内核（二）：参数化素材生成器 —— T-1.3 自 demo/core/builders.js 移植
 *
 * 每个素材类型 = 纯函数 (params) → { atoms, bonds }（契约见 geometry.ts）。
 * 移植铁律：逻辑逐位对齐 demo 基线，kernel.test.ts 以实测数值回归。
 * 差异说明：buildSubstrate 依赖 THREE.Shape，归入渲染层 src/render/substrate.ts（T-1.4）。
 */
import * as C from './crystal';
import type { Atom, Bond, GeometryData } from './geometry';
import type { MoleculeParams, PackedLayerParams, ParticleParams, SheetParams, TubeParams } from './types';

/* 确定性伪随机（同一种子同一颗粒形，保证模块复现） */
export function mulberry32(seed: number): () => number {
  let t = (seed >>> 0) || 1;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================
 * 素材 1：高岭土片层
 * 管线：parseCIF → expandSymmetry → buildSlab(超胞)
 *       → [六角裁剪] → 补羟基氢 → 判键 → [边缘饱和]
 * ============================================================ */
/**
 * 单原子模式（2026-09-08）：忽略化学组成，全部原子统一为 singleEl——
 * 机理图简化示意画法（"由重复的单一原子堆叠成结构"）。键网与几何不变，
 * 仅替换元素标识（渲染层按 el 取半径/颜色 → 视觉即为单一原子堆叠）。
 *
 * 2026-09-10 层数维度：single 模式下几何生成即只含前 singleLayers 层
 * （buildKaoliniteSheet/buildHalloysiteTube 传给 buildSlab 的 nc 已 clamp），
 * 因此本函数照旧全量替换——显示的每一层都是完整晶体学层（z 间隔 d001），
 * 层与层天然可区分，不做"全部层塌成一层"式的合并。
 */
function applyAtomMode<T extends GeometryData>(
  g: T,
  p: { atomMode?: 'full' | 'single'; singleEl?: string },
): T {
  if (p.atomMode === 'single' && p.singleEl) {
    for (const a of g.atoms) a.el = p.singleEl;
  }
  return g;
}

/** 单原子模式的实际堆叠层数：前 N 层（clamp 到结构总层数；缺省 3 = 全部层，兼容旧参数） */
function singleModeLayers(total: number, p: { atomMode?: string; singleLayers?: number }): number {
  if (p.atomMode !== 'single') return total;
  return Math.max(1, Math.min(p.singleLayers ?? 3, total));
}

export function buildKaoliniteSheet(cifText: string, p: SheetParams): GeometryData {
  const parsed = C.parseCIF(cifText);
  const na = Math.max(2, Math.round(p.Lx / parsed.cell.a));
  const nb = Math.max(2, Math.round(p.Ly / parsed.cell.b));
  // T-2.7：strictCell = 晶学严格模式（保留 β/γ 夹角）；卷曲管线保持示意正交化（斜方板卷曲会引入人为扭曲）
  // 2026-09-10：单原子模式只生成前 singleLayers 层（其余层不显示）
  const nc = singleModeLayers(p.layers, p);
  const slab = C.buildSlab(parsed, { na, nb, nc, d001: p.d001, orthogonal: !p.strictCell });
  let atoms = slab.atoms;
  if (p.shape === '六角') {
    atoms = C.clipHexagon(atoms, Math.min(p.Lx, p.Ly) * 0.52);
    C.center(atoms);
  }
  atoms = C.addHydroxylHydrogens(atoms);
  const bonds = C.computeBonds(atoms);
  if (p.edgeH) atoms = C.saturateEdges(atoms, bonds);
  return applyAtomMode({ atoms, bonds, meta: { na, nb } }, p);
}

/* ============================================================
 * 素材 2：埃洛石管 ——【片层卷成管状】
 * 内半径 innerR → 周向晶胞数 na = round(2π(innerR+3.6)/a)；
 * walls 2~3 先堆垛再整体卷曲（同心多壁）；progress 卷曲进度可动画；
 * 卷曲后重新判键 → 开口端自动断键。算法推导见 docs/技术方案设计.md §5.2。
 * ============================================================ */
export function buildHalloysiteTube(cifText: string, p: TubeParams): GeometryData {
  const parsed = C.parseCIF(cifText);
  // 卷曲方向（T-2.6）：'a' = 周向沿 a 轴（默认，与基线一致）；'b' = 周向沿 b 轴
  //（真实埃洛石轴向近 [110]，作图取美观）。'b' 实现：按 b 周向/a 轴向铺板后交换 x↔y，
  // 使卷曲方向仍落在 x 上（rollToTube 沿 x 卷曲）。
  const curlAxis = p.curlAxis ?? 'a';
  const circumferenceCells = (cellLen: number): number =>
    Math.max(6, Math.round((2 * Math.PI * (p.innerR + 3.6)) / cellLen));
  const lengthCells = (cellLen: number): number => Math.max(2, Math.round(p.length / cellLen));
  const na = curlAxis === 'b' ? lengthCells(parsed.cell.a) : circumferenceCells(parsed.cell.a);
  const nb = curlAxis === 'b' ? circumferenceCells(parsed.cell.b) : lengthCells(parsed.cell.b);
  // 2026-09-10：单原子模式只卷前 singleLayers 壁（同心壁层数随之减少）
  const nc = singleModeLayers(p.walls, p);
  const slab = C.buildSlab(parsed, { na, nb, nc, d001: p.d001 || 7.4 });
  let atoms = C.addHydroxylHydrogens(slab.atoms);

  if (curlAxis === 'b') {
    for (const a of atoms) {
      const t = a.x;
      a.x = a.y;
      a.y = t;
    }
  }

  // 去掉卷曲方向末端一列原子（x = xMax），避免 progress=1 时首尾重叠
  let x0 = 1e9;
  let x1 = -1e9;
  for (const a of atoms) {
    if (a.x < x0) x0 = a.x;
    if (a.x > x1) x1 = a.x;
  }
  const eps = (x1 - x0) * 1e-4;
  atoms = atoms.filter((a) => a.x < x1 - eps);

  const rolled = rollToTube(atoms, { progress: p.progress, taperDeg: p.taperDeg });

  // 端口噪声（T-2.6）：管两端 3Å 内原子小幅确定性扰动，模拟天然不规则端口。
  // 在 computeBonds 之前施加——键连随新位置重判，小幅噪声键数变化 <5%。
  const portNoise = p.portNoise ?? 0;
  if (portNoise > 0) {
    const rng = mulberry32(1337);
    let y0 = 1e9;
    let y1 = -1e9;
    for (const a of rolled) {
      if (a.y < y0) y0 = a.y;
      if (a.y > y1) y1 = a.y;
    }
    const falloff = 3; // 端口向内衰减宽度（Å）
    for (const a of rolled) {
      const edge = Math.min(a.y - y0, y1 - a.y);
      if (edge >= falloff) continue;
      const w = 1 - edge / falloff;
      a.y += (rng() * 2 - 1) * portNoise * w;
      a.x += (rng() * 2 - 1) * portNoise * w * 0.35;
      a.z += (rng() * 2 - 1) * portNoise * w * 0.35;
    }
  }

  const bonds = C.computeBonds(rolled);
  return applyAtomMode({ atoms: rolled, bonds, meta: { na, nb } }, p);
}

export interface RollOptions {
  /** 卷曲进度 0~1（1 = 闭合圆管） */
  progress: number;
  /** 锥角（°），0 = 圆柱 */
  taperDeg: number;
}

/**
 * 卷曲变换（保弧长等距映射，纯几何）：输入任意平面原子组，输出卷曲后原子组。
 * 独立导出：可复用于"部分卷曲"形态与逐帧动画。
 */
export function rollToTube(atoms: Atom[], p: RollOptions): Atom[] {
  const progress = Math.min(1, Math.max(0.001, p.progress || 0.001));
  const phi = progress * Math.PI * 2;
  let x0 = 1e9;
  let x1 = -1e9;
  let z0 = 1e9;
  let z1 = -1e9;
  for (const a of atoms) {
    if (a.x < x0) x0 = a.x;
    if (a.x > x1) x1 = a.x;
    if (a.z < z0) z0 = a.z;
    if (a.z > z1) z1 = a.z;
  }
  const Lx = Math.max(1e-6, x1 - x0);
  const half = Lx / 2;
  const zMid = (z0 + z1) / 2;
  const Rmid = Lx / phi; // 中面半径（progress=1 → 闭合）
  const t =
    Math.tan(Math.min(40, Math.abs(p.taperDeg || 0)) * (Math.PI / 180)) *
    Math.sign(p.taperDeg || 0);
  // 防止锥角过大导致负半径
  const tMax = (Rmid * 0.9) / Math.max(half, 1e-6);
  const tc = Math.max(-tMax, Math.min(tMax, t));

  // F(u) = ∫₀ᵘ du′/Rm(u′)：圆柱时线性，圆锥时为对数
  const Fof = (u: number): number => {
    if (Math.abs(tc) < 1e-6) return u / Rmid;
    return Math.log((Rmid + (u - half) * tc) / (Rmid - half * tc)) / tc;
  };
  const Ftot = Fof(Lx) - Fof(0) || 1e-9;

  const out: Atom[] = new Array(atoms.length);
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const u = a.x - x0;
    const theta = (phi * (Fof(u) - Fof(0))) / Ftot;
    const Rm = Rmid + (u - half) * tc; // 该处的局部半径
    const r = Rm - (a.z - zMid); // 径向映射
    out[i] = {
      el: a.el,
      label: a.label,
      r: a.r,
      layer: a.layer, // 壁层标记随卷曲保留（径向同心壁的层序号）
      x: r * Math.sin(theta),
      y: a.y,
      z: Rmid - r * Math.cos(theta),
    };
  }
  return out;
}

/* ============================================================
 * 素材 3：纳米颗粒（CeO₂ 风格簇装球 / 光滑球）
 * 簇装：斐波那契球面布点 + 径向抖动 + 内部填充；确定性种子可复现。
 * ============================================================ */
export function buildParticle(p: ParticleParams): GeometryData {
  const rng = mulberry32(p.seed || 7);
  const R = p.radius;
  const atoms: Atom[] = [];
  if (p.mode === '光滑') {
    // 低频噪声球：半径随三个互质频率正弦起伏 ±5%
    const N = 160;
    for (let i = 0; i < N; i++) {
      const y = 1 - ((i + 0.5) / N) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = i * 2.39996;
      const dir = [rr * Math.cos(th), y, rr * Math.sin(th)];
      const bump =
        1 +
        (0.05 * (Math.sin(5 * dir[0] * R + 1) + Math.sin(4 * dir[1] * R + 2) + Math.sin(6 * dir[2] * R))) /
          3;
      const rad = R * bump * (0.97 + rng() * 0.06);
      atoms.push({ el: rng() < 0.25 ? 'Ce' : 'O', x: dir[0] * rad, y: dir[1] * rad, z: dir[2] * rad });
    }
    // 中心骨架若干原子，避免侧视时"空心"
    for (let i = 0; i < 40; i++) {
      const d = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      const rad = R * 0.5 * Math.cbrt(rng());
      atoms.push({
        el: rng() < 0.4 ? 'Ce' : 'O',
        x: (d[0] / L) * rad,
        y: (d[1] / L) * rad,
        z: (d[2] / L) * rad,
      });
    }
  } else {
    const K = Math.max(30, p.grains || 150);
    const grainBase = (R * 3.4) / Math.sqrt(K); // 晶粒半径随数量自适应
    for (let i = 0; i < K; i++) {
      const y = 1 - ((i + 0.5) / K) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = i * 2.39996; // 黄金角
      const shell = R * (0.6 + rng() * 0.22); // 壳层半径抖动
      const el = i % 3 === 0 ? 'Ce' : 'O';
      atoms.push({
        el,
        x: rr * Math.cos(th) * shell,
        y: y * shell,
        z: rr * Math.sin(th) * shell,
        r: grainBase * (el === 'Ce' ? 1.12 : 0.92) * (0.9 + rng() * 0.2),
      });
    }
    // 内部填充 + 中心核
    for (let i = 0; i < Math.floor(K * 0.45); i++) {
      const d = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const L = Math.hypot(d[0], d[1], d[2]) || 1;
      const rad = R * 0.62 * Math.cbrt(rng());
      const el = i % 3 === 0 ? 'Ce' : 'O';
      atoms.push({
        el,
        x: (d[0] / L) * rad,
        y: (d[1] / L) * rad,
        z: (d[2] / L) * rad,
        r: grainBase * (el === 'Ce' ? 1.1 : 0.9) * (0.9 + rng() * 0.2),
      });
    }
  }
  return applyAtomMode({ atoms, bonds: [], meta: { n: atoms.length } }, p);
}

/* ============================================================
 * 素材 4：小分子 / 离子内置库（Å 坐标，标准键长键角）
 * ============================================================ */
interface MoleculeDef {
  atoms: Array<{ el: string; x: number; y: number; z: number }>;
  bonds: Bond[];
}

export const MOLECULES: Record<MoleculeParams['kind'], MoleculeDef> = {
  'H₂O': {
    atoms: [
      { el: 'O', x: 0, y: 0, z: 0 },
      { el: 'H', x: 0.759, y: 0.587, z: 0 },
      { el: 'H', x: -0.759, y: 0.587, z: 0 },
    ],
    bonds: [
      [0, 1],
      [0, 2],
    ],
  },
  'O₂': {
    atoms: [
      { el: 'O', x: -0.6, y: 0, z: 0 },
      { el: 'O', x: 0.6, y: 0, z: 0 },
    ],
    bonds: [[0, 1]],
  },
  'CO₂': {
    atoms: [
      { el: 'C', x: 0, y: 0, z: 0 },
      { el: 'O', x: -1.16, y: 0, z: 0 },
      { el: 'O', x: 1.16, y: 0, z: 0 },
    ],
    bonds: [
      [0, 1],
      [0, 2],
    ],
  },
  'N₂': {
    atoms: [
      { el: 'N', x: -0.55, y: 0, z: 0 },
      { el: 'N', x: 0.55, y: 0, z: 0 },
    ],
    bonds: [[0, 1]],
  },
  'Ca²⁺': { atoms: [{ el: 'Ca', x: 0, y: 0, z: 0 }], bonds: [] },
  'Ce³⁺': { atoms: [{ el: 'Ce', x: 0, y: 0, z: 0 }], bonds: [] },
  '·OH (羟基自由基)': {
    atoms: [
      { el: 'O', x: 0, y: 0, z: 0 },
      { el: 'H', x: 0.97, y: 0, z: 0 },
    ],
    bonds: [[0, 1]],
  },
};

export function buildMolecule(kind: MoleculeParams['kind']): GeometryData {
  const m = MOLECULES[kind] ?? MOLECULES['H₂O'];
  return {
    atoms: m.atoms.map((a) => ({ ...a })),
    bonds: m.bonds.map((b) => [...b] as Bond),
  };
}

/* ============================================================
 * 素材 5：密排原子层（packed_layers，2026-09-10）
 * 二维密排（三角网格）层 → ABAB 六方 / ABCABC 立方三维堆叠。
 * 第一层每个原子可经 mask 单独设置"是否参与堆叠"：
 * 不参与（'0'）的原子列只保留第一层（上方不生长 → 台阶/缺陷示意）。
 *
 * 几何推导（d = dist，硬球理想密排）：
 *  - A 位格点（r 行 c 列）：x = (c + (r%2)·0.5)·d，y = r·(√3/2)·d
 *  - 层间水平滑移：A→B = (d/2, √3·d/6)（上三角空位中心）；
 *    ABC 的 C = 2×滑移 = (d, √3·d/3)（≡ 下三角空位中心，3s 为 A 格矢）
 *  - 层间距 h = √(2/3)·d（密堆积最近邻距不变：√(h² + d²/3) = d）
 *  - 掩码归属：上层格点坐在第一层空位上方（不与原子同心），
 *    归属水平距离最近的第一层格点（平局取索引小者，确定性）；
 *    该格点 mask 为 '0' → 此上层原子不生成。
 * ============================================================ */
export function buildPackedLayers(raw: PackedLayerParams): GeometryData {
  // z.input 类型字段可空（字面量直调/旧数据缺键）：按 schema 默认值归一化
  const p = {
    el: raw.el ?? 'Si',
    n: raw.n ?? 7,
    layers: raw.layers ?? 3,
    dist: raw.dist ?? 4,
    stacking: raw.stacking ?? 'AB',
    mask: raw.mask ?? '',
  };
  const d = p.dist;
  const n = p.n;
  const rowH = (Math.sqrt(3) / 2) * d;
  const h = Math.sqrt(2 / 3) * d;
  // 三种堆叠位的水平滑移（相对 A 位）
  const shifts = {
    A: { x: 0, y: 0 },
    B: { x: d / 2, y: (Math.sqrt(3) * d) / 6 },
    C: { x: d, y: (Math.sqrt(3) * d) / 3 },
  } as const;
  const shiftOf = (k: number): { x: number; y: number } =>
    p.stacking === 'AB' ? (k % 2 === 0 ? shifts.A : shifts.B) : [shifts.A, shifts.B, shifts.C][k % 3]!;

  // 第一层格点坐标（掩码归属与上层生成共用）
  const ax = (r: number, c: number): number => (c + (r % 2) * 0.5) * d;
  const ay = (r: number): number => r * rowH;
  const joins = (i: number): boolean => p.mask.charAt(i) !== '0'; // 缺省/越界 = 参与

  const atoms: Atom[] = [];
  // 第 0 层：完整底座（"不参与"的原子也保留第一层）
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      atoms.push({ el: p.el, x: ax(r, c), y: ay(r), z: 0, layer: 0 });
    }
  }
  // 第 1..layers-1 层：同 n×n 网格 + 层间滑移，按掩码归属裁剪
  for (let k = 1; k < p.layers; k++) {
    const s = shiftOf(k);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const px = ax(r, c) + s.x;
        const py = ay(r) + s.y;
        // 归属最近的第一层格点（n≤12 → n⁴ ≈ 2 万次距离计算，微不足道）
        let best = -1;
        let bestD2 = Infinity;
        for (let rr = 0; rr < n; rr++) {
          for (let cc = 0; cc < n; cc++) {
            const dx = px - ax(rr, cc);
            const dy = py - ay(rr);
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2 - 1e-9) {
              bestD2 = d2;
              best = rr * n + cc;
            }
          }
        }
        if (joins(best)) atoms.push({ el: p.el, x: px, y: py, z: k * h, layer: k });
      }
    }
  }
  // 居中（与片层一致的整体包围盒中心平移）
  const centered = C.center(atoms).atoms;
  const bonds = C.computeBonds(centered);
  return { atoms: centered, bonds, meta: { n: p.n, layers: p.layers } };
}
