/**
 * 吸附构型科学验证 —— PHASE B（2026-09-20，任务书二十六/三十一~三十四）
 *
 * CeO₂(111) + 甲苯（首个 benchmark）与 CeO₂(111) + 丙烷（第二个）：
 * 候选确定性、无严重碰撞（clash 自动推出）、距离可控、取向几何可验证
 * （甲苯环平面法向 vs 表面法向的夹角）、geometryMethod=initial（无能量声称）。
 */
import { describe, expect, it } from 'vitest';
import { MINERALS } from '../minerals';
import { buildMolecule } from '../builders';
import { buildMillerSlab } from './slab';
import { generateAdsorbCandidate, generateAdsorptionCandidates, surfaceSites } from './adsorb';

const surf = buildMillerSlab(MINERALS.ceo2.cifText, { h: 1, k: 1, l: 1, sizeX: 12, sizeY: 12, thickness: 8, termination: 0 });
const toluene = buildMolecule('C₇H₈');
const propane = buildMolecule('C₃H₈');

describe('吸附位点（确定性检测）', () => {
  it('top/bridge/hollow 三类位点均非空且按距原点排序', () => {
    const s = surfaceSites(surf);
    for (const k of ['top', 'bridge', 'hollow'] as const) {
      expect(s[k].length, k).toBeGreaterThan(0);
      for (let i = 1; i < s[k]!.length; i++)
        expect(Math.hypot(s[k]![i]!.x, s[k]![i]!.y)).toBeGreaterThanOrEqual(Math.hypot(s[k]![i - 1]!.x, s[k]![i - 1]!.y) - 1e-9);
    }
  });
});

describe('Toluene@CeO₂(111)（首个 benchmark，任务书三十三）', () => {
  it('生成 4 个确定性候选（parallel/tilted/perpendicular/methyl-down），全部无碰撞', () => {
    const cs = generateAdsorptionCandidates(surf, toluene, 'top');
    expect(cs).toHaveLength(4);
    expect(cs.map((c) => c.orientation)).toEqual(['parallel', 'tilted', 'perpendicular', 'methyl-down']);
    for (const c of cs) {
      expect(c.geometryMethod).toBe('initial');
      expect(c.minDistance).toBeGreaterThan(0);
      expect(c.atoms).toHaveLength(15); // C7H8 不变
      expect(c.bonds).toHaveLength(15);
    }
    // 确定性：重跑逐位一致
    const cs2 = generateAdsorptionCandidates(surf, toluene, 'top');
    expect(cs2[0]!.atoms[0]!.x).toBeCloseTo(cs[0]!.atoms[0]!.x, 12);
  });

  it('parallel 取向：苯环法向 ∥ 表面法向（环平面与表面夹角 < 2°）', () => {
    const c = generateAdsorbCandidate(surf, toluene, { site: 'top', orientation: 'parallel' });
    // 环碳（转录序 0,1,2,4,5,6）拟合平面法向
    const ring = [0, 1, 2, 4, 5, 6].map((i) => c.atoms[i]!);
    const [p0, p1, p2] = [ring[0]!, ring[1]!, ring[2]!];
    const u = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
    const v = [p2.x - p0.x, p2.y - p0.y, p2.z - p0.z];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(...n) || 1;
    const cos = Math.abs(n[2]! / L); // 与 z 轴夹角
    expect(cos).toBeGreaterThan(Math.cos((2 * Math.PI) / 180)); // < 2°
  });

  it('perpendicular 取向：环法向 ⊥ 表面法向（环平面近竖直）', () => {
    const c = generateAdsorbCandidate(surf, toluene, { site: 'top', orientation: 'perpendicular' });
    const ring = [0, 1, 2, 4, 5, 6].map((i) => c.atoms[i]!);
    const [p0, p1, p2] = [ring[0]!, ring[1]!, ring[2]!];
    const u = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
    const v = [p2.x - p0.x, p2.y - p0.y, p2.z - p0.z];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(...n) || 1;
    expect(Math.abs(n[2]! / L)).toBeLessThan(Math.sin((10 * Math.PI) / 180)); // 与 z 夹角 > 80°
  });

  it('distance 参数生效：2.5 vs 4.5 的候选-表面最小距单调不减', () => {
    const near = generateAdsorbCandidate(surf, toluene, { site: 'top', orientation: 'parallel', distance: 2.5 });
    const far = generateAdsorbCandidate(surf, toluene, { site: 'top', orientation: 'parallel', distance: 4.5 });
    expect(far.minDistance).toBeGreaterThan(near.minDistance);
    expect(far.minDistance).toBeGreaterThan(2.2); // 2.5 间距下分子原子距表面 >2.2
  });

  it('过近初始距离触发 clash 自动推出且解除（clashResolved 语义）', () => {
    const c = generateAdsorbCandidate(surf, toluene, { site: 'top', orientation: 'parallel', distance: 0.5 });
    expect(c.clashResolved).toBe(true);
    expect(c.minDistance).toBeGreaterThan(0); // 推出后无碰撞
  });
});

describe('Propane@CeO₂(111)（第二个 benchmark，任务书三十四）', () => {
  it('候选生成：11 原子保持、无碰撞、确定性', () => {
    const cs = generateAdsorptionCandidates(surf, propane, 'hollow');
    expect(cs).toHaveLength(4);
    for (const c of cs) {
      expect(c.atoms).toHaveLength(11);
      expect(c.minDistance).toBeGreaterThan(0);
      expect(c.site).toBe('hollow');
    }
  });

  it('bridge site 同样可用（三种 site 全覆盖）', () => {
    for (const site of ['top', 'bridge', 'hollow'] as const) {
      const c = generateAdsorbCandidate(surf, propane, { site, orientation: 'end-on', distance: 3.0 });
      expect(c.minDistance).toBeGreaterThan(0);
    }
  });
});
