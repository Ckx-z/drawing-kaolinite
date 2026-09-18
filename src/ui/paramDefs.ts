/**
 * 参数面板定义 + 素材库条目 —— 自 demo/index.html PARAM_DEFS/LIB 移植（T-1.6）
 * 范围与 DATA_DICT / schema 一致；paramDefs.test.ts 守护"默认值落在定义范围内"。
 */
import { ELEMENTS } from '../core/elements';
import { MINERAL_KEYS, MINERALS, type MineralKey } from '../core/minerals';
import type { ComponentType } from '../core/types';

export interface ParamDef {
  key: string;
  label: string;
  /** select 下拉 / checkbox 布尔勾选 / toggle 字符串枚举开关（on/off 映射）/ packedMask 密排层掩码网格 */
  type?: 'select' | 'checkbox' | 'toggle' | 'packedMask';
  /** toggle 型的 on/off 值（字符串枚举 ↔ 勾选态映射） */
  on?: string;
  off?: string;
  /** 下拉选项：纯值，或 { value, label } 分离（如元素显示 "Si 硅" 存 "Si"） */
  options?: readonly (string | { value: string; label: string })[];
  /** 数值边界：常量或随其他参数动态（如"单原子层数"上限 = 当前堆叠层数） */
  min?: number | ((params: Record<string, unknown>) => number);
  max?: number | ((params: Record<string, unknown>) => number);
  step?: number;
  unit?: string;
  /** 滑块值的显示格式（如卷曲进度显示百分比） */
  disp?: (v: number) => string;
  /** 条件显隐（2026-09-08）：依赖其他参数时才渲染（如单原子模式的元素选择） */
  when?: (params: Record<string, unknown>) => boolean;
  /** 长列表下拉（如 118 项元素）显示过滤输入框：按符号或中文名包含匹配（2026-09-12） */
  searchable?: boolean;
  /**
   * 选中值联动改写其他参数（2026-09-12）：返回的键值与本次选中值合并提交
   * updateParams（同一命令，可整体撤销）。如切矿物时重置 d001 为该矿物 c 轴周期。
   */
  sideEffect?: (value: string | number, params: Record<string, unknown>) => Record<string, unknown>;
  /**
   * 滑块区间退化（动态 max ≤ min，如堆叠层数=1 时"单原子层数"上限=1）时的
   * 禁用说明（2026-09-13：min=max 的原生 range 拖不动且无禁用视觉，用户
   * 看到"能点但无反应"）。未提供时显示通用文案。
   */
  stuckHint?: (params: Record<string, unknown>) => string;
  /** 参数分组（缺省 = 基础）；分组渲染见 groupParams */
  group?: ParamGroupName;
}

/** 参数分组名（2026-09-16 渐进式展示）：分组顺序见 GROUP_ORDER */
export type ParamGroupName = '基础' | '晶体结构' | '形貌' | '显示' | '高级';

/** 分组展示顺序（渐进式：基础默认展开，其后按需） */
export const GROUP_ORDER: readonly ParamGroupName[] = ['基础', '晶体结构', '形貌', '显示', '高级'];

/**
 * 按分组聚合参数定义（渐进式展示，2026-09-16）：无 group 字段归"基础"；
 * 返回按 GROUP_ORDER 排序的 { name, defs }，仅含有字段的组。
 */
export function groupParams(defs: readonly ParamDef[]): Array<{ name: ParamGroupName; defs: ParamDef[] }> {
  const buckets = new Map<ParamGroupName, ParamDef[]>();
  for (const d of defs) {
    const g = d.group ?? '基础';
    const b = buckets.get(g);
    if (b) b.push(d);
    else buckets.set(g, [d]);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({ name: g, defs: buckets.get(g)! }));
}

/** 矿物下拉选项（显示"中文名 英文名"；2026-09-17 +莫来石 = 六矿物） */
const MINERAL_OPTIONS = MINERAL_KEYS.map((k) => ({ value: k, label: `${MINERALS[k].zh[0]} ${MINERALS[k].en}` }));

/** 管组件用：仅层状矿物（莫来石 layered=false 骨架结构不可卷管，2026-09-17） */
const LAYERED_MINERAL_OPTIONS = MINERAL_KEYS.filter((k) => MINERALS[k].layered !== false).map((k) => ({
  value: k,
  label: `${MINERALS[k].zh[0]} ${MINERALS[k].en}`,
}));

/**
 * 矿物字段：切换时联动重置 d001 为该矿物 c 轴周期（堆叠平移语义）。
 * layeredOnly=true 时仅列层状矿物（管组件卷曲需层状结构）。
 */
const mineralField = (layeredOnly = false): ParamDef => ({
  key: 'mineral',
  group: '晶体结构',
  label: '矿物（CIF 结构来源）',
  type: 'select',
  options: layeredOnly ? LAYERED_MINERAL_OPTIONS : MINERAL_OPTIONS,
  searchable: true,
  sideEffect: (v) => ({ d001: MINERALS[v as keyof typeof MINERALS]?.d001Default ?? 7.4 }),
});

