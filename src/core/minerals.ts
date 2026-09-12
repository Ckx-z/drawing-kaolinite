/**
 * 矿物注册表 —— 2026-09-12（中文矿物名搜索识别 + 多矿物 CIF 接线）
 *
 * data/ 下的五种层状硅酸盐 CIF 统一注册：中文名/别名、英文名、化学式、
 * CIF 文本（?raw 打包内联）、层间平移默认值（= c 轴周期——双层晶胞矿物
 * 如地开石/珍珠石 c≈14.7、伊利石 c≈20.1，一个堆叠周期 = 完整晶胞平移，
 * 多型堆叠顺序在 c 周期内严格保留；高岭石 c=7.40 与原默认一致零回归）。
 *
 * 几何生成严格走 parseCIF → expandSymmetry → buildSlab 既有管线（存参数
 * 不存网格 D02）；不硬编码任何原子坐标。计量基线由 minerals.test.ts 锁定：
 * 高岭石 26/Al4Si4O18、地开石 52/Al8Si8O36、珍珠石 68/Al8Si8O36H16、
 * 蒙脱石 38/Al4Si8O24Ca2（P1 已全展开；Ca0.5 占位按位点全显示）、
 * 伊利石 76/K4Al16Si8O48。
 */
import dickiteCif from '../../data/Al2Si2O9H4-Dickite.cif?raw';
import illiteCif from '../../data/Al4KSi2O12-Illite.cif?raw';
import montmorilloniteCif from '../../data/Al2Si4O12Ca0.5-Montmorillonite.cif?raw';
import nacriteCif from '../../data/Al2Si2O9H4-Nacrite.cif?raw';
import kaoliniteCif from '../../data/kaolinite.cif?raw';

export type MineralKey = 'kaolinite' | 'dickite' | 'nacrite' | 'montmorillonite' | 'illite';

export interface MineralDef {
  key: MineralKey;
  /** 中文别名（搜索识别 + 显示） */
  zh: string[];
  /** 英文名（匹配不区分大小写） */
  en: string;
  /** 化学式（显示/搜索） */
  formula: string;
  /** CIF 文本（几何唯一来源） */
  cifText: string;
  /** 堆叠平移默认值 = c 轴周期（Å） */
  d001Default: number;
}

export const MINERALS: Record<MineralKey, MineralDef> = {
  kaolinite: {
    key: 'kaolinite',
    zh: ['高岭石'],
    en: 'Kaolinite',
    formula: 'Al2Si2O5(OH)4',
    cifText: kaoliniteCif,
    d001Default: 7.4,
  },
  dickite: {
    key: 'dickite',
    zh: ['地开石'],
    en: 'Dickite',
    formula: 'Al2Si2O5(OH)4',
    cifText: dickiteCif,
    d001Default: 14.74,
  },
  nacrite: {
    key: 'nacrite',
    zh: ['珍珠石', '珍珠陶土'],
    en: 'Nacrite',
    formula: 'Al2Si2O5(OH)4',
    cifText: nacriteCif,
    d001Default: 14.59,
  },
  montmorillonite: {
    key: 'montmorillonite',
    zh: ['蒙脱石'],
    en: 'Montmorillonite',
    formula: 'Ca0.5Al2Si4O12',
    cifText: montmorilloniteCif,
    d001Default: 15.0,
  },
  illite: {
    key: 'illite',
    zh: ['伊利石'],
    en: 'Illite',
    formula: 'KAl4Si2O12',
    cifText: illiteCif,
    d001Default: 20.14,
  },
};

export const MINERAL_KEYS = Object.keys(MINERALS) as MineralKey[];

/** 按键取定义；未知键回退高岭石（旧场景/异常参数兜底） */
export function mineralOf(key: string | undefined): MineralDef {
  return MINERALS[key as MineralKey] ?? MINERALS.kaolinite;
}

/**
 * 名称匹配（O(别名总数)）——导入框"搜索识别中文名"的入口：
 * - 含中文：别名包含匹配（"高岭石""珍珠陶土"）
 * - 纯 ASCII：仅整词相等，或 ≥4 字符的前缀匹配（Mont→Montmorillonite），
 *   避免 "C"/"CO"/"Si" 等化学式输入被英文包含匹配误吞
 */
export function findMineral(input: string): MineralDef | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const hasZh = /[\u4e00-\u9fff]/.test(q);
  for (const def of Object.values(MINERALS)) {
    if (hasZh) {
      if (def.zh.some((z) => z.includes(q))) return def;
    } else if (def.en.toLowerCase() === q || (q.length >= 4 && def.en.toLowerCase().startsWith(q))) {
      return def;
    }
  }
  return null;
}
