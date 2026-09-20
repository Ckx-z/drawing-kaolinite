/**
 * Canonical Asset Registry —— Scientific Geometry Foundation（PHASE A，2026-09-20）
 *
 * 统一科学资产注册：不同搜索词（二氧化铈/CeO2/ceo₂/ceria）解析到同一
 * canonical 实体（material:ceo2），并携带几何来源与可信等级 metadata。
 *
 * 设计原则（D-2026-09-20）：
 *  - **聚合不替换**：矿物几何仍唯一来自 MINERALS（CIF），分子几何唯一来自
 *    builders.MOLECULES；本 registry 只做身份解析 + provenance 元数据，
 *    绝不复制坐标或第二套别名归一（底层复用 findMineral / resolveMoleculeQuery）。
 *  - runtime metadata：geometrySource/quality 不升级 scene schema（旧场景零影响）。
 *  - provenance 数据与 DATA_DICT.md §一b 同源维护（来源改变时两处同步）。
 */
import { MINERALS, findMineral, type MineralKey } from '../minerals';
import { MOLECULE_KINDS } from '../schema';
import { resolveMoleculeQuery } from '../molecules/registry';

/* ---------- 科学元数据模型（任务书七/八/九） ---------- */

export type GeometrySource = 'reference' | 'imported' | 'generated' | 'schematic' | 'optimized' | 'external';
export type GeometryQuality = 'reference' | 'generated' | 'relaxed' | 'dft-optimized' | 'schematic';

export interface GeometryProvenance {
  sourceDatabase?: string;
  sourceId?: string;
  citation?: string;
  /** 构象/精修方法（MMFF94 / X-ray refinement …） */
  method?: string;
  geometryVersion?: number;
}

export type CanonicalAssetType = 'mineral' | 'molecule';

export interface CanonicalAsset {
  /** 稳定规范 id：mineral:kaolinite / molecule:toluene */
  id: string;
  type: CanonicalAssetType;
  nameZh: string;
  nameEn: string;
  aliases: string[];
  tags: string[];
  geometrySource: GeometrySource;
  geometryQuality: GeometryQuality;
  provenance?: GeometryProvenance;
  /** 解析锚点（几何唯一来源，本 registry 不复制几何） */
  mineralKey?: MineralKey;
  moleculeKind?: (typeof MOLECULE_KINDS)[number];
}

/* ---------- 矿物 provenance（与 DATA_DICT §一b 同源） ---------- */

const MINERAL_PROVENANCE: Partial<Record<MineralKey, GeometryProvenance>> = {
  kaolinite: { sourceDatabase: 'AMCSD', sourceId: '0012232' },
  dickite: { sourceDatabase: 'AMCSD', sourceId: '0000126' },
  nacrite: { sourceDatabase: 'AMCSD', sourceId: '0012394' },
  montmorillonite: { sourceDatabase: 'COD', sourceId: '9002779', citation: 'Viani 2002' },
  illite: { sourceDatabase: 'internal', sourceId: 'unrecorded', geometryVersion: 1 }, // 来源未记录（DATA_DICT 同）——已知限制
  mullite: {
    sourceDatabase: 'COD',
    sourceId: '2310785',
    citation: 'Birkenstock et al., Acta Cryst. B71 (2015) 358',
    method: 'modulated average structure refinement',
  },
  co3o4: { sourceDatabase: 'COD', sourceId: '9005888', citation: 'Liu & Prewitt, PCM 17:168', method: 'X-ray refinement' },
  ceo2: { sourceDatabase: 'COD', sourceId: '9009008', method: 'X-ray refinement' },
};

/* ---------- 分子 provenance ---------- */

const MOLECULE_META: Partial<
  Record<(typeof MOLECULE_KINDS)[number], { aliases: string[]; source: GeometrySource; quality: GeometryQuality; prov?: GeometryProvenance }>
