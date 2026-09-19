/**
 * 矿物注册表 —— 2026-09-12（中文矿物名搜索识别 + 多矿物 CIF 接线）
 *
 * data/ 下的 CIF 统一注册：中文名/别名、英文名、化学式、CIF 文本（?raw 打包
 * 内联）、层间平移默认值（= c 轴周期——双层晶胞矿物如地开石/珍珠石 c≈14.7、
 * 伊利石 c≈20.1，一个堆叠周期 = 完整晶胞平移，多型堆叠顺序在 c 周期内严格
 * 保留；高岭石 c=7.40 与原默认一致零回归）。
 *
 * 2026-09-17 新增莫来石（第六种）：骨架硅酸盐（Pbam 正交，非层状），
 * d001 语义 = 沿 c 的堆叠周期（= 晶胞 c≈2.89，schema 下限随之放宽到 2.5）；
 * layered=false 标记用于管组件排除（骨架结构不可卷管）。CIF 为 COD 2310785
 * 平均结构（分裂位 Al2/Si2 同坐标双组分保留、零占位 Si3 由解析层丢弃）。
 *
 * 几何生成严格走 parseCIF → expandSymmetry → buildSlab 既有管线（存参数
 * 不存网格 D02）；不硬编码任何原子坐标。计量基线由 minerals.test.ts 锁定：
 * 高岭石 26/Al4Si4O18、地开石 52/Al8Si8O36、珍珠石 68/Al8Si8O36H16、
 * 蒙脱石 38/Al4Si8O24Ca2（P1 已全展开；Ca0.5 占位按位点全显示）、
 * 伊利石 76/K4Al16Si8O48、莫来石 28/Al10Si4O14（渲染位点集；
 * 声明化学式 Al4.8Si1.2O9.6 见 formula 字段）。
 */
import dickiteCif from '../../data/Al2Si2O9H4-Dickite.cif?raw';
import illiteCif from '../../data/Al4KSi2O12-Illite.cif?raw';
import montmorilloniteCif from '../../data/Al2Si4O12Ca0.5-Montmorillonite.cif?raw';
import nacriteCif from '../../data/Al2Si2O9H4-Nacrite.cif?raw';
import kaoliniteCif from '../../data/kaolinite.cif?raw';
import mulliteCif from '../../data/mullite.cif?raw';
import co3o4Cif from '../../data/co3o4.cif?raw';
import ceo2Cif from '../../data/ceo2.cif?raw';

export type MineralKey =
  | 'kaolinite'
  | 'dickite'
  | 'nacrite'
  | 'montmorillonite'
  | 'illite'
  | 'mullite'
  | 'co3o4'
  | 'ceo2';

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
  /** 层间物种元素（T-2.4：showInterlayer=false 时隐藏；空 = 无层间物） */
  interlayer: readonly string[];
  /**
   * 是否层状矿物（默认 true）。false = 骨架/架状结构（莫来石/尖晶石/萤石）：
   * d001 语义为"沿 c 的堆叠周期"而非层间距，且不出现在管组件的矿物下拉
   * （骨架结构卷管无晶体学意义）。
   */
  layered?: boolean;
  /**
   * 额外搜索别名（整词匹配、小写化；2026-09-18 催化氧化物）：
   * 化学式（co3o4/ceo2——含数字串不做小写折叠，Co 与 C 大小写天然不混淆）
   * 与英文名变体（ceria/cobalt oxide 等）经此直达。
   */
  aliases?: readonly string[];
}

export const MINERALS: Record<MineralKey, MineralDef> = {
  kaolinite: {
    key: 'kaolinite',
    zh: ['高岭石'],
    en: 'Kaolinite',
    formula: 'Al2Si2O5(OH)4',
    cifText: kaoliniteCif,
    d001Default: 7.4,
    interlayer: [],
  },
  dickite: {
    key: 'dickite',
    zh: ['地开石'],
    en: 'Dickite',
    formula: 'Al2Si2O5(OH)4',
    cifText: dickiteCif,
    d001Default: 14.74,
    interlayer: [],
  },
  nacrite: {
    key: 'nacrite',
    zh: ['珍珠石', '珍珠陶土'],
    en: 'Nacrite',
    formula: 'Al2Si2O5(OH)4',
    cifText: nacriteCif,
    d001Default: 14.59,
    interlayer: [],
  },
  montmorillonite: {
    key: 'montmorillonite',
    zh: ['蒙脱石'],
    en: 'Montmorillonite',
    formula: 'Ca0.5Al2Si4O12',
    cifText: montmorilloniteCif,
    d001Default: 15.0,
    interlayer: ['Ca', 'Na'],
  },
  illite: {
    key: 'illite',
    zh: ['伊利石'],
    en: 'Illite',
    formula: 'KAl4Si2O12',
    cifText: illiteCif,
    d001Default: 20.14,
    interlayer: ['K'],
  },
  mullite: {
    key: 'mullite',
    zh: ['莫来石'],
    en: 'Mullite',
    // COD 2310785 声明化学式（3:2 区固溶体实际计量）；渲染位点集为
    // Al10Si4O14（分裂位双组分 + 部分占位全显示，见 crystal.ts/DECISIONS）
    formula: 'Al4.8Si1.2O9.6',
    cifText: mulliteCif,
    d001Default: 2.89,
    interlayer: [],
    layered: false,
  },
  // 2026-09-18 催化氧化物（任务书：真实 CIF 直驱，与 CeO₂ 风格化簇装颗粒并存）
  co3o4: {
    key: 'co3o4',
    zh: ['四氧化三钴'],
    en: 'Cobalt(II,III) oxide',
    // COD 9005888（Liu & Prewitt，尖晶石 Fd-3m，a=8.0968）；展开 Co24O32（56/晶胞）
    formula: 'Co3O4',
    cifText: co3o4Cif,
    d001Default: 8.0968, // 立方：沿 c 堆叠周期 = a（非层状，layered=false）
    interlayer: [],
    layered: false,
    aliases: ['co3o4', 'co₃o₄', 'cobalt oxide', 'tricobalt tetroxide', 'cobalt spinel'],
  },
  ceo2: {
    key: 'ceo2',
    zh: ['二氧化铈'],
    en: 'Cerium dioxide',
    // COD 9009008（萤石 Fm-3m，a=5.4110）；展开 Ce4O8（12/晶胞）
    formula: 'CeO2',
    cifText: ceo2Cif,
    d001Default: 5.411,
    interlayer: [],
    layered: false,
    aliases: ['ceo2', 'ceo₂', 'ceria', 'cerium oxide', 'cerianite'],
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
 * - 额外别名（2026-09-18 催化氧化物）：整词匹配（小写化），覆盖化学式
 *   （co3o4/ceo2——含数字串与 Co2 防混淆规则天然兼容）与英文名变体
 */
export function findMineral(input: string): MineralDef | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const hasZh = /[\u4e00-\u9fff]/.test(q);
  for (const def of Object.values(MINERALS)) {
    if (hasZh) {
      if (def.zh.some((z) => z.includes(q))) return def;
    } else {
      if (def.en.toLowerCase() === q || (q.length >= 4 && def.en.toLowerCase().startsWith(q))) {
        return def;
      }
      if (def.aliases?.some((a) => a.toLowerCase() === q)) return def;
    }
  }
  return null;
}
