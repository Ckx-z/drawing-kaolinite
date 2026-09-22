/**
 * Canonical 分子注册表（2026-09-18 修复"水分子搜索几何错误"）：
 * 单一事实源——别名 → canonical kind；几何本体仍唯一来自 builders.MOLECULES
 * （本文件不含任何坐标，杜绝同一分子多份几何）。
 *
 * 设计不变量：Search query only resolves asset identity —
 * 搜索词只负责找到 canonical 分子，绝不决定几何生成算法。
 *
 * 解析优先级（导入框 / 化学式链路）：
 *   矿物名（findMineral）→ canonical 别名（resolveMoleculeQuery）→
 *   resolveImportPath 分流：SMILES 构象器（不动）｜化学式 → 先查
 *   resolveCanonicalFormula（有权威 preset 则用，如 H2O）→ 未命中才团簇生成器。
 * MOL/SDF 文件坐标优先级最高（mp.mol 分支在最前，不受本注册表影响）。
 */
import { MOLECULE_KINDS } from '../schema';

export type MoleculeKind = (typeof MOLECULE_KINDS)[number];

/** Unicode 下标数字 → ASCII（仅用于别名/查询归一，不触碰化学式解析器大小写逻辑） */
const SUB: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

export function normalizeSubscript(s: string): string {
  return s.replace(/[₀-₉]/g, (ch) => SUB[ch] ?? ch);
}

/**
 * 别名表（查询键 = 下标归一后的原样形态；小写英文词另备）。
 * 歧义安全规则：含数字的大小写混合串（Co2 = 钴化学式）不做小写折叠，
 * 只有纯字母词（water/Water）才归小写——避免重演 CO₂↔Co2 历史混淆。
 */
const QUERY_ALIASES: Record<string, MoleculeKind> = {
  H2O: 'H₂O', h2o: 'H₂O', 水: 'H₂O', 水分子: 'H₂O', water: 'H₂O',
  O2: 'O₂', 氧气: 'O₂', N2: 'N₂', 氮气: 'N₂', CO2: 'CO₂', 二氧化碳: 'CO₂',
  // 甲苯（2026-09-17）：tol 为溶剂瓶常用缩写（纯字母 → 小写化后精确匹配，无误吞路径）
  甲苯: 'C₇H₈', 甲基苯: 'C₇H₈', toluene: 'C₇H₈', methylbenzene: 'C₇H₈', tol: 'C₇H₈',
  C7H8: 'C₇H₈', // 化学式直查（含数字串不做小写折叠；c7h8 小写形态走化学式升级分支）
  // 丙烷（2026-09-18）：几何 = 内置 SMILES 构象器（builders.MOLECULES 运行时生成）
  丙烷: 'C₃H₈', propane: 'C₃H₈', C3H8: 'C₃H₈',
  // 阳离子（2026-09-20 canonical registry）：kind 本身与中文名直达
  'Ca²⁺': 'Ca²⁺', 钙离子: 'Ca²⁺', 'Ce³⁺': 'Ce³⁺', 铈离子: 'Ce³⁺',
  // 羟基自由基（2026-09-22d：有几何但无 query alias 的覆盖率缺口）
  '·OH': '·OH (羟基自由基)', OH: '·OH (羟基自由基)', 'oh radical': '·OH (羟基自由基)', 'hydroxyl radical': '·OH (羟基自由基)', 羟基自由基: '·OH (羟基自由基)',
};

/** 查询归一：下标归一；纯字母词归小写；含数字混合大小写保持原样（Co2 ≠ CO₂） */
function queryKey(s: string): string {
  const t = normalizeSubscript(s.trim());
  if (QUERY_ALIASES[t]) return t;
  if (/^[A-Za-z]+$/.test(t)) return t.toLowerCase();
  return t;
}

/** 导入框/搜索解析：命中内置 canonical 分子返回其 kind（几何由 buildMolecule(kind) 唯一供给） */
export function resolveMoleculeQuery(s: string): MoleculeKind | null {
  return QUERY_ALIASES[queryKey(s)] ?? null;
}

/**
 * 化学式 → canonical 升级（worker 与主线程 fallback 共用，保证两路一致）：
 * 仅匹配无歧义的规范形态（H2O/H₂O/h2o、CO2/co2…；Co2 = 钴不在表）。
 * 未命中返回 null（调用方继续 formulaTo3D 团簇）。旧场景 formula:'H2O'
 * 经此自动升级为参考几何（几何修正，schema/params 不变）。
 */
const FORMULA_PRESETS: Record<string, MoleculeKind> = {
  H2O: 'H₂O', h2o: 'H₂O', CO2: 'CO₂', co2: 'CO₂', O2: 'O₂', o2: 'O₂', N2: 'N₂', n2: 'N₂',
  C7H8: 'C₇H₈', c7h8: 'C₇H₈', // 甲苯（含数字混合串不做小写折叠，normalizeSubscript('C₇H₈') → 'C7H8'）
  C3H8: 'C₃H₈', c3h8: 'C₃H₈', // 丙烷
};

export function resolveCanonicalFormula(f: string): MoleculeKind | null {
  return FORMULA_PRESETS[normalizeSubscript(f.trim())] ?? null;
}
