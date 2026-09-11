/**
 * SMILES 分子导入 v1.0 —— T-2.8（决策 D08：SMILES 先行）
 *
 * 实现取舍（对 D08 实现细节的偏差，决策本质不变）：v1.0 不引入 RDKit WASM
 * （约 10MB 依赖 + 懒加载/locateFile 复杂度，且 minimal-lib 的 3D 构象 API 可用性
 * 存疑），改为内置「SMILES 解析器 + 规则式 3D 构象生成」：
 *   - 解析：有机子集（B C N O P S F Cl Br I + 芳香 c n o s p）、方括号原子、
 *     键号 - = # :、分支、环闭合并 digit/%nn、断点 .；
 *   - 构象：环系优先嵌入（首环平面正多边形，稠环共面延展），非环原子按
 *     sp3/sp2/lin 几何模板 BFS 生长（16 个二面角候选取碰撞最小），末轮
 *     确定性弛豫（非键斥力 + 键长回拉）；
 *   - 输出为示意级 3D（科研机理图精度），与 RDKit ETKDG 有差距——接口已按
 *     smilesToMolecule 抽象，后续可无感换装/叠加 RDKit WASM 增强器。
 * 全程零运行时依赖、离线可用、确定性输出（存参数不存网格，D02）。
 */
import { ELEMENTS } from '../elements';

export class SmilesError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
    this.name = 'SmilesError';
  }
}

/* ============================================================
 * 一、解析：SMILES → 分子图
 * ============================================================ */

export interface GraphAtom {
  el: string;
  aromatic: boolean;
  charge: number;
  /** 隐式氢数（解析期按价态计算） */
  hCount: number;
}

export interface GraphBond {
  a: number;
  b: number;
  /** 1 | 2 | 3；芳香键记 1.5 */
  order: number;
}

export interface SmilesGraph {
  atoms: GraphAtom[];
  bonds: GraphBond[];
}

/** 有机子集（大写，含双字母）；价态按最小满足原则 */
const ORGANIC_VALENCE: Record<string, number[]> = {
  B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6],
  F: [1], Cl: [1], Br: [1], I: [1],
};
const AROMATIC_VALENCE: Record<string, number> = { c: 4, n: 3, o: 2, s: 2, p: 3 };
/**
 * 方括号原子合法集：以元素显示库为单一事实源（2026-09-11 扩全周期表——
 * 此前手写 26 元素白名单，[Au+]/[PtCl6]2- 等离子无法解析）。
 */
const BRACKET_ELEMENTS: ReadonlySet<string> = new Set(Object.keys(ELEMENTS));

function implicitH(
  el: string,
  aromatic: boolean,
  orderSum: number,
  bracketH: number | null,
  charge: number,
): number {
  if (bracketH !== null) return bracketH;
  if (charge !== 0) return 0; // 方括号带电原子无隐式氢（[Cl-] 不是 HCl）
  if (aromatic) return Math.max(0, Math.round((AROMATIC_VALENCE[el] ?? 3) - orderSum));
  const valences = ORGANIC_VALENCE[el];
  if (!valences) return 0;
  for (const v of valences) {
    if (orderSum <= v) return v - orderSum;
  }
  return 0;
}

