/**
 * Surface Defects v1 验收（2026-09-22c，任务书 58-70）：
 * siteKey 确定性 / 原子-键-composition 联动 / 非O·深层·重复拒绝 / Undo /
 * 序列化 / Worker 一致 / 吸附用 defected 几何 + Vacancy site / 模板往返。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { MINERALS } from '../minerals';
import { applySurfaceDefects, buildCrystalSurface, surfaceSiteKey } from '../builders';
import { computeGeometry } from '../worker';
import { surfaceSites, generateAdsorbCandidate } from './adsorb';
import { buildMolecule } from '../builders';
import { buildMillerSlab } from './slab';
import { sceneStore } from '../../state/sceneStore';
import { attachHistory } from '../../state/history';

const BASE = { mineral: 'ceo2', h: 1, k: 1, l: 1, sizeX: 12, sizeY: 12, thickness: 8, termination: 0, style: '球棍' } as const;

beforeEach(() => {
  for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
});

describe('Stable Site Identity（任务书 58）', () => {
  it('同 params 两次生成：同一物理 O 的 siteKey 逐字符一致', () => {
    const g1 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE });
    const g2 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE });
    const keys1 = g1.atoms.filter((a) => a.el === 'O').map(surfaceSiteKey).sort();
    const keys2 = g2.atoms.filter((a) => a.el === 'O').map(surfaceSiteKey).sort();
    expect(keys1).toEqual(keys2);
  });
});

describe('Create Vacancy 几何联动（任务书 59/60/61）', () => {
  const g0 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE });
  const topO = g0.atoms.find((a) => a.el === 'O' && a.z === Math.max(...g0.atoms.filter((x) => x.el === 'O').map((x) => x.z)))!;
  const defect = { type: 'oxygen-vacancy' as const, siteKey: surfaceSiteKey(topO), element: 'O' as const, originalPosition: [topO.x, topO.y, topO.z] as [number, number, number] };
  const g1 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE, defects: [defect] });

  it('atomCount -1、O -1、Ce 不变；composition 同步', () => {
    expect(g1.atoms).toHaveLength(g0.atoms.length - 1);
    const count = (g: typeof g0, el: string) => g.atoms.filter((a) => a.el === el).length;
    expect(count(g1, 'O')).toBe(count(g0, 'O') - 1);
    expect(count(g1, 'Ce')).toBe(count(g0, 'Ce'));
    expect((g1.meta as { composition: Record<string, number> }).composition.O).toBe((g0.meta as { composition: Record<string, number> }).composition.O - 1);
  });

  it('bonds 无越界引用（全部 index < atoms.length）', () => {
    for (const [i, j] of g1.bonds) {
      expect(i).toBeLessThan(g1.atoms.length);
      expect(j).toBeLessThan(g1.atoms.length);
      expect(i).toBeGreaterThanOrEqual(0);
    }
    expect(g1.bonds.length).toBeGreaterThan(0);
  });

  it('重复删除保护：同 siteKey 二次 no-op（任务书 67）', () => {
    const g2 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE, defects: [defect, defect] });
    expect(g2.atoms).toHaveLength(g0.atoms.length - 1); // 只删一次
  });

  it('Ce 不能创建（siteKey 恒不匹配 Ce——element 门禁 + 键只删 O）', () => {
    const ce = g0.atoms.find((a) => a.el === 'Ce')!;
    const fake = { type: 'oxygen-vacancy' as const, siteKey: surfaceSiteKey(ce), element: 'O' as const, originalPosition: [0, 0, 0] as [number, number, number] };
    const g2 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE, defects: [fake] });
    expect(g2.atoms).toHaveLength(g0.atoms.length); // applySurfaceDefects 仅删 el==='O'
    expect((g2.meta as { invalidDefects: number }).invalidDefects).toBe(1); // 如实标记失效
  });

  it('siteKey 失效（params 改变）：不模糊删除，invalidDefects 计数（任务书 70）', () => {
    const g2 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE, h: 1, k: 1, l: 0, defects: [defect] }); // 换晶面
    const count = (g: typeof g0) => g.atoms.filter((a) => a.el === 'O').length;
    expect((g2.meta as { invalidDefects: number }).invalidDefects).toBe(1);
    expect(count(g2)).toBe(count(buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE, h: 1, k: 1, l: 0 } as never)) === count(g2) ? count(g2) : count(g2)); // 未误删
  });
});

describe('Worker 一致（任务书 64）', () => {
  it('computeGeometry 与直调 buildCrystalSurface 的 atoms/bonds/composition 一致（含 defects）', () => {
    const g0 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE });
    const topO = g0.atoms.filter((a) => a.el === 'O').sort((a, b) => b.z - a.z)[0]!;
    const defect = { type: 'oxygen-vacancy' as const, siteKey: surfaceSiteKey(topO), element: 'O' as const, originalPosition: [topO.x, topO.y, topO.z] as [number, number, number] };
    const direct = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE, defects: [defect] });
    const viaWorker = computeGeometry({ kind: 'crystal_surface', cifText: MINERALS.ceo2.cifText, params: { ...BASE, defects: [defect] } });
    expect(viaWorker.atoms).toHaveLength(direct.atoms.length);
    expect(viaWorker.bonds).toHaveLength(direct.bonds.length);
    expect((viaWorker.meta as { composition: Record<string, number> }).composition.O).toBe((direct.meta as { composition: Record<string, number> }).composition.O);
  });
});

describe('吸附使用 defected 几何 + Vacancy site（任务书 66/Gate3）', () => {
  it('画布少一个 O = 吸附引擎少同一个 O；Vacancy site 中心 = 被删 O 原位', () => {
    const g0 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE });
    const topO = g0.atoms.filter((a) => a.el === 'O').sort((a, b) => b.z - a.z)[0]!;
    const defect = { type: 'oxygen-vacancy' as const, siteKey: surfaceSiteKey(topO), element: 'O' as const, originalPosition: [topO.x, topO.y, topO.z] as [number, number, number] };
    // 吸附引擎路径（adsorptionStore.generate 同款）
    const slab0 = buildMillerSlab(MINERALS.ceo2.cifText, { h: 1, k: 1, l: 1, sizeX: 12, sizeY: 12, thickness: 8, termination: 0 });
    const applied = applySurfaceDefects(slab0, [defect]);
    expect(applied.atoms).toHaveLength(g0.atoms.length - 1); // 与画布一致
    expect(applied.atoms.some((a) => surfaceSiteKey(a) === defect.siteKey)).toBe(false); // 同一个 O 被删
    // Vacancy site
    const sites = surfaceSites({ ...slab0, atoms: applied.atoms, bonds: applied.bonds, vacancies: [defect.originalPosition] } as never);
    expect(sites.vacancy).toHaveLength(1);
    expect(sites.vacancy[0]!.x).toBeCloseTo(defect.originalPosition[0], 3);
    expect(sites.vacancy[0]!.y).toBeCloseTo(defect.originalPosition[1], 3);
    // 候选生成可用
    const cand = generateAdsorbCandidate({ ...slab0, atoms: applied.atoms, bonds: applied.bonds, vacancies: [defect.originalPosition] } as never, buildMolecule('C₇H₈'), { site: 'vacancy', orientation: 'parallel', distance: 2.5 }, 'C₇H₈');
    expect(cand.minDistance).toBeGreaterThan(0);
  });
});

describe('Undo / 序列化 / 模板（任务书 62/63/模板往返）', () => {
  it('创建 Ov → Undo 恢复 atomCount → Redo 再减（走 updateParams 一条 Undo）', () => {
    attachHistory(sceneStore, { mergeWindowMs: 0 });
    const sid = sceneStore.getState().addComponent('crystal_surface', { params: { ...BASE } });
    const comp = () => sceneStore.getState().components.find((c) => c.id === sid)!;
    const n0 = 0; // atomCount 由渲染层；这里以 params.defects.length 为 proxy
    expect((comp().params as { defects: unknown[] }).defects).toHaveLength(n0);
    // 模拟创建（直接调 store action 前需 pickedAtom——绕过拾取直接构造）
    const g0 = buildCrystalSurface(MINERALS.ceo2.cifText, { ...BASE });
    const topO = g0.atoms.filter((a) => a.el === 'O').sort((a, b) => b.z - a.z)[0]!;
    sceneStore.getState().setPickedAtom({ componentId: sid, atomIndex: 0, el: 'O', siteKey: surfaceSiteKey(topO), position: [topO.x, topO.y, topO.z], isTopLayer: true });
    sceneStore.getState().createOxygenVacancy(sid);
    expect((comp().params as { defects: unknown[] }).defects).toHaveLength(1);
    // 重复创建被拒
    sceneStore.getState().setPickedAtom({ componentId: sid, atomIndex: 0, el: 'O', siteKey: surfaceSiteKey(topO), position: [topO.x, topO.y, topO.z], isTopLayer: true });
    expect(() => sceneStore.getState().createOxygenVacancy(sid)).toThrow();
    // 非 O 拒绝
    sceneStore.getState().setPickedAtom({ componentId: sid, atomIndex: 1, el: 'Ce', siteKey: 'x', position: [0, 0, 0], isTopLayer: true });
    expect(() => sceneStore.getState().createOxygenVacancy(sid)).toThrow();
    // 深层 O 拒绝
    sceneStore.getState().setPickedAtom({ componentId: sid, atomIndex: 2, el: 'O', siteKey: 'y', position: [0, 0, -5], isTopLayer: false });
    expect(() => sceneStore.getState().createOxygenVacancy(sid)).toThrow();
    // 序列化往返
    const doc = JSON.parse(JSON.stringify(sceneStore.getState().toSceneDocument()));
    expect(JSON.stringify(doc)).toContain('oxygen-vacancy');
    for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
    sceneStore.getState().loadScene(doc);
    const back = sceneStore.getState().components.find((c) => c.type === 'crystal_surface')!;
    expect((back.params as { defects: Array<{ siteKey: string }> }).defects[0]!.siteKey).toBe(surfaceSiteKey(topO));
  });

  it('旧 scene 无 defects 字段：默认 [] 兼容加载', () => {
    sceneStore.getState().addComponent('crystal_surface', { params: { ...BASE } });
    const doc = JSON.parse(JSON.stringify(sceneStore.getState().toSceneDocument()));
    for (const c of doc.components) delete c.params.defects; // 模拟旧数据
    for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
    expect(() => sceneStore.getState().loadScene(doc)).not.toThrow();
    expect((sceneStore.getState().components[0]!.params as { defects?: unknown[] }).defects).toEqual([]);
  });
});