/**
 * 单原子可选元素（单原子模式与密排原子层共用）。
 * 2026-09-12：从元素库派生全周期表 118 项（显示 "符号 中文名"，常用元素因
 * 表序在前仍排在下拉上部）；此前固定 7 项，其余元素无法选择。
 */
const SINGLE_EL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Object.entries(
  ELEMENTS,
).map(([sym, info]) => ({ value: sym, label: `${sym} ${info.name}` }));

/** 单原子模式基础字段（片层/管/颗粒共用；元素选择仅在开启时显示） */
const ATOM_MODE_BASE: ParamDef[] = [
  { key: 'atomMode', group: '显示', label: '单原子模式（单一原子堆叠示意）', type: 'toggle', on: 'single', off: 'full' },
  {
    key: 'singleEl',
    group: '显示',
    label: '单原子元素',
    type: 'select',
    options: SINGLE_EL_OPTIONS,
    searchable: true,
    when: (p) => p.atomMode === 'single',
  },
];

/**
 * 单原子层数字段（2026-09-10）：single 模式下显示前 N 层单原子层。
 * 2026-09-13 交互修复：上限放宽为 schema 常量 3（滑块在任何堆叠层数下都可拖），
 * 拖动超过当前堆叠/壁层数时 sideEffect 自动抬升对应层数（同一命令可整体撤销）；
 * 颗粒无层结构，不追加本字段。
 */
const singleLayersField = (layersKey: 'layers' | 'walls'): ParamDef => ({
  key: 'singleLayers',
  group: '显示',
  label: '单原子层数',
  min: 1,
  max: 3,
  step: 1,
  when: (p) => p.atomMode === 'single',
  sideEffect: (value, p) =>
    typeof value === 'number' && value > Number(p[layersKey] ?? 3) ? { [layersKey]: value } : {},
});

/** 堆叠/壁层数字段：调低于当前单原子层数时联动下调（双向闭合，见 singleLayersField） */
const layersCountField = (layersKey: 'layers' | 'walls', label: string): ParamDef => ({
  key: layersKey,
  group: '基础',
  label,
  min: 1,
  max: 3,
  step: 1,
  sideEffect: (value, p) =>
    typeof value === 'number' && typeof p.singleLayers === 'number' && p.singleLayers > value
      ? { singleLayers: value }
      : {},
});