/** 解析 SMILES（失败抛 SmilesError，含位置） */
export function parseSmiles(smiles: string): SmilesGraph {
  const s = smiles.trim();
  if (!s) throw new SmilesError('SMILES 为空', 0);
  const atoms: GraphAtom[] = [];
  const bonds: GraphBond[] = [];
  const adjacency: Array<Array<{ to: number; order: number }>> = [];

  let pendingOrder = 0; // 0 = 未指定
  let prev = -1;
  const branchStack: number[] = [];
  const ringBonds = new Map<string, { atom: number; order: number }>();

  const addAtom = (el: string, aromatic: boolean, charge = 0, bracketH: number | null = null): number => {
    const idx = atoms.length;
    atoms.push({ el, aromatic, charge, hCount: 0 });
    adjacency.push([]);
    if (prev >= 0) {
      const order = pendingOrder || (aromatic && atoms[prev].aromatic ? 1.5 : 1);
      bonds.push({ a: prev, b: idx, order });
      adjacency[prev].push({ to: idx, order });
      adjacency[idx].push({ to: prev, order });
    }
    pendingOrder = 0;
    prev = idx;
    // 隐式氢在闭链后统一算（环键影响价态）——先挂临时值
    atomBracketH[idx] = bracketH;
    return idx;
  };
  const atomBracketH: Array<number | null> = [];

  let i = 0;
  const peek = (): string => s[i] ?? '';
  while (i < s.length) {
    const ch = peek();
    if (ch === '.') {
      prev = -1;
      i++;
      continue;
    }
    if (ch === '(') {
      if (prev < 0) throw new SmilesError('分支前缺少原子', i);
      branchStack.push(prev);
      i++;
      continue;
    }
    if (ch === ')') {
      const p = branchStack.pop();
      if (p === undefined) throw new SmilesError('括号不匹配', i);
      prev = p;
      i++;
      continue;
    }
    if (ch === '-' || ch === '=' || ch === '#' || ch === ':' || ch === '/' || ch === '\\') {
      pendingOrder = ch === '-' ? 1 : ch === '=' ? 2 : ch === '#' ? 3 : ch === ':' ? 1.5 : 1;
      i++;
      continue;
    }
    if (ch === '[') {
      const close = s.indexOf(']', i);
      if (close < 0) throw new SmilesError('方括号未闭合', i);
      const body = s.slice(i + 1, close);
      // 电荷两种合法写法：+4（符号在前）与 4+（数字在前，2026-09-11 支持）
      const m = /^(\d+)?([A-Z][a-z]?|[a-z])(@{1,2})?(H\d*)?((?:\+|-)\d+|(?:\+|-)+|\d*[+-])?(?::\d+)?$/.exec(body);
      if (!m || !m[2]) throw new SmilesError(`无法解析方括号原子 [${body}]`, i);
      let el = m[2];
      if (BRACKET_ELEMENTS.has(el) === false) {
        // 单字母小写等非常见写法：首字母大写化尝试
        const fixed = el[0].toUpperCase() + el.slice(1);
        if (BRACKET_ELEMENTS.has(fixed)) el = fixed;
        else throw new SmilesError(`不支持的元素「${el}」`, i);
      }
      const hPart = m[4];
      const bracketH = hPart ? (hPart === 'H' ? 1 : parseInt(hPart.slice(1), 10) || 0) : null;
      const chargePart = m[5];
      let charge = 0;
      if (chargePart) {
        // "+4" / "++" / "4+" / "2-" → 符号与幅值
        const plus = chargePart.includes('+');
        const digits = chargePart.match(/\d/);
        charge = (plus ? 1 : -1) * (digits ? parseInt(chargePart.replace(/[^\d]/g, ''), 10) || 1 : 1);
      }
      addAtom(el, false, charge, bracketH);
      i = close + 1;
      continue;
    }
    // 有机子集 / 芳香原子
    const two = s.slice(i, i + 2);
    if (ORGANIC_VALENCE[two]) {
      addAtom(two, false);
      i += 2;
      continue;
    }
    if (ORGANIC_VALENCE[ch]) {
      addAtom(ch, false);
      i++;
      continue;
    }
    if (AROMATIC_VALENCE[ch]) {
      addAtom(ch, true);
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const sym = ch;
      const ring = ringBonds.get(sym);
      if (ring) {
        const order = pendingOrder || ring.order || (atoms[prev].aromatic && ring.atom >= 0 ? 1.5 : 1);
        bonds.push({ a: ring.atom, b: prev, order });
        adjacency[ring.atom].push({ to: prev, order });
        adjacency[prev].push({ to: ring.atom, order });
        ringBonds.delete(sym);
        pendingOrder = 0;
      } else {
        if (prev < 0) throw new SmilesError('环编号前缺少原子', i);
        ringBonds.set(sym, { atom: prev, order: pendingOrder });
        pendingOrder = 0;
      }
      i++;
      continue;
    }
    if (ch === '%') {
      const numStr = s.slice(i + 1, i + 3);
      if (!/^\d{2}$/.test(numStr)) throw new SmilesError('% 后需两位数字', i);
      const ring = ringBonds.get(numStr);
      if (ring) {
        bonds.push({ a: ring.atom, b: prev, order: pendingOrder || ring.order || 1 });
        adjacency[ring.atom].push({ to: prev, order: pendingOrder || ring.order || 1 });
        adjacency[prev].push({ to: ring.atom, order: pendingOrder || ring.order || 1 });
        ringBonds.delete(numStr);
        pendingOrder = 0;
      } else {
        if (prev < 0) throw new SmilesError('环编号前缺少原子', i);
        ringBonds.set(numStr, { atom: prev, order: pendingOrder });
        pendingOrder = 0;
      }
      i += 3;
      continue;
    }
    throw new SmilesError(`无法识别的字符「${ch}」`, i);
  }
  if (ringBonds.size) {
    throw new SmilesError(`环编号未闭合：${[...ringBonds.keys()].join(',')}`, s.length);
  }
  if (branchStack.length) throw new SmilesError('括号未闭合', s.length);
  if (!atoms.length) throw new SmilesError('SMILES 为空', 0);

  // 隐式氢（含环键后价态已完整）
  const orderSum = adjacency.map((list) => list.reduce((acc, e) => acc + e.order, 0));
  atoms.forEach((a, idx) => {
    a.hCount = implicitH(a.el, a.aromatic, orderSum[idx], atomBracketH[idx], a.charge);
  });
  return { atoms, bonds };
}

