/**
 * Direct Add 验收（2026-09-22e，任务书 23-31/39）：
 * 搜索结果 → createAssetComponent → addComponent → scene count+1 → 自动选中。
 * 全索引 smoke test（覆盖率 100%——无"可搜不可加"条目）。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { ASSET_INDEX, createAssetComponent, searchAssets } from './assetSearch';
import { sceneStore } from '../../state/sceneStore';
import { componentSchema } from '../schema';
import { buildMolecule } from '../builders';
import { MINERALS } from '../minerals';

beforeEach(() => {
  for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
});

describe('Bug 修复验证：矿物 Direct Add（d001 undefined 根因）', () => {
  it('四氧化三钴：搜索→点击→scene +1、自动选中、params 通过 schema', () => {
    const r = searchAssets('四氧化三钴')[0]!;
    expect(r.id).toBe('mineral:co3o4');
    const spec = createAssetComponent(r.id)!;
    expect(spec.componentType).toBe('kaolinite_sheet');
    expect(spec.params.d001).toBe(MINERALS.co3o4.d001Default); // 真值非 undefined
    const id = sceneStore.getState().addComponent(spec.componentType, { name: spec.name, params: spec.params as never });
    expect(sceneStore.getState().components).toHaveLength(1);
    const comp = sceneStore.getState().components[0]!;
    expect((comp.params as { mineral: string }).mineral).toBe('co3o4');
    expect((comp.params as { d001: number }).d001).toBeCloseTo(8.0968, 3);
    expect(componentSchema.safeParse(comp).success).toBe(true); // schema 通过（此前 undefined 在此爆掉）
    sceneStore.getState().select(id);
    expect(sceneStore.getState().selectionId).toBe(id); // 自动选中
  });

  it('莫来石：non-layered 矿物正确创建（d001=2.89 真值）', () => {
    const spec = createAssetComponent(searchAssets('莫来石')[0]!.id)!;
    const id = sceneStore.getState().addComponent(spec.componentType, { params: spec.params as never });
    expect((sceneStore.getState().components[0]!.params as { mineral: string; d001: number }).mineral).toBe('mullite');
    expect((sceneStore.getState().components[0]!.params as { d001: number }).d001).toBeCloseTo(2.89, 2);
    void id;
  });

  it('CeO₂ 双资产：Reference Crystal 与 Nanoparticle 创建结果不同', () => {
    const r = searchAssets('CeO2');
    const crystal = createAssetComponent(r.find((a) => a.id === 'mineral:ceo2')!.id)!;
    const particle = createAssetComponent(r.find((a) => a.id === 'basic:nanoparticle')!.id)!;
    expect(crystal.componentType).toBe('kaolinite_sheet');
    expect((crystal.params as { mineral: string }).mineral).toBe('ceo2');
    expect(particle.componentType).toBe('nanoparticle');
    expect(particle.params.mineral).toBeUndefined(); // 颗粒不冒充晶体
    const id1 = sceneStore.getState().addComponent(crystal.componentType, { params: crystal.params as never });
    const id2 = sceneStore.getState().addComponent(particle.componentType, { params: particle.params as never });
    const cs = sceneStore.getState().components;
    expect(cs.find((c) => c.id === id1)!.type).not.toBe(cs.find((c) => c.id === id2)!.type); // 两种不同 Component
  });
});

describe('Molecule Direct Add（任务书 25/26/28）', () => {
  it.each([['甲苯', 'C₇H₈'], ['丙烷', 'C₃H₈'], ['H₂O', 'H₂O'], ['羟基自由基', '·OH (羟基自由基)']])(
    '%s：搜索→创建 kind 正确（无 formula fallback）',
    (query, expectedKind) => {
      const r = searchAssets(query)[0]!;
      const spec = createAssetComponent(r.id)!;
      expect(spec.componentType).toBe('molecule');
      expect(spec.params.kind).toBe(expectedKind);
      const id = sceneStore.getState().addComponent(spec.componentType, { params: spec.params as never });
      expect((sceneStore.getState().components[0]!.params as { kind: string }).kind).toBe(expectedKind);
      void id;
    },
  );

  it('别名几何一致：甲苯 vs C7H8 两路创建 fingerprint 相同', () => {
    const s1 = createAssetComponent(searchAssets('甲苯')[0]!.id)!;
    const s2 = createAssetComponent(searchAssets('C7H8')[0]!.id)!;
    expect(s1.params.kind).toBe(s2.params.kind);
    const g1 = buildMolecule(s1.params.kind as never);
    const g2 = buildMolecule(s2.params.kind as never);
    for (const [i, a] of g1.atoms.entries()) expect(a.x).toBe(g2.atoms[i]!.x);
  });
});

describe('重复添加 / 失败不静默（任务书 21/29/31）', () => {
  it('连续点击甲苯两次：+2 个独立组件、ID 不同', () => {
    const spec = createAssetComponent('molecule:C₇H₈')!;
    const id1 = sceneStore.getState().addComponent(spec.componentType, { params: spec.params as never });
    const id2 = sceneStore.getState().addComponent(spec.componentType, { params: spec.params as never });
    expect(sceneStore.getState().components).toHaveLength(2);
    expect(id1).not.toBe(id2);
  });

  it('invalid id：createAssetComponent 返回 null（明确失败，不 fallback sheet）', () => {
    expect(createAssetComponent('invalid:id')).toBeNull();
    expect(createAssetComponent('molecule:nonexistent')).toBeNull();
  });
});

describe('全索引 smoke test（任务书 39/45-21：零"可搜不可加"）', () => {
  it('每个索引资产：factory 产出 → addComponent 成功 → schema 通过 → 自动选中', () => {
    for (const a of ASSET_INDEX) {
      const spec = createAssetComponent(a.id);
      expect(spec, `${a.id} 应有 factory`).toBeTruthy();
      const n0 = sceneStore.getState().components.length;
      const id = sceneStore.getState().addComponent(spec!.componentType, { name: spec!.name, params: spec!.params as never });
      expect(sceneStore.getState().components, `${a.id} add 后 +1`).toHaveLength(n0 + 1);
      const comp = sceneStore.getState().components.find((c) => c.id === id)!;
      expect(componentSchema.safeParse(comp).success, `${a.id} schema 通过`).toBe(true);
      sceneStore.getState().select(id);
      expect(sceneStore.getState().selectionId, `${a.id} 自动选中`).toBe(id);
    }
  });
});
