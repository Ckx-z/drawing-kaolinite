/**
 * Scientific Asset Search（2026-09-22d）：素材搜索从"分类过滤器"升级为
 * "科研结构资产检索器"——搜索"甲苯"直接得到甲苯资产卡，不是"小分子"大类。
 *
 * 数据派生（零复制——单一事实源）：
 *  - 分子/离子 ← CANONICAL_ASSETS（assets/registry.ts，聚合 MOLECULE_KINDS+别名+provenance）
 *  - 矿物/晶体 ← CANONICAL_ASSETS 矿物条目（源自 minerals.ts）
 *  - 基础参数化素材 ← paramDefs.LIB（组件类型级入口：管/颗粒/基底/密排层/片层/表面）
 * 搜索只解析身份，绝不决定几何（create 工厂按 canonical id 走既有 builder）。
 */
import { CANONICAL_ASSETS } from './registry';
import { MINERALS } from '../minerals';

const MINERAL_D001: Record<string, number> = Object.fromEntries(Object.values(MINERALS).map((m) => [m.key, m.d001Default]));
import { normalizeSubscript } from '../molecules/registry';
import { LIB } from '../../ui/paramDefs';
import type { ComponentType } from '../types';

export interface SearchableAsset {
  /** canonical id（mineral:ceo2 / molecule:C₇H₈ / basic:nanoparticle） */
  id: string;
  type: 'molecule' | 'mineral' | 'basic';
  /** 组件工厂参数（create() 使用；搜索层不暴露） */
  componentType: ComponentType;
  params: Record<string, unknown>;
  nameZh: string;
  nameEn: string;
  formula?: string;
  aliases: string[];
  tags: string[];
  description: string;
  quality: 'Reference' | 'Generated' | 'Schematic';
  /** 类型徽标（UI 显示） */
  typeBadge: string;
}

/** 基础素材（LIB 派生；CeO₂ 颗粒=Schematic 与晶体 Reference 区分） */
const BASIC_EXTRA: Partial<Record<ComponentType, { quality: SearchableAsset['quality']; extraAliases?: string[] }>> = {
  nanoparticle: { quality: 'Schematic', extraAliases: ['纳米颗粒', 'nanoparticle', 'ceria particle', 'ceo2 颗粒'] },
  crystal_surface: { quality: 'Generated', extraAliases: ['晶体表面', 'crystal surface', 'miller', '晶面', 'hkl'] },
  kaolinite_sheet: { quality: 'Reference', extraAliases: ['片层', 'sheet', 'clay sheet'] },
  halloysite_tube: { quality: 'Generated', extraAliases: ['纳米管', 'nanotube', 'tube', '管'] },
  rubber_substrate: { quality: 'Schematic', extraAliases: ['基底', 'substrate'] },
  packed_layers: { quality: 'Generated', extraAliases: ['密排', '原子层', 'close packed'] },
  molecule: { quality: 'Reference' },
};

function buildIndex(): SearchableAsset[] {
  const out: SearchableAsset[] = [];
  for (const a of CANONICAL_ASSETS) {
    if (a.type === 'molecule') {
      const isIon = /²⁺|³⁺/.test(a.id);
      out.push({
        id: a.id,
        type: 'molecule',
        componentType: 'molecule',
        params: { kind: a.moleculeKind },
        nameZh: a.nameZh,
        nameEn: a.nameEn,
        // 化学式从 kind 派生（₇→7 ASCII 形态；离子无公式式样保持 undefined）
        formula: /^·/.test(a.moleculeKind!) ? undefined : normalizeSubscript(a.moleculeKind!),
        aliases: [...a.aliases, a.moleculeKind!],
        tags: a.tags,
        description: `${a.nameEn}${a.provenance ? ` · ${a.provenance.sourceDatabase ?? ''}` : ''}`,
        quality: a.geometryQuality === 'reference' ? 'Reference' : 'Schematic',
        typeBadge: isIon ? '离子' : '分子',
      });
    } else {
      out.push({
        id: a.id,
        type: 'mineral',
        componentType: 'kaolinite_sheet',
        params: { mineral: a.mineralKey, d001: MINERAL_D001[a.mineralKey ?? ''] ?? 7.4 },
        nameZh: a.nameZh,
        nameEn: a.nameEn,
        aliases: a.aliases,
        tags: a.tags,
        description: `${a.nameEn} · ${a.tags[1] ?? ''}`,
        quality: 'Reference',
        typeBadge: '晶体',
      });
    }
  }
  for (const item of LIB) {
    const extra = BASIC_EXTRA[item.type];
    out.push({
      id: `basic:${item.type}`,
      type: 'basic',
      componentType: item.type,
      params: {},
      nameZh: item.name,
      nameEn: item.en ?? item.name,
      aliases: (extra?.extraAliases ?? []).concat(item.desc.split(/[·，]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 20)),
      tags: [item.type],
      description: item.desc,
      quality: extra?.quality ?? 'Generated',
      typeBadge: item.type === 'crystal_surface' ? '表面' : item.type === 'nanoparticle' ? '颗粒' : item.type === 'kaolinite_sheet' ? '片层' : item.type === 'halloysite_tube' ? '纳米管' : item.type === 'rubber_substrate' ? '基底' : '原子层',
    });
  }
  return out;
}

