/**
 * 参数面板定义 + 素材库条目 —— 自 demo/index.html PARAM_DEFS/LIB 移植（T-1.6）
 * 范围与 DATA_DICT / schema 一致；paramDefs.test.ts 守护"默认值落在定义范围内"。
 */
import type { ComponentType } from '../core/types';

export interface ParamDef {
  key: string;
  label: string;
  /** select 下拉 / checkbox 布尔勾选 / toggle 字符串枚举开关（on/off 映射）/ packedMask 密排层掩码网格 */
  type?: 'select' | 'checkbox' | 'toggle' | 'packedMask';
  /** toggle 型的 on/off 值（字符串枚举 ↔ 勾选态映射） */
  on?: string;
  off?: string;
  options?: readonly string[];
  /** 数值边界：常量或随其他参数动态（如"单原子层数"上限 = 当前堆叠层数） */
  min?: number | ((params: Record<string, unknown>) => number);
  max?: number | ((params: Record<string, unknown>) => number);
  step?: number;
  unit?: string;
  /** 滑块值的显示格式（如卷曲进度显示百分比） */
  disp?: (v: number) => string;
  /** 条件显隐（2026-09-08）：依赖其他参数时才渲染（如单原子模式的元素选择） */
  when?: (params: Record<string, unknown>) => boolean;
}

/** 单原子可选元素（单原子模式与密排原子层共用） */
const SINGLE_EL_OPTIONS = ['Si', 'Al', 'O', 'Fe', 'Ce', 'Ti', 'C'] as const;

/** 单原子模式基础字段（片层/管/颗粒共用；元素选择仅在开启时显示） */
const ATOM_MODE_BASE: ParamDef[] = [
  { key: 'atomMode', label: '单原子模式（单一原子堆叠示意）', type: 'toggle', on: 'single', off: 'full' },
  {
    key: 'singleEl',
    label: '单原子元素',
    type: 'select',
    options: SINGLE_EL_OPTIONS,
    when: (p) => p.atomMode === 'single',
  },
];

/**
 * 单原子层数字段（2026-09-10）：single 模式下显示前 N 层单原子层。
 * 滑块上限动态 = 当前堆叠/壁层数（layersKey 指定读哪个参数）；
 * 颗粒无层结构，不追加本字段。
 */
const singleLayersField = (layersKey: 'layers' | 'walls'): ParamDef => ({
  key: 'singleLayers',
  label: '单原子层数',
  min: 1,
  max: (p) => Number(p[layersKey] ?? 3),
  step: 1,
  when: (p) => p.atomMode === 'single',
});

export const PARAM_DEFS: Record<ComponentType, ParamDef[]> = {
  kaolinite_sheet: [
    { key: 'Lx', label: '横向尺寸', unit: 'Å', min: 20, max: 150, step: 2 },
    { key: 'Ly', label: '纵向尺寸', unit: 'Å', min: 20, max: 150, step: 2 },
    { key: 'layers', label: '堆叠层数', min: 1, max: 3, step: 1 },
    { key: 'd001', label: '层间距 d₀₀₁', unit: 'Å', min: 7.2, max: 12, step: 0.1 },
    { key: 'shape', label: '片层轮廓', type: 'select', options: ['矩形', '六角'] },
    { key: 'style', label: '渲染风格', type: 'select', options: ['空间填充', '球棍'] },
    { key: 'edgeH', label: '边缘羟基饱和（实验）', type: 'checkbox' },
    { key: 'strictCell', label: '晶学严格模式（保留 β/γ 夹角）', type: 'checkbox' },
    ...ATOM_MODE_BASE,
    singleLayersField('layers'),
  ],
  halloysite_tube: [
    { key: 'innerR', label: '内半径', unit: 'Å', min: 8, max: 40, step: 1 },
    { key: 'length', label: '管长', unit: 'Å', min: 30, max: 200, step: 5 },
    { key: 'walls', label: '管壁层数', min: 1, max: 3, step: 1 },
    { key: 'd001', label: '壁间距（水合）', unit: 'Å', min: 7.4, max: 11, step: 0.1 },
    { key: 'progress', label: '★ 卷曲进度（片→管）', min: 0.02, max: 1, step: 0.01, disp: (v) => `${Math.round(v * 100)}%` },
    { key: 'taperDeg', label: '锥角', unit: '°', min: -20, max: 20, step: 1 },
    { key: 'curlAxis', label: '卷曲方向', type: 'select', options: ['a', 'b'] },
    { key: 'portNoise', label: '端口噪声', unit: 'Å', min: 0, max: 2, step: 0.1 },
    { key: 'style', label: '渲染风格', type: 'select', options: ['空间填充', '球棍'] },
    ...ATOM_MODE_BASE,
    singleLayersField('walls'),
  ],
  nanoparticle: [
    { key: 'radius', label: '颗粒半径', unit: 'Å', min: 4, max: 20, step: 0.5 },
    { key: 'grains', label: '晶粒数量', min: 40, max: 400, step: 10 },
    { key: 'seed', label: '随机种子', min: 1, max: 99, step: 1 },
    { key: 'mode', label: '形态', type: 'select', options: ['簇装', '光滑'] },
    ...ATOM_MODE_BASE,
  ],
  molecule: [
    {
      key: 'kind',
      label: '分子种类',
      type: 'select',
      options: ['H₂O', 'O₂', 'CO₂', 'N₂', 'Ca²⁺', 'Ce³⁺', '·OH (羟基自由基)'],
      // SMILES/化学式导入的分子几何由导入串决定，隐藏内置种类选择避免误导
      when: (p) => !p.smiles && !p.formula,
    },
  ],
  rubber_substrate: [
    { key: 'Lx', label: '长', unit: 'Å', min: 40, max: 240, step: 10 },
    { key: 'Ly', label: '宽', unit: 'Å', min: 30, max: 200, step: 10 },
    { key: 'thickness', label: '厚度', unit: 'Å', min: 2, max: 20, step: 1 },
  ],
  packed_layers: [
    { key: 'el', label: '原子元素', type: 'select', options: SINGLE_EL_OPTIONS },
    { key: 'n', label: '每边原子数', min: 2, max: 12, step: 1 },
    { key: 'layers', label: '堆叠层数', min: 1, max: 8, step: 1 },
    { key: 'dist', label: '原子间距', unit: 'Å', min: 2, max: 8, step: 0.2 },
    { key: 'stacking', label: '堆叠方式', type: 'select', options: ['AB', 'ABC'] },
    {
      key: 'mask',
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
}

export const LIB: LibraryItem[] = [
  { type: 'kaolinite_sheet', icon: '▬', name: '高岭土片层', desc: '1–3 层堆叠 · CIF 驱动 · 矩形/六角' },
  { type: 'halloysite_tube', icon: '◯', name: '埃洛石纳米管', desc: '片层卷曲生成 · 卷曲进度可动画' },
  { type: 'nanoparticle', icon: '⬤', name: '纳米颗粒 CeO₂', desc: '簇装小晶粒 / 光滑球 · 尺寸可调' },
  { type: 'molecule', icon: '✦', name: '小分子 / 离子', desc: 'H₂O · O₂ · CO₂ · N₂ · 阳离子' },
  { type: 'rubber_substrate', icon: '▭', name: '橡胶基底', desc: '圆角软质平板' },
  { type: 'packed_layers', icon: '⬢', name: '密排原子层', desc: '六方/立方密排 · 逐原子堆叠开关 · 层数可调' },
];
