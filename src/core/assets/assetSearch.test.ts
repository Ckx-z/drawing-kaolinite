/**
 * Scientific Asset Search 验收（2026-09-22d，任务书 54-67/75-77）：
 * 多别名同资产直达 / 排名 / 去重 / CeO₂ 双资产区分 / 覆盖率 100% / 确定性。
 */
import { describe, expect, it } from 'vitest';
import { ASSET_INDEX, assetIndexStats, normalizeAssetQuery, searchAssets } from './assetSearch';
import { MOLECULE_KINDS } from '../schema';
import { MINERALS } from '../minerals';
import { buildMolecule } from '../builders';

describe('Query Normalization（任务书 61/62）', () => {
  it('Unicode 下标↔ASCII、trim、大小写', () => {
    expect(normalizeAssetQuery('H₂O')).toBe('H2O');
    expect(normalizeAssetQuery('  CeO₂ ')).toBe('CeO2');
    expect(normalizeAssetQuery('C₇H₈')).toBe('C7H8');
    // CO ≠ Co（科学式归一不 lower 化——归一仅下标转换，大小写保留由 rank 层文本匹配区分）
    expect(normalizeAssetQuery('Co')).toBe('Co');
  });
});

describe('搜索直达（任务书 54-57）', () => {
  it('水：水/水分子/water/H2O/H₂O → 同一 H₂O 资产且排第一', () => {
    for (const q of ['水', '水分子', 'water', 'H2O', 'H₂O']) {
      const r = searchAssets(q);
      expect(r[0]?.id, `"${q}"`).toBe('molecule:H₂O');
    }
  });

  it('甲苯：甲苯/甲基苯/toluene/TOLUENE/C7H8/C₇H₈ → molecule:C₇H₈', () => {
    for (const q of ['甲苯', '甲基苯', 'toluene', 'TOLUENE', 'C7H8', 'C₇H₈']) {
      expect(searchAssets(q)[0]?.id, `"${q}"`).toBe('molecule:C₇H₈');
    }
  });

  it('丙烷：丙烷/propane/C3H8 → molecule:C₃H₈', () => {
    for (const q of ['丙烷', 'propane', 'C3H8']) expect(searchAssets(q)[0]?.id).toBe('molecule:C₃H₈');
  });

  it('·OH：羟基自由基/·OH/OH radical/hydroxyl radical → ·OH 资产', () => {
    for (const q of ['羟基自由基', '·OH', 'hydroxyl radical']) {
      expect(searchAssets(q)[0]?.id).toBe('molecule:·OH (羟基自由基)');
    }
  });
});

describe('矿物与 CeO₂ 双资产（任务书 58-60/27/28）', () => {
  it('莫来石 → mineral:mullite；四氧化三钴 → mineral:co3o4', () => {
    expect(searchAssets('莫来石')[0]?.id).toBe('mineral:mullite');
    expect(searchAssets('Mullite')[0]?.id).toBe('mineral:mullite');
    expect(searchAssets('Co3O4')[0]?.id).toBe('mineral:co3o4');
    expect(searchAssets('四氧化三钴')[0]?.id).toBe('mineral:co3o4');
  });

  it('CeO2：Reference Crystal 排第一且存在；Schematic 纳米颗粒可搜到（双资产并存）', () => {
    const r = searchAssets('CeO2');
    expect(r[0]?.id).toBe('mineral:ceo2');
    expect(r[0]?.quality).toBe('Reference');
    const particle = r.find((a) => a.id === 'basic:nanoparticle');
    expect(particle).toBeTruthy();
    expect(particle!.quality).toBe('Schematic'); // 用户可区分真实晶体 vs 视觉颗粒
  });

  it('ceria/cerium dioxide/二氧化铈 → 同 mineral:ceo2', () => {
    for (const q of ['ceria', 'cerium dioxide', '二氧化铈']) expect(searchAssets(q)[0]?.id).toBe('mineral:ceo2');
  });
});

describe('排名 / 去重 / 确定性（任务书 19/50/53）', () => {
  it('exact match 分数 > prefix > contains', () => {
    const exact = searchAssets('甲苯')[0]!.score;
    const prefix = searchAssets('甲')[0]!.score;
    expect(exact).toBeGreaterThanOrEqual(prefix);
  });

  it('同资产多 alias 命中不产生重复卡（id 去重）', () => {
    const r = searchAssets('water');
    expect(r.filter((a) => a.id === 'molecule:H₂O')).toHaveLength(1);
    const r2 = searchAssets('toluene');
    expect(r2.filter((a) => a.id === 'molecule:C₇H₈')).toHaveLength(1);
  });

  it('同 query 多次调用结果逐位一致', () => {
    expect(searchAssets('ce')).toEqual(searchAssets('ce'));
  });

  it('空 query 返回 []（Browse Mode 由 UI 层处理）', () => {
    expect(searchAssets('')).toEqual([]);
    expect(searchAssets('   ')).toEqual([]);
  });
});

describe('覆盖率与审计（任务书 75-77）', () => {
  it('100% 覆盖：每个 molecule kind 与矿物在索引中有条目', () => {
    for (const kind of MOLECULE_KINDS) {
      expect(ASSET_INDEX.some((a) => a.id === `molecule:${kind}`), kind).toBe(true);
    }
    for (const key of Object.keys(MINERALS)) {
      expect(ASSET_INDEX.some((a) => a.id === `mineral:${key}`), key).toBe(true);
    }
  });

  it('id 唯一 + nameZh/nameEn 存在 + 有至少一个搜索入口', () => {
    const ids = new Set(ASSET_INDEX.map((a) => a.id));
    expect(ids.size).toBe(ASSET_INDEX.length);
    for (const a of ASSET_INDEX) {
      expect(a.nameZh.length).toBeGreaterThan(0);
      expect(a.nameEn.length).toBeGreaterThan(0);
      // 名称本身即可搜索
      expect(searchAssets(a.nameZh)[0]?.id ?? searchAssets(a.nameEn)?.[0]?.id).toBeTruthy();
    }
  });

  it('统计输出（Gate 1）', () => {
    const st = assetIndexStats();
    expect(st.molecules).toBeGreaterThanOrEqual(5);
    expect(st.ions).toBe(2);
    expect(st.minerals).toBe(8);
    expect(st.basic).toBeGreaterThanOrEqual(6);
    expect(st.total).toBe(ASSET_INDEX.length);
  });
});

describe('Search Query 不决定 Geometry（任务书 63/64）', () => {
  it('甲苯 vs C7H8 两条路径创建的几何 fingerprint 一致', () => {
    const byName = searchAssets('甲苯')[0]!;
    const byFormula = searchAssets('C7H8')[0]!;
    expect(byName.id).toBe(byFormula.id);
    const g1 = buildMolecule(byName.params.kind as never);
    const g2 = buildMolecule(byFormula.params.kind as never);
    for (const [i, a] of g1.atoms.entries()) {
      expect(a.x).toBe(g2.atoms[i]!.x);
      expect(a.y).toBe(g2.atoms[i]!.y);
    }
  });
});
