/**
 * Miller Surface 科学验证 —— PHASE B（2026-09-20，任务书二十六）
 *
 * 覆盖：法向正确（u/v ⊥ G 由倒易关系保证并数值复验）、表面重复矢量正确
 * （CeO₂(111) 首选 u = a√2 方向）、超胞/组成、厚度窗口、原子无重复、
 * 确定性、Worker/fallback 同构（同函数同输入）。
 */
import { describe, expect, it } from 'vitest';
import { MINERALS } from '../minerals';
import { parseCIF } from '../crystal';
import { buildMillerSlab, surfaceRepeatVectors } from './slab';

const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('Miller 表面重复矢量（倒易格矢数学）', () => {
  it('CeO₂(111)：u/v 与 G=[111] 严格正交；u 最短组合为 <1,-1,0> 型（|u| = a√2）', () => {
    const cif = parseCIF(MINERALS.ceo2.cifText);
    const { u, v } = surfaceRepeatVectors(cif.cell, 1, 1, 1);
    // 正交性（u,v ⊥ G）
    const g = [1, 1, 1]; // 立方晶系 G ∝ [h,k,l]
    expect(Math.abs(dot3(u, g))).toBeLessThan(1e-9);
    expect(Math.abs(dot3(v, g))).toBeLessThan(1e-9);
    // 最短面内格矢 = a√2（<1,-1,0> 组合；F 心原子由 192 symops 展开）
    expect(Math.hypot(...u)).toBeCloseTo(5.411 * Math.SQRT2, 3);
    // u × v ∥ +normal（右手系）
    const cx = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    expect(dot3(cx, g)).toBeGreaterThan(0);
  });

  it('Co₃O₄(110) / CeO₂(100)：法向正交性通用', () => {
    const cases: Array<[string, [number, number, number]]> = [
      [MINERALS.co3o4.cifText, [1, 1, 0]],
      [MINERALS.ceo2.cifText, [1, 0, 0]],
    ];
    for (const [cifText, hkl] of cases) {
      const cif = parseCIF(cifText);
      const { u, v } = surfaceRepeatVectors(cif.cell, hkl[0], hkl[1], hkl[2]);
      const cellD = Math.max(cif.cell.a, cif.cell.b, cif.cell.c);
      expect(Math.hypot(...u)).toBeGreaterThan(cellD * 0.5);
      expect(Math.hypot(...u)).toBeLessThan(cellD * 3);
      const cx = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(dot3(cx, hkl)).toBeGreaterThan(0);
      // 任意指数：组合正交（立方 G∝hkl）
      expect(Math.abs(dot3(u, hkl))).toBeLessThan(1e-9);
      expect(Math.abs(dot3(v, hkl))).toBeLessThan(1e-9);
    }
  });
});

describe('CeO₂(111) slab（首个验证材料）', () => {
  const build = () =>
    buildMillerSlab(MINERALS.ceo2.cifText, { h: 1, k: 1, l: 1, sizeX: 12, sizeY: 12, thickness: 8, termination: 0 });

  it('生成成功：原子数百量级、组成 Ce:O ≈ 1:2、无原子重复（最小间距 > 0.5Å）', () => {
    const g = build();
    expect(g.atoms.length).toBeGreaterThan(50);
    expect(g.atoms.length).toBeLessThan(3000); // 性能门（任务书五十五）
    const ce = g.meta.composition.Ce ?? 0;
    const o = g.meta.composition.O ?? 0;
    expect(o / ce).toBeGreaterThan(1.7);
    expect(o / ce).toBeLessThan(2.3);
    let minD = Infinity;
    for (let i = 0; i < g.atoms.length; i++)
      for (let j = i + 1; j < g.atoms.length; j++) {
        const d = Math.hypot(g.atoms[i]!.x - g.atoms[j]!.x, g.atoms[i]!.y - g.atoms[j]!.y, g.atoms[i]!.z - g.atoms[j]!.z);
        if (d < minD) minD = d;
      }
    expect(minD).toBeGreaterThan(0.5); // 无重叠原子
  });

  it('厚度窗口：z 范围 ≤ thickness + 层容差；z 分层存在（法向周期结构）', () => {
    const g = build();
    const zs = g.atoms.map((a) => a.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(8 + 0.6);
    expect(g.meta.normal).toEqual([0, 0, 1]);
    expect(g.meta.relaxed).toBe(false);
    expect(g.meta.geometrySource).toBe('generated');
  });

  it('termination 候选枚举 ≥ 2 且切换 termination 产生不同结构（确定性差异）', () => {
    const a = build();
    expect(a.meta.terminationCount).toBeGreaterThanOrEqual(2);
    const b = buildMillerSlab(MINERALS.ceo2.cifText, { h: 1, k: 1, l: 1, sizeX: 12, sizeY: 12, thickness: 8, termination: 1 });
    expect(b.atoms.length).not.toBe(a.atoms.length); // 不同切割面 → 不同位点集
  });

  it('确定性：同输入两次构建逐位一致', () => {
    const a = build();
    const b = build();
    expect(a.atoms).toHaveLength(b.atoms.length);
    for (const [i, x] of a.atoms.entries()) {
      expect(x.x).toBeCloseTo(b.atoms[i]!.x, 12);
      expect(x.z).toBeCloseTo(b.atoms[i]!.z, 12);
    }
  });

  it('(000) 与非法指数明确报错（不静默空白）', () => {
    expect(() => buildMillerSlab(MINERALS.ceo2.cifText, { h: 0, k: 0, l: 0, sizeX: 10, sizeY: 10, thickness: 6, termination: 0 })).toThrow();
  });
});

describe('Co₃O₄(110) slab（第二材料）', () => {
  it('生成成功：Co:O 比例合理（体相 24:32 → 表面容差带）、键网存在', () => {
    const g = buildMillerSlab(MINERALS.co3o4.cifText, { h: 1, k: 1, l: 0, sizeX: 14, sizeY: 14, thickness: 9, termination: 0 });
    expect(g.atoms.length).toBeGreaterThan(60);
    expect(g.bonds.length).toBeGreaterThan(50);
    const co = g.meta.composition.Co ?? 0;
    const o = g.meta.composition.O ?? 0;
    expect(o / co).toBeGreaterThan(0.9);
    expect(o / co).toBeLessThan(1.8);
  });
});