/* ============================================================
 * 二、3D 构象生成（环系优先 + 模板生长 + 确定性弛豫）
 * ============================================================ */

export interface Mol3DAtom {
  el: string;
  x: number;
  y: number;
  z: number;
}

export interface Mol3D {
  atoms: Mol3DAtom[];
  /** [i, j, order] */
  bonds: Array<[number, number, number]>;
}

/** 键长（Å，示意级） */
function bondLength(el1: string, el2: string, order: number, aromatic: boolean): number {
  if (el1 === 'H' || el2 === 'H') return 1.09;
  if (aromatic) return 1.39;
  if (order >= 3) return 1.2;
  if (order === 2) {
    if (el1 === 'C' && el2 === 'C') return 1.34;
    return 1.24;
  }
  if (el1 === 'C' && el2 === 'C') return 1.52;
  return 1.43;
}

const VDW: Record<string, number> = {
  H: 1.2, C: 1.7, N: 1.55, O: 1.52, P: 1.8, S: 1.8, F: 1.47, Cl: 1.75,
  Br: 1.85, I: 1.98, B: 1.92, Na: 2.27, Mg: 1.73, K: 2.75, Ca: 2.31,
  Fe: 2.04, Zn: 1.39, Ce: 2.4, Ti: 2.11, Se: 1.9, Si: 2.1,
};
const vdwOf = (el: string): number => VDW[el] ?? 1.7;

/** 找环（DFS 背边；返回每条背边构成的环路径，可能含稠环重叠） */
function findRings(bonds: GraphBond[], n: number): number[][] {
  const adj: Array<Array<{ to: number; idx: number }>> = Array.from({ length: n }, () => []);
  bonds.forEach((b, idx) => {
    adj[b.a].push({ to: b.b, idx });
    adj[b.b].push({ to: b.a, idx });
  });
  const rings: number[][] = [];
  const visited = new Array<boolean>(n).fill(false);
  const parent = new Array<number>(n).fill(-1);
  const depthOf = new Array<number>(n).fill(0);
  const dfs = (u: number, from: number, depth: number): void => {
    visited[u] = true;
    parent[u] = from;
    depthOf[u] = depth;
    for (const { to } of adj[u]) {
      if (to === from) continue;
      if (!visited[to]) dfs(to, u, depth + 1);
      else if (depthOf[to] < depthOf[u]) {
        // 背边：回溯路径即环
        const ring: number[] = [];
        let cur = u;
        while (cur !== to) {
          ring.push(cur);
          cur = parent[cur];
          if (cur < 0) break;
        }
        ring.push(to);
        rings.push(ring);
      }
    }
  };
  for (let i = 0; i < n; i++) if (!visited[i]) dfs(i, -1, 0);
  return rings;
}

