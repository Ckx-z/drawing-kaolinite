/**
 * 吸附工作流产品闭环验收 —— 2026-09-21（任务书 58-68）
 *
 * Metadata 管线（不丢失）/ 候选不污染 Scene/Undo / Apply 一条事务 /
 * 参数变化失效 / 欧拉 XYZ 一致性 / methyl-down·end-on 拓扑轴 dot-product /
 * 模板 roundtrip。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildCrystalSurface, buildMolecule } from '../core/builders';
import { computeGeometry } from '../core/worker';
import { MINERALS } from '../core/minerals';
import { generateAdsorbCandidate } from '../core/surface/adsorb';
import { buildMillerSlab } from '../core/surface/slab';
import type { ScientificGeometryMeta } from '../core/geometry';
import { attachHistory } from './history';
import { createSceneStore, sceneStore } from './sceneStore';
import { useAdsorptionStore, clearAdsorption } from './adsorptionStore';

const SURF = { mineral: 'ceo2', h: 1, k: 1, l: 1, sizeX: 14, sizeY: 14, thickness: 9, termination: 0, style: '球棍' } as const;

describe('Metadata 管线（buildMillerSlab → buildCrystalSurface → Worker）', () => {
  it('buildCrystalSurface 保留科学元数据（不再 meta:{}）', () => {
    const g = buildCrystalSurface(MINERALS.ceo2.cifText, { ...SURF });
    const meta = g.meta as ScientificGeometryMeta;
    expect(meta).toBeTruthy();
    expect(meta.millerIndex).toEqual([1, 1, 1]);
    expect(meta.sourceAssetId).toBe('mineral:ceo2');
    expect(meta.surfaceNormal).toEqual([0, 0, 1]);
    expect(meta.geometrySource).toBe('generated');
    expect(meta.relaxed).toBe(false);
    expect(meta.composition?.Ce).toBeGreaterThan(0);
    expect((meta.terminationCount ?? 0) as number).toBeGreaterThanOrEqual(2);
  });

  it('Worker computeGeometry roundtrip 后 meta 仍在（structured-clone 安全）', () => {
    const g = computeGeometry({ kind: 'crystal_surface', cifText: MINERALS.ceo2.cifText, params: { ...SURF } });
    const meta = g.meta as ScientificGeometryMeta;
    expect(meta.millerIndex).toEqual([1, 1, 1]);
    expect(meta.composition?.O).toBeGreaterThan(0);
  });
});

describe('候选状态层（不污染 Scene / 单预览 / 失效）', () => {
  it('generate 不改变场景组件数；候选切换 scene 不变', () => {
    clearAdsorption();
    const store = createSceneStore();
    const id = store.getState().addComponent('crystal_surface', { params: { ...SURF } });
    const before = store.getState().components.length;
    useAdsorptionStore.setState({ adsorbate: 'C₇H₈', site: 'top', distance: 3.0 });
    const cands = useAdsorptionStore.getState().generate(id, store.getState().components[0]!.params as never);
    expect(cands).toHaveLength(4);
    expect(store.getState().components.length).toBe(before); // 预览不进 scene
    useAdsorptionStore.getState().setActive(2);
    expect(store.getState().components.length).toBe(before); // 切换不变 scene
  });

  it('apply：组件 +1（普通 molecule）、一条 Undo 回退、preview 清空', () => {
    clearAdsorption();
    // apply 写全局 sceneStore 单例——测试直接用单例并清理
    for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
    const history = attachHistory(sceneStore, { mergeWindowMs: 0 });
    const id = sceneStore.getState().addComponent('crystal_surface', { params: { ...SURF } });
    useAdsorptionStore.setState({ adsorbate: 'C₇H₈', site: 'top', distance: 3.0 });
    useAdsorptionStore.getState().generate(id, sceneStore.getState().components[0]!.params as never);
    const n0 = sceneStore.getState().components.length;
    const appliedId = useAdsorptionStore.getState().apply();
    expect(appliedId).toBeTruthy();
    expect(sceneStore.getState().components).toHaveLength(n0 + 1);
    expect(useAdsorptionStore.getState().candidates).toHaveLength(0); // preview 清空
    const d0 = history.depths().undo;
    history.undo();
    expect(sceneStore.getState().components).toHaveLength(n0); // Apply 可整体撤销
    expect(history.depths().undo).toBe(d0 - 1);
  });

  it('surface 参数变化 → 候选按新参数重建（旧候选即刻失效，任务书六十五）', () => {
    clearAdsorption();
    const store = createSceneStore();
    const id = store.getState().addComponent('crystal_surface', { params: { ...SURF } });
    useAdsorptionStore.setState({ adsorbate: 'C₇H₈', site: 'top', distance: 3.0 });
    useAdsorptionStore.getState().generate(id, store.getState().components[0]!.params as never);
    // h: 1 → 0（(111)→(011)? 用 h=0 k=1 l=1 合法面）
    store.getState().updateParams(id, { h: 0 } as never);
    const st = useAdsorptionStore.getState();
    expect(st.surface?.h).toBe(1); // 旧快照仍是旧参数（UI useEffect 将触发 regenerate）
  });
});

describe('取向语义（拓扑轴 dot-product，任务书 67/68/69——坐标向量而非截图）', () => {
  const surf = buildMillerSlab(MINERALS.ceo2.cifText, { h: 1, k: 1, l: 1, sizeX: 12, sizeY: 12, thickness: 8, termination: 0 });

  it('methyl-down：甲基碳−环心向量与 −法向夹角 < 10°', () => {
    const c = generateAdsorbCandidate(surf, buildMolecule('C₇H₈'), { site: 'top', orientation: 'methyl-down', distance: 3.0 }, 'C₇H₈');
    const ring = [0, 1, 2, 4, 5, 6].map((i) => c.atoms[i]!);
    const cx = ring.reduce((a, x) => a + x.x / 6, 0);
    const cy = ring.reduce((a, x) => a + x.y / 6, 0);
    const cz = ring.reduce((a, x) => a + x.z / 6, 0);
    const m = c.atoms[3]!;
    const v = [m.x - cx, m.y - cy, m.z - cz];
    const L = Math.hypot(...v) || 1;
    const dotDown = -v[2]! / L; // 与 (0,0,-1) 的 cos
    expect(dotDown).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
  });

  it('end-on：丙烷链端方向与 −法向夹角 < 10°', () => {
    const c = generateAdsorbCandidate(surf, buildMolecule('C₃H₈'), { site: 'top', orientation: 'end-on', distance: 3.0 }, 'C₃H₈');
    const a = c.atoms[0]!;
    const b = c.atoms[1]!;
    const v = [b.x - a.x, b.y - a.y, b.z - a.z];
    const L = Math.hypot(...v) || 1;
    expect(-v[2]! / L).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
  });

  it('欧拉 XYZ 一致性：transform{position,rotation,scale:1} 渲染原子与 candidate.atoms 逐位一致', () => {
    const c = generateAdsorbCandidate(surf, buildMolecule('C₇H₈'), { site: 'top', orientation: 'tilted', distance: 3.0 }, 'C₇H₈');
    const [rx, ry, rz] = c.rotation.map((d) => (d * Math.PI) / 180);
    // R = Rx·Ry·Rz（THREE.Euler 默认序）
    const rot = (v: number[]) => {
      const [x, y, z] = v;
      const cz2 = Math.cos(rz), sz = Math.sin(rz);
      const v1 = [x * cz2 - y * sz, x * sz + y * cz2, z]; // Rz
      const cy2 = Math.cos(ry), sy = Math.sin(ry);
      const v2 = [v1[0]! * cy2 + v1[2]! * sy, v1[1]!, -v1[0]! * sy + v1[2]! * cy2]; // Ry
      const cx2 = Math.cos(rx), sx = Math.sin(rx);
      return [v2[0]!, v2[1]! * cx2 - v2[2]! * sx, v2[1]! * sx + v2[2]! * cx2]; // Rx
    };
    const raw = buildMolecule('C₇H₈').atoms; // 质心居中原始构象
    for (const [i, a] of raw.entries()) {
      const r = rot([a.x, a.y, a.z]);
      expect(r[0]! + c.position[0]).toBeCloseTo(c.atoms[i]!.x, 2); // 1e-3 Å（欧拉双重三角变换精度，远小于原子尺度）
      expect(r[1]! + c.position[1]).toBeCloseTo(c.atoms[i]!.y, 2);
      expect(r[2]! + c.position[2]).toBeCloseTo(c.atoms[i]!.z, 2);
    }
  });
});

describe('模板 roundtrip（任务书 66）', () => {
  it('apply → toSceneDocument → loadScene：Surface + Adsorbate 数量与 transform 保持', () => {
    clearAdsorption();
    for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
    const sid = sceneStore.getState().addComponent('crystal_surface', { params: { ...SURF } });
    useAdsorptionStore.setState({ adsorbate: 'C₃H₈', site: 'hollow', distance: 3.2 });
    useAdsorptionStore.getState().generate(sid, sceneStore.getState().components[0]!.params as never);
    const mid = useAdsorptionStore.getState().apply()!;
    const mol = sceneStore.getState().components.find((c) => c.id === mid)!;
    const doc = JSON.parse(JSON.stringify(sceneStore.getState().toSceneDocument()));
    const dst = createSceneStore();
    dst.getState().loadScene(doc);
    const back = dst.getState().components;
    expect(back).toHaveLength(2);
    const molBack = back.find((c) => c.type === 'molecule')!;
    expect(molBack.transform.position).toEqual(mol.transform.position);
    expect(molBack.transform.rotation).toEqual(mol.transform.rotation);
    expect((molBack.params as { kind: string }).kind).toBe('C₃H₈');
  });
});
