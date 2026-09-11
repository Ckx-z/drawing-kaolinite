/**
 * 化学式导入 —— 2026-09-08（用户需求：导入框兼容化学式输入，大小写不敏感）
 *
 * 双路输入链路中的"化学式"路（LibraryPanel 先试 SMILES、失败再试本模块）：
 *  - parseFormula：严格化学式优先（保留大小写语义——Co=钴、CO=一氧化碳 C+O）；
 *    不匹配则大小写归一重试（si/SI → Si），无分隔字母串贪心双字母优先拆分
 *    （nacl → NaCl、fe2o3 → Fe2O3）。元素合法性以 ELEMENTS 显示库为准。
 *  - buildFormulaCluster：化学式不含结构信息 → 紧密堆叠团簇（贪心表面吸附
 *    生长：新原子吸附在"间隙最充裕"的已放原子表面），近距原子按共价半径
 *    自动连键 → 示意级"单原子 / 分子 / 离子团"模型（Si=单球，Fe2O3=紧密团）。
 * 零依赖、确定性输出（同输入同结果，D02 存参数不存网格）。
 */
import { ELEMENTS } from '../elements';
import type { Atom, Bond } from '../geometry';

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

export interface FormulaToken {
  el: string;
  count: number;
}

/** 单团簇原子数上限（防误输入撑爆构建） */
const MAX_ATOMS = 200;

/** 归一化双字母元素（si/SI/sI → Si） */
const norm2 = (a: string, b: string): string => a.toUpperCase() + b.toLowerCase();

/** 字母块贪心拆分为合法元素序列（双字母优先，如 nacl → Na Cl；失败返回 null） */
function splitBlock(block: string): string[] | null {
  const els: string[] = [];
  let i = 0;
  while (i < block.length) {
    if (i + 2 <= block.length) {
      const two = norm2(block[i]!, block[i + 1]!);
      if (ELEMENTS[two]) {
        els.push(two);
        i += 2;
        continue;
      }
    }
    const one = block[i]!.toUpperCase();
    if (ELEMENTS[one]) {
      els.push(one);
      i += 1;
      continue;
    }
    return null;
  }
  return els;
}

/** 严格模式字母块拆分：[A-Z][a-z]? 状态机（CO → C+O 一氧化碳；Co → 钴） */
function splitStrict(block: string): string[] | null {
  const els: string[] = [];
  let i = 0;
  while (i < block.length) {
    const ch = block[i]!;
    if (ch < 'A' || ch > 'Z') return null; // 严格模式：元素必须大写开头
    if (i + 1 < block.length && block[i + 1]! >= 'a' && block[i + 1]! <= 'z') {
      const two = ch + block[i + 1]!;
      if (ELEMENTS[two]) {
        els.push(two);
        i += 2;
        continue;
      }
      return null; // 如 "Cx"：非法大小写组合
    }
    if (ELEMENTS[ch]) {
      els.push(ch);
      i += 1;
      continue;
    }
    return null;
  }
  return els;
}

/** 消费"字母块+计量数"序列；语法不合法返回 null */
function tokenize(input: string, strictCase: boolean): FormulaToken[] | null {
  const tokens: FormulaToken[] = [];
  let rest = input;
  while (rest.length) {
    const m = /^([A-Za-z]+)(\d*)/.exec(rest);
    if (!m || m[0].length === 0) return null; // 含非法字符
    const block = m[1]!;
    const els = strictCase ? splitStrict(block) : splitBlock(block);
    if (!els) return null;
    const count = m[2] ? Number(m[2]) : 1;
    if (!Number.isInteger(count) || count < 1) return null;
    // 尾计量只作用于块内最后一个元素（2026-09-11 修复：PtCl4 → Pt + Cl×4；
    // 此前挂到块内全部元素得 Pt4Cl4，无化学对应的"块整体重复"语义）
    // 相邻同元素合并（贪心拆分可能产生，如 hho → H2O）
    els.forEach((el, idx) => {
      const c = idx === els.length - 1 ? count : 1;
      const tail = tokens[tokens.length - 1];
      if (tail && tail.el === el) tail.count += c;
      else tokens.push({ el, count: c });
    });
    rest = rest.slice(m[0].length);
  }
  return tokens.length ? tokens : null;
}

/**
 * 解析化学式：含小写字母 → 严格模式优先（保留大小写语义：Co=钴、CO 一氧化碳
 * 走 SMILES 链路）；全大写/全小写（大小写信息缺失）→ 直接宽松归一
 * （si/SI → Si，双字母元素优先）。两路都失败抛 FormulaError。
 */