> = {
  'H₂O': { aliases: ['水', '水分子', 'water'], source: 'reference', quality: 'reference', prov: { method: '文献实验几何（O–H 0.959Å / 104.5°）' } },
  'O₂': { aliases: ['氧气', 'oxygen'], source: 'reference', quality: 'reference' },
  'CO₂': { aliases: ['二氧化碳', 'carbon dioxide'], source: 'reference', quality: 'reference' },
  'N₂': { aliases: ['氮气', 'nitrogen'], source: 'reference', quality: 'reference' },
  '·OH (羟基自由基)': { aliases: ['羟基自由基', 'hydroxyl radical'], source: 'reference', quality: 'reference' },
  'Ca²⁺': { aliases: ['钙离子', 'calcium ion'], source: 'schematic', quality: 'schematic' },
  'Ce³⁺': { aliases: ['铈离子', 'cerium ion'], source: 'schematic', quality: 'schematic' },
  'C₇H₈': {
    aliases: ['甲苯', '甲基苯', 'toluene', 'methylbenzene', 'tol', 'C7H8', 'c7h8'],
    source: 'reference',
    quality: 'reference',
    prov: { sourceDatabase: 'PubChem', sourceId: 'CID 1140', method: '3D conformer (MMFF94)' },
  },
  'C₃H₈': {
    aliases: ['丙烷', 'propane', 'C3H8', 'c3h8'],
    source: 'reference',
    quality: 'reference',
    prov: { sourceDatabase: 'PubChem', sourceId: 'CID 6334', method: '3D conformer (MMFF94)' },
  },
};

const MOLECULE_EN: Partial<Record<(typeof MOLECULE_KINDS)[number], string>> = {
  'H₂O': 'Water', 'O₂': 'Oxygen', 'CO₂': 'Carbon dioxide', 'N₂': 'Nitrogen',
  'Ca²⁺': 'Calcium cation', 'Ce³⁺': 'Cerium cation', '·OH (羟基自由基)': 'Hydroxyl radical',
  'C₇H₈': 'Toluene', 'C₃H₈': 'Propane',
};

/* ---------- 注册表构建（数据驱动派生，零手工重复） ---------- */

function buildRegistry(): CanonicalAsset[] {
  const assets: CanonicalAsset[] = [];
  for (const def of Object.values(MINERALS)) {
    assets.push({
      id: `mineral:${def.key}`,
      type: 'mineral',
      nameZh: def.zh[0]!,
      nameEn: def.en,
      aliases: [...def.zh.slice(1), ...(def.aliases ?? [])],
      tags: ['mineral', def.formula, ...(def.layered === false ? ['non-layered'] : ['layered'])],
      geometrySource: 'reference',
      geometryQuality: 'reference',
      provenance: MINERAL_PROVENANCE[def.key],
      mineralKey: def.key,
    });
  }
  for (const kind of MOLECULE_KINDS) {
    const meta = MOLECULE_META[kind]!;
    assets.push({
      id: `molecule:${kind}`,
      type: 'molecule',
      nameZh: meta.aliases[0] ?? kind,
      nameEn: MOLECULE_EN[kind] ?? kind,
      aliases: meta.aliases.slice(1),
      tags: ['molecule', kind],
      geometrySource: meta.source,
      geometryQuality: meta.quality,
      provenance: meta.prov,
      moleculeKind: kind,
    });
  }
  return assets;
}

export const CANONICAL_ASSETS: CanonicalAsset[] = buildRegistry();

export function assetById(id: string): CanonicalAsset | undefined {
  return CANONICAL_ASSETS.find((a) => a.id === id);
}

/**
 * 统一身份解析（canonical 单入口）：任意搜索词 → CanonicalAsset。
 * 底层复用 findMineral（中/英/前缀/化学式别名）与 resolveMoleculeQuery
 * （分子 canonical 别名），本函数只做映射，不实现第二套归一。
 */
export function resolveAsset(query: string): CanonicalAsset | null {
  const mineral = findMineral(query);
  if (mineral) return assetById(`mineral:${mineral.key}`) ?? null;
  const kind = resolveMoleculeQuery(query);
  if (kind) return assetById(`molecule:${kind}`) ?? null;
  return null;
}