/** 几何模板方向（局部坐标系，单位向量） */
function templateDirs(kind: 'tetra' | 'tri' | 'lin' | 'bent' | 'terminal'): THREE_V3[] {
  const n = (x: number, y: number, z: number): THREE_V3 => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  switch (kind) {
    case 'tetra':
      return [n(1, 1, 1), n(-1, -1, 1), n(-1, 1, -1), n(1, -1, -1)];
    case 'tri':
      return [n(1, 0, 0), n(-0.5, 0.866, 0), n(-0.5, -0.866, 0)];
    case 'lin':
      return [n(1, 0, 0), n(-1, 0, 0)];
    case 'bent':
      return [n(1, 0, 0), n(Math.cos((104.5 * Math.PI) / 180), Math.sin((104.5 * Math.PI) / 180), 0)];
    case 'terminal':
      return [n(1, 0, 0)];
  }
}
type THREE_V3 = [number, number, number];

/* ---- 零依赖向量工具（core 层不引 THREE；Rodrigues 旋转公式） ---- */
const vsub = (a: THREE_V3, b: THREE_V3): THREE_V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a: THREE_V3, b: THREE_V3): THREE_V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vdot = (a: THREE_V3, b: THREE_V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a: THREE_V3): number => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a: THREE_V3): THREE_V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clampN = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** 绕单位轴 axis 旋转 v 角度 ang */
const vrotate = (v: THREE_V3, axis: THREE_V3, ang: number): THREE_V3 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const axv = vdot(axis, v);
  const cr = vcross(axis, v);
  return [
    v[0] * c + cr[0] * s + axis[0] * axv * (1 - c),
    v[1] * c + cr[1] * s + axis[1] * axv * (1 - c),
    v[2] * c + cr[2] * s + axis[2] * axv * (1 - c),
  ];
};

/** 原子局部几何类型 */
type TemplateKind = 'tetra' | 'tri' | 'lin' | 'bent' | 'terminal';
function geometryOf(el: string, aromatic: boolean, neighborOrderSum: number, degree: number): TemplateKind {
  void el;
  if (degree <= 1) return 'terminal';
  const sum = neighborOrderSum;
  if (sum >= 3.9) return 'tetra';
  if (sum >= 2.7) return 'tri'; // 双键/芳香
  if (sum >= 1.8) return degree >= 2 ? 'bent' : 'terminal'; // 一根双键 + 1 邻
  if (aromatic) return 'tri';
  if (degree === 4) return 'tetra';
  if (degree === 3) return 'tri';
  if (degree === 2) return 'bent';
  return 'terminal';
}

/**
 * SMILES → 3D 分子（示意级构象；同输入同输出）。
 * 步骤：加氢 → 环系平面嵌入 → 非环模板生长（二面角碰撞规避）→ 确定性弛豫。
 */