export const ASSET_INDEX: SearchableAsset[] = buildIndex();

/** 查询归一：去空白 + Unicode 下标→ASCII（复用 registry normalizeSubscript，零第二套） */
export function normalizeAssetQuery(q: string): string {
  return normalizeSubscript(q.trim().replace(/\s+/g, ' '));
}

const SCORE = { idExact: 100, zhExact: 95, enExact: 95, formulaExact: 95, aliasExact: 90, namePrefix: 80, aliasPrefix: 75, tagExact: 60, nameContains: 50, descContains: 40 } as const;

/** 单资产打分（0 = 不命中）——大小写不敏感文本匹配 + 化学式精确科学归一 */
function rankAsset(a: SearchableAsset, qNorm: string, qRaw: string): number {
  const ql = qRaw.toLowerCase();
  const zh = a.nameZh.toLowerCase();
  const en = a.nameEn.toLowerCase();
  const id = a.id.toLowerCase();
  if (id === ql) return SCORE.idExact;
  if (zh === ql || en === ql) return SCORE.zhExact;
  if (a.formula && normalizeSubscript(a.formula) === qNorm) return SCORE.formulaExact;
  if (a.aliases.some((x) => x.toLowerCase() === ql)) return SCORE.aliasExact;
  if (zh.startsWith(ql) || en.startsWith(ql)) return SCORE.namePrefix;
  if (a.aliases.some((x) => x.toLowerCase().startsWith(ql))) return SCORE.aliasPrefix;
  if (a.tags.some((x) => x.toLowerCase() === ql)) return SCORE.tagExact;
  if (zh.includes(ql) || en.includes(ql)) return SCORE.nameContains;
  if (a.description.toLowerCase().includes(ql)) return SCORE.descContains;
  // 化学式片段（H2O → H₂O formula 归一后精确）
  if (a.formula && qNorm.length >= 2 && normalizeSubscript(a.formula).includes(qNorm)) return SCORE.formulaExact - 5;
  return 0;
}

export interface SearchResult extends SearchableAsset {
  score: number;
}

/** 搜索（纯函数）：归一 → 全量打分 → 过滤 → 按 score 降序 + id 升序（确定性去重） */
export function searchAssets(query: string): SearchResult[] {
  const qRaw = query.trim();
  if (!qRaw) return [];
  const qNorm = normalizeAssetQuery(qRaw);
  const hits = ASSET_INDEX.map((a) => ({ ...a, score: rankAsset(a, qNorm, qRaw.toLowerCase()) }))
    .filter((a) => a.score > 0)
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  // canonical id 去重（同资产多 alias 命中只出一张卡）
  const seen = new Set<string>();
  return hits.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

/** 资产统计（Gate 1：按 canonical 计数，非 alias 数） */
/**
 * 统一资产工厂（2026-09-22e Direct Add 修复）：assetId → addComponent 参数。
 * 搜索与浏览模式共用（不在 UI 硬编码资产构造规则）；返回 null = 无此资产。
 */
export function createAssetComponent(assetId: string): { componentType: ComponentType; params: Record<string, unknown>; name?: string } | null {
  const a = ASSET_INDEX.find((x) => x.id === assetId);
  if (!a) return null;
  if (a.type === 'mineral') {
    return { componentType: 'kaolinite_sheet', params: { mineral: a.params.mineral, d001: a.params.d001 }, name: a.nameZh };
  }
  if (a.type === 'molecule') {
    return { componentType: 'molecule', params: { kind: a.params.kind }, name: a.nameZh };
  }
  return { componentType: a.componentType, params: {}, name: a.nameZh };
}

export function assetIndexStats(): { molecules: number; ions: number; minerals: number; basic: number; total: number } {
  const molecules = ASSET_INDEX.filter((a) => a.typeBadge === '分子').length;
  const ions = ASSET_INDEX.filter((a) => a.typeBadge === '离子').length;
  const minerals = ASSET_INDEX.filter((a) => a.type === 'mineral').length;
  const basic = ASSET_INDEX.filter((a) => a.type === 'basic').length;
  return { molecules, ions, minerals, basic, total: ASSET_INDEX.length };
}