export function parseFormula(input: string): FormulaToken[] {
  const s = input.trim();
  if (!s) throw new FormulaError('化学式为空');
  if (s.length > 64) throw new FormulaError('化学式过长');
  const hasLower = /[a-z]/.test(s);
  const tokens = (hasLower ? tokenize(s, true) : null) ?? tokenize(s, false);
  if (!tokens) throw new FormulaError(`无法识别的化学式：${s}`);
  const total = tokens.reduce((n, t) => n + t.count, 0);
  if (total > MAX_ATOMS) throw new FormulaError(`原子数 ${total} 超过上限 ${MAX_ATOMS}`);
  return tokens;
}

/** 规范化学式串（存储/显示用，如 fe2o3 → Fe2O3） */
export function canonicalFormula(tokens: FormulaToken[]): string {
  return tokens.map((t) => t.el + (t.count > 1 ? t.count : '')).join('');
}

/* ---------- 团簇构建 ---------- */

/** 表面吸附候选方向：6 轴向 + 8 体对角，兼顾确定性与覆盖度 */
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1],
];

const cov = (el: string): number => ELEMENTS[el]?.cov ?? 1.0;

/** 键连判据：两共价半径之和 × 宽容系数（H-H 不断键相连，避免 H2 假键） */
const BOND_TOL = 1.3;

/** 化学式 → 紧密堆叠团簇（贪心表面吸附生长 + 近距自动连键） */
export function buildFormulaCluster(tokens: FormulaToken[]): { atoms: Atom[]; bonds: Bond[] } {
  // 按计量展开（顺序稳定 → 确定性）
  const list: string[] = [];
  for (const t of tokens) for (let k = 0; k < t.count; k++) list.push(t.el);

  const pos: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < list.length; i++) {
    const el = list[i]!;
    if (i === 0) {
      pos.push({ x: 0, y: 0, z: 0 });
      continue;
    }
    if (pos.length === 1) {
      const r = cov(list[0]!) + cov(el);
      pos.push({ x: r, y: 0, z: 0 });
      continue;
    }
    // 贪心吸附：紧凑优先（离质心近 = 分子感团簇），穿透强惩罚，微偏好留缝。
    // 注意不能以"最小间隙最大化"为主项——会把原子推离表面脱离键程（对角远端）。
    const cx = pos.reduce((s, p) => s + p.x, 0) / pos.length;
    const cy = pos.reduce((s, p) => s + p.y, 0) / pos.length;
    const cz = pos.reduce((s, p) => s + p.z, 0) / pos.length;
    let best: { x: number; y: number; z: number } | null = null;
    let bestScore = -Infinity;
    for (let j = 0; j < pos.length; j++) {
      const rSum = cov(list[j]!) + cov(el);
      for (const [dx, dy, dz] of DIRS) {
        const cand = { x: pos[j]!.x + dx * rSum * 1.08, y: pos[j]!.y + dy * rSum * 1.08, z: pos[j]!.z + dz * rSum * 1.08 };
        let minGap = Infinity;
        for (let q = 0; q < pos.length; q++) {
          const gap =
            Math.hypot(cand.x - pos[q]!.x, cand.y - pos[q]!.y, cand.z - pos[q]!.z) -
            (cov(list[q]!) + cov(el)) * 1.05;
          if (gap < minGap) minGap = gap;
        }
        const score =
          -Math.hypot(cand.x - cx, cand.y - cy, cand.z - cz) + // 紧凑主项
          (minGap < 0 ? minGap * 50 : 0) + // 穿透强惩罚
          Math.min(minGap, 0.2) * 0.05; // 微偏好留缝
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    pos.push(best ?? { x: 0, y: 0, z: 0 }); // 空候选兜底（不应发生）
  }

  const atoms: Atom[] = list.map((el, i) => ({ el, x: pos[i]!.x, y: pos[i]!.y, z: pos[i]!.z }));

  const bonds: Bond[] = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i]!;
      const b = atoms[j]!;
      if (a.el === 'H' && b.el === 'H') continue;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= (cov(a.el) + cov(b.el)) * BOND_TOL) {
        bonds.push([i, j]);
      }
    }
  }
  return { atoms, bonds };
}

/** 一步到位：输入串 → 团簇几何（computeGeometry / UI 预校验共用入口） */
export function formulaTo3D(input: string): { atoms: Atom[]; bonds: Bond[]; canonical: string } {
  const tokens = parseFormula(input);
  return { ...buildFormulaCluster(tokens), canonical: canonicalFormula(tokens) };
}