export function smilesToMolecule(graph: SmilesGraph): Mol3D {
  // 加氢展开：先建全原子表（重原子 + 隐式氢），再建键表与邻接（索引稳定）
  // 芳香小写（c/n/…）规范化为大写元素符号（元素表/渲染配色按大写索引）
  const allAtoms = graph.atoms.map((a) => ({ el: a.aromatic ? a.el.toUpperCase() : a.el, aromatic: a.aromatic }));
  const firstH: number[] = [];
  graph.atoms.forEach((a) => {
    firstH.push(allAtoms.length);
    for (let h = 0; h < a.hCount; h++) allAtoms.push({ el: 'H', aromatic: false });
  });
  const allBonds: Array<{ a: number; b: number; order: number; aromatic: boolean }> = [];
  graph.bonds.forEach((b) => allBonds.push({ a: b.a, b: b.b, order: b.order, aromatic: b.order === 1.5 }));
  graph.atoms.forEach((a, i) => {
    for (let h = 0; h < a.hCount; h++) allBonds.push({ a: i, b: firstH[i] + h, order: 1, aromatic: false });
  });
  const fullAdj: Array<Array<{ to: number; len: number; order: number }>> = Array.from(
    { length: allAtoms.length },
    () => [],
  );
  for (const b of allBonds) {
    const len = bondLength(allAtoms[b.a].el, allAtoms[b.b].el, b.order, b.aromatic);
    fullAdj[b.a].push({ to: b.b, len, order: b.order });
    fullAdj[b.b].push({ to: b.a, len, order: b.order });
  }

  const N = allAtoms.length;
  const coords: THREE_V3[] = new Array(N);
  const placed = new Array<boolean>(N).fill(false);
  const dirOf: Array<Record<number, number>> = new Array(N);

  const geometryKind = (u: number): TemplateKind => {
    const sum = fullAdj[u].length;
    const aromatic = allAtoms[u].aromatic;
    return geometryOf(allAtoms[u].el, aromatic, sum, fullAdj[u].length);
  };
  const posOf = (i: number): THREE_V3 => coords[i] ?? [0, 0, 0];

  /** 为 placed 原子 u 的邻居 nb 分配模板方向，并换算到世界系（以首个已放置邻居为参考） */
  const nextDirection = (u: number, nb: number): THREE_V3 => {
    dirOf[u] = dirOf[u] ?? {};
    // 芳香环上的 H：沿环径向朝外（避免模板方向朝环内造成近距离冲突）
    const cent = ringCentroid[u];
    if (cent && allAtoms[nb].el === 'H' && allAtoms[u].aromatic) {
      return vnorm(vsub(posOf(u), cent));
    }
    const kind = geometryKind(u);
    const dirs = templateDirs(kind);
    const used = new Set(Object.values(dirOf[u]));
    let slot = dirs.findIndex((_, k) => !used.has(k));
    if (slot < 0) slot = dirs.length - 1;
    dirOf[u][nb] = slot;
    const local = dirs[slot];
    const placedEntry = Object.entries(dirOf[u]).find(([nAt, k]) => placed[Number(nAt)] && Number(nAt) !== nb && k !== slot);
    if (!placedEntry) return local;
    const refIdx = Number(placedEntry[0]);
    const refDir = dirs[placedEntry[1]];
    const p = vsub(posOf(u), posOf(refIdx));
    if (vlen(p) < 1e-8) return local;
    const r0 = refDir;
    let axis = vcross(r0, vnorm(p));
    if (vlen(axis) < 1e-8) return local;
    axis = vnorm(axis);
    const ang = Math.acos(clampN(vdot(r0, vnorm(p)), -1, 1));
    return vrotate(local, axis, ang);
  };

  /** 在 from 沿 dir、距 len 处放置 nb：16 个二面角候选取碰撞最小（确定性） */
  const placeNeighbor = (from: number, nb: number, dir: THREE_V3, len: number): void => {
    const fromPos = posOf(from);
    const offset = [dir[0] * len, dir[1] * len, dir[2] * len] as THREE_V3;
    // 二面角轴 = 父原子的参考键方向（from → 已放置的其他邻居）：
    // 绕该轴旋转 offset，16 个候选取"离已放置原子最近距离"最大者（真实二面角碰撞规避）。
    const grand = fullAdj[from].find((e) => placed[e.to] && e.to !== nb);
    const axis = grand ? vnorm(vsub(posOf(grand.to), fromPos)) : ([0, 0, 1] as THREE_V3);
    const anchor = [fromPos[0] + offset[0], fromPos[1] + offset[1], fromPos[2] + offset[2]] as THREE_V3;
    let bestPos: THREE_V3 = anchor;
    let bestScore = -Infinity;
    for (let a = 0; a < 16; a++) {
      const p = vrotate(offset, axis, (a / 16) * Math.PI * 2);
      const pt = [fromPos[0] + p[0], fromPos[1] + p[1], fromPos[2] + p[2]] as THREE_V3;
      let minD = Infinity;
      for (let i = 0; i < N; i++) {
        if (!placed[i] || i === from) continue;
        minD = Math.min(minD, vlen(vsub(pt, coords[i])));
      }
      const score = minD === Infinity ? 1e9 : minD;
      if (score > bestScore) {
        bestScore = score;
        bestPos = pt;
      }
    }
    coords[nb] = bestPos;
    placed[nb] = true;
  };

  // 1) 环系优先：全新环 → 平面正多边形；稠环 → 共面延展（内角转 2π/nR）
  const rings = findRings(graph.bonds, graph.atoms.length);
  const ringCentroid: Record<number, THREE_V3> = {};
  for (const ring of rings) {
    if (ring.every((a) => placed[a])) continue;
    if (ring.every((a) => !placed[a])) {
      const nR = ring.length;
      const side = bondLength('C', 'C', 1.5, true);
      const R = side / (2 * Math.sin(Math.PI / nR));
      for (let k = 0; k < nR; k++) {
        const ang = (k / nR) * Math.PI * 2;
        coords[ring[k]] = [R * Math.cos(ang), R * Math.sin(ang), 0];
        placed[ring[k]] = true;
        ringCentroid[ring[k]] = [0, 0, 0]; // 正多边形质心 = 原点
      }
    } else {
      // 稠环：从已放置原子沿环序共面延展；转向 ±2π/nR 取"离已放置质心更远"的一侧（防翻进第一环内）
      const startIdx = ring.findIndex((a) => placed[a]);
      const ordered = [...ring.slice(startIdx), ...ring.slice(0, startIdx)];
      const nR = ring.length;
      const turn = (2 * Math.PI) / nR;
      // 已放置部分质心（第二环应朝其反方向延展）
      const centroid = (() => {
        const ps = ordered.filter((a) => placed[a]).map((a) => coords[a]);
        if (!ps.length) return [0, 0, 0] as THREE_V3;
        return [
          ps.reduce((acc, p) => acc + p[0], 0) / ps.length,
          ps.reduce((acc, p) => acc + p[1], 0) / ps.length,
          ps.reduce((acc, p) => acc + p[2], 0) / ps.length,
        ] as THREE_V3;
      })();
      for (let k = 0; k < ordered.length; k++) {
        const a = ordered[k];
        if (placed[a]) continue;
        const prevA = ordered[k - 1] ?? ordered[ordered.length - 1];
        const anchor = coords[prevA];
        const before = k >= 2 ? ordered[k - 2] : undefined;
        const prevDir = (() => {
          if (before === undefined || !placed[before]) return [1, 0, 0] as THREE_V3;
          return vsub(anchor, coords[before]);
        })();
        const ang0 = Math.atan2(prevDir[1], prevDir[0]);
        const len = fullAdj[prevA].find((e) => e.to === a)?.len ?? 1.4;
        const candPlus: THREE_V3 = [anchor[0] + Math.cos(ang0 + turn) * len, anchor[1] + Math.sin(ang0 + turn) * len, anchor[2] ?? 0];
        const candMinus: THREE_V3 = [anchor[0] + Math.cos(ang0 - turn) * len, anchor[1] + Math.sin(ang0 - turn) * len, anchor[2] ?? 0];
        const dPlus = vlen(vsub(candPlus, centroid));
        const dMinus = vlen(vsub(candMinus, centroid));
        coords[a] = dPlus >= dMinus ? candPlus : candMinus;
        placed[a] = true;
      }
    }
  }

  // 2) 非环原子 BFS 模板生长（覆盖全分子）
  // 连通分量标记：无已放置原子的分量各自起根（断键分子/离子对），错位摆放后由全局弛豫自然分开
  const compId = new Array<number>(N).fill(-1);
  let nComp = 0;
  for (let i = 0; i < N; i++) {
    if (compId[i] >= 0) continue;
    const stack = [i];
    compId[i] = nComp;
    while (stack.length) {
      const u = stack.pop() as number;
      for (const e of fullAdj[u]) {
        if (compId[e.to] < 0) {
          compId[e.to] = nComp;
          stack.push(e.to);
        }
      }
    }
    nComp++;
  }
  const rootDone = new Array<boolean>(nComp).fill(false);
  const queue: number[] = [];
  let rootIdx = 0;
  for (let i = 0; i < N; i++) {
    if (!placed[i] && !rootDone[compId[i]]) {
      coords[i] = [0, rootIdx * 9, 0];
      placed[i] = true;
      rootDone[compId[i]] = true;
      rootIdx++;
    }
    if (placed[i]) queue.push(i);
  }
  while (queue.length) {
    const u = queue.shift() as number;
    // 键级降序：先放双键/芳环骨架，后放单键氢/羟基——后者评分可避开前者
    const ns = [...fullAdj[u]].sort((a, b) => b.order - a.order);
    for (const e of ns) {
      if (placed[e.to]) continue;
      const dir = nextDirection(u, e.to);
      placeNeighbor(u, e.to, dir, e.len);
      queue.push(e.to);
    }
  }

  // 3) 确定性弛豫：非键斥力 + 键长回拉（30 轮）
  const idealLen = new Map<string, number>();
  for (const e of fullAdj.flatMap((list, u) => list.map((e2) => [u, e2] as const))) {
    const k = e[0] < e[1].to ? `${e[0]},${e[1].to}` : `${e[1].to},${e[0]}`;
    idealLen.set(k, e[1].len);
  }
  const bondCorrection = (): void => {
    for (let iter = 0; iter < 8; iter++) {
      for (const b of allBonds) {
        const ideal = bondLength(allAtoms[b.a].el, allAtoms[b.b].el, 1, b.aromatic);
        const d = vsub(coords[b.b], coords[b.a]);
        const dl = vlen(d) || 1e-6;
        const corr = ((dl - ideal) / dl) * 0.5;
        const shift = [d[0] * corr, d[1] * corr, d[2] * corr] as THREE_V3;
        coords[b.a] = [coords[b.a][0] + shift[0], coords[b.a][1] + shift[1], coords[b.a][2] + shift[2]];
        coords[b.b] = [coords[b.b][0] - shift[0], coords[b.b][1] - shift[1], coords[b.b][2] - shift[2]];
      }
    }
  };

  // 交错 3 组「10 轮弛豫 + 键长校正」，净位移可累积（解决 O…C 等受键约束的近距离对）
  for (let phase = 0; phase < 3; phase++) {
    for (let iter = 0; iter < 10; iter++) {
      const fx = new Float64Array(N), fy = new Float64Array(N), fz = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = coords[j][0] - coords[i][0], dy = coords[j][1] - coords[i][1], dz = coords[j][2] - coords[i][2];
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          const key = `${i},${j}`;
          const ideal = idealLen.get(key);
          if (ideal !== undefined) {
            const f = (d - ideal) * 0.15;
            const ux = dx / d, uy = dy / d, uz = dz / d;
            fx[i] += ux * f; fy[i] += uy * f; fz[i] += uz * f;
            fx[j] -= ux * f; fy[j] -= uy * f; fz[j] -= uz * f;
          } else {
            const minD = 0.75 * (vdwOf(allAtoms[i].el) + vdwOf(allAtoms[j].el));
            if (d < minD) {
              const f = ((minD - d) / minD) * 0.5;
              const ux = dx / d, uy = dy / d, uz = dz / d;
              fx[i] -= ux * f; fy[i] -= uy * f; fz[i] -= uz * f;
              fx[j] += ux * f; fy[j] += uy * f; fz[j] += uz * f;
            }
          }
        }
      }
      for (let i = 0; i < N; i++) {
        coords[i] = [coords[i][0] + fx[i], coords[i][1] + fy[i], coords[i][2] + fz[i]];
      }
    }
    bondCorrection();
  }

  return {
    atoms: allAtoms.map((a, i) => ({ el: a.el, x: coords[i][0], y: coords[i][1], z: coords[i][2] })),
    bonds: allBonds.map((b) => [b.a, b.b, 1] as [number, number, number]),
  };
}

/** SMILES → 3D（一步入口：解析 + 构象；非法 SMILES 抛 SmilesError） */
export function smilesTo3D(smiles: string): Mol3D {
  return smilesToMolecule(parseSmiles(smiles));
}