export const PARAM_DEFS: Record<ComponentType, ParamDef[]> = {
  kaolinite_sheet: [
    { key: 'Lx', group: '基础', label: '横向尺寸', unit: 'Å', min: 20, max: 150, step: 2 },
    { key: 'Ly', group: '基础', label: '纵向尺寸', unit: 'Å', min: 20, max: 150, step: 2 },
    layersCountField('layers', '堆叠层数'),
    // min 2.5（2026-09-17）：与 schema 同步放宽——莫来石 c≈2.89（d001 = 沿 c 堆叠周期）
    { key: 'd001', group: '晶体结构', label: '堆叠周期 d₀₀₁', unit: 'Å', min: 2.5, max: 25, step: 0.1 },
    mineralField(),
    { key: 'shape', group: '基础', label: '片层轮廓', type: 'select', options: ['矩形', '六角'] },
    { key: 'style', group: '基础', label: '渲染风格', type: 'select', options: ['空间填充', '球棍'] },
    { key: 'edgeH', group: '高级', label: '边缘羟基饱和（实验）', type: 'checkbox' },
    { key: 'strictCell', group: '高级', label: '晶学严格模式（保留 β/γ 夹角）', type: 'checkbox' },
    ...ATOM_MODE_BASE,
    singleLayersField('layers'),
    {
      key: 'showInterlayer',
      group: '显示',
      label: '显示层间物种（K⁺/Ca²⁺ 等）',
      type: 'checkbox',
      when: (p) => (MINERALS[(p.mineral as MineralKey) ?? 'kaolinite']?.interlayer.length ?? 0) > 0,
    },
  ],
  halloysite_tube: [
    { key: 'innerR', group: '基础', label: '内半径', unit: 'Å', min: 8, max: 40, step: 1 },
    { key: 'length', group: '基础', label: '管长', unit: 'Å', min: 30, max: 200, step: 5 },
    layersCountField('walls', '管壁层数'),
    { key: 'd001', group: '晶体结构', label: '壁间周期 d₀₀₁', unit: 'Å', min: 7.4, max: 25, step: 0.1 },
    mineralField(true), // 仅层状矿物：卷管需层状结构（莫来石骨架排除）
    { key: 'progress', group: '形貌', label: '★ 卷曲进度（片→管）', min: 0.02, max: 1, step: 0.01, disp: (v) => `${Math.round(v * 100)}%` },
    { key: 'taperDeg', group: '高级', label: '锥角', unit: '°', min: -20, max: 20, step: 1 },
    { key: 'curlAxis', group: '高级', label: '卷曲方向', type: 'select', options: ['a', 'b'] },
    { key: 'portNoise', group: '高级', label: '端口噪声', unit: 'Å', min: 0, max: 2, step: 0.1 },
    { key: 'style', group: '基础', label: '渲染风格', type: 'select', options: ['空间填充', '球棍'] },
    ...ATOM_MODE_BASE,
    singleLayersField('walls'),
  ],
  nanoparticle: [
    { key: 'radius', group: '基础', label: '颗粒半径', unit: 'Å', min: 4, max: 20, step: 0.5 },
    { key: 'grains', group: '高级', label: '晶粒数量', min: 40, max: 400, step: 10 },
    { key: 'seed', group: '高级', label: '随机种子', min: 1, max: 99, step: 1 },
    { key: 'mode', group: '基础', label: '形态', type: 'select', options: ['簇装', '光滑'] },
    ...ATOM_MODE_BASE,
  ],
  molecule: [
    {
      key: 'kind',
      label: '分子种类',
      type: 'select',
      options: ['H₂O', 'O₂', 'CO₂', 'N₂', 'Ca²⁺', 'Ce³⁺', '·OH (羟基自由基)', 'C₇H₈'],
      // 与 MOLECULE_KINDS 同步（第二处副本；SMILES/化学式导入的分子几何由导入串决定，隐藏下拉避免误导）
      when: (p) => !p.smiles && !p.formula,
    },
  ],
  rubber_substrate: [
    { key: 'Lx', group: '基础', label: '长', unit: 'Å', min: 40, max: 240, step: 10 },
    { key: 'Ly', group: '基础', label: '宽', unit: 'Å', min: 30, max: 200, step: 10 },
    { key: 'thickness', group: '基础', label: '厚度', unit: 'Å', min: 2, max: 20, step: 1 },
  ],
  packed_layers: [
    { key: 'el', group: '基础', label: '原子元素', type: 'select', options: SINGLE_EL_OPTIONS, searchable: true },
    { key: 'n', group: '基础', label: '每边原子数', min: 2, max: 12, step: 1 },
    { key: 'layers', label: '堆叠层数', min: 1, max: 8, step: 1 },
    { key: 'dist', group: '基础', label: '原子间距', unit: 'Å', min: 2, max: 8, step: 0.2 },
    { key: 'stacking', group: '基础', label: '堆叠方式', type: 'select', options: ['AB', 'ABC'] },
    {
      key: 'mask',
      group: '高级',
      label: '参与堆叠（第一层每个原子）',
      type: 'packedMask',
    },
  ],
};

export interface LibraryItem {
  type: ComponentType;
  icon: string;
  name: string;
  desc: string;
  /** 英文副标题（卡片两行式：名称 + 短副标题；完整 desc 移入 title） */
  en?: string;
}

/** 素材搜索（2026-09-16）：名称/副标题/说明的字符串包含匹配（不区分大小写） */
export function filterLib(items: readonly LibraryItem[], q: string): LibraryItem[] {
  // 下标归一（₂→2）：让 H2O 与 H₂O 互相命中（2026-09-18）
  const norm = (t: string): string => t.toLowerCase().replace(/[₀-₉]/g, (c) => SUBSCRIPT[c] ?? c);
  const n = norm(q.trim());
  if (!n) return [...items];
  return items.filter((it) => norm(`${it.name} ${it.en ?? ''} ${it.desc}`).includes(n));
}

/** Unicode 下标 → ASCII（filterLib 匹配归一；与 molecules/registry 同规则） */
const SUBSCRIPT: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

export const LIB: LibraryItem[] = [
  { type: 'kaolinite_sheet', icon: '▬', name: '高岭土片层', desc: '1–3 层堆叠 · CIF 驱动 · 六矿物（含莫来石）· 矩形/六角', en: 'Kaolinite Sheet' },
  { type: 'halloysite_tube', icon: '◯', name: '埃洛石纳米管', desc: '片层卷曲生成 · 卷曲进度可动画', en: 'Halloysite Nanotube' },
  { type: 'nanoparticle', icon: '⬤', name: '纳米颗粒 CeO₂', desc: '簇装小晶粒 / 光滑球 · 尺寸可调', en: 'Nanoparticle' },
  { type: 'molecule', icon: '✦', name: '小分子 / 离子', desc: '水分子 H₂O · 甲苯 C₇H₈ · 氧气 O₂ · 二氧化碳 CO₂ · 氮气 N₂ · 阳离子（可输 water/toluene/甲苯 搜索）', en: 'Molecule / Ion' },
  { type: 'rubber_substrate', icon: '▭', name: '橡胶基底', desc: '圆角软质平板', en: 'Rubber Substrate' },
  { type: 'packed_layers', icon: '⬢', name: '密排原子层', desc: '六方/立方密排 · 逐原子堆叠开关 · 层数可调', en: 'Close-Packed Layers' },
];
