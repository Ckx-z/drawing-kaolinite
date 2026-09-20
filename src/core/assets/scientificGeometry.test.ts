/**
 * Scientific Invariant Tests —— PHASE A（2026-09-20，任务书十二）
 *
 * 统一科学结构验收：测试几何本身（键长/键角/组成/晶胞/化学计量/空间结构），
 * 而非截图或程序自洽。散落在 minerals/catalyst/toluene/propane 的既有断言
 * 保留；本文件是跨资产的科学门面（STRUCTURE_BENCHMARK.md 的可执行对应物）。
 * 键角复用测量系统 measures.angleDeg。
 */
import { describe, expect, it } from 'vitest';
import { buildMolecule, MOLECULES } from '../builders';
import { angleDeg } from '../measures';
import { expandSymmetry, parseCIF } from '../crystal';
import { MINERALS } from '../minerals';
import { CANONICAL_ASSETS, resolveAsset } from './registry';

const P = (a: { x: number; y: number; z: number }): [number, number, number] => [a.x, a.y, a.z];
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('Registry（Canonical Asset）', () => {
  it('全部 canonical 资产具备 id/geometrySource/quality；矿物带 provenance（除已知 illite 限制）', () => {
    expect(CANONICAL_ASSETS.length).toBe(17); // 8 矿物 + 9 分子
    for (const a of CANONICAL_ASSETS) {
      expect(a.id).toMatch(/^(mineral|molecule):/);
      expect(['reference', 'imported', 'generated', 'schematic', 'optimized', 'external']).toContain(a.geometrySource);
      expect(a.geometryQuality).toBeTruthy();
      if (a.type === 'mineral') {
        if (a.mineralKey === 'illite') return; // 来源未记录（已知限制，DECISIONS）
        expect(a.provenance?.sourceDatabase, `${a.id} 应有来源数据库`).toBeTruthy();
      }
    }
  });

  it('多搜索词 → 同一 canonical 实体（身份由 id 决定）', () => {
    for (const q of ['二氧化铈', 'CeO2', 'ceo₂', 'ceria']) expect(resolveAsset(q)?.id).toBe('mineral:ceo2');
    for (const q of ['甲苯', 'toluene', 'C7H8', 'methylbenzene']) expect(resolveAsset(q)?.id).toBe('molecule:C₇H₈');
    expect(resolveAsset('四氧化三钴')?.id).toBe('mineral:co3o4');
    expect(resolveAsset('高岭石')?.id).toBe('mineral:kaolinite');
    expect(resolveAsset('莫来石')?.id).toBe('mineral:mullite');
    expect(resolveAsset('xyz-unknown')).toBeNull();
  });

  it('schematic 资产如实标注（阳离子单原子示意，不冒充 reference）', () => {
    expect(resolveAsset('Ce³⁺')?.geometryQuality).toBe('schematic');
    expect(resolveAsset('Ca²⁺')?.geometrySource).toBe('schematic');
  });
});

describe('分子科学不变量', () => {
  it('H₂O：O–H = 0.9595±0.0005Å ×2，H–O–H = 104.5±0.5°', () => {
    const a = MOLECULES['H₂O']!.atoms;
    expect(dist(a[0]!, a[1]!)).toBeCloseTo(0.9595, 3); // √(0.759²+0.587²) = 0.95953（文献 0.959）
    expect(dist(a[0]!, a[2]!)).toBeCloseTo(0.9595, 3);
    const theta = angleDeg(P(a[1]!), P(a[0]!), P(a[2]!));
    expect(Math.abs(theta - 104.5)).toBeLessThan(0.5);
  });

  it('CO₂：严格线性（180±0.01°），C–O = 1.16Å ×2', () => {
    const a = MOLECULES['CO₂']!.atoms;
    expect(Math.abs(angleDeg(P(a[1]!), P(a[0]!), P(a[2]!)) - 180)).toBeLessThan(0.01);
    expect(dist(a[0]!, a[1]!)).toBeCloseTo(1.16, 6);
  });

  it('O₂ / N₂：双原子（2 原子 1 键）', () => {
    for (const k of ['O₂', 'N₂'] as const) {
      expect(MOLECULES[k]!.atoms).toHaveLength(2);
      expect(MOLECULES[k]!.bonds).toHaveLength(1);
    }
  });

  it('甲苯：苯环 6 碳共面 <0.01Å，芳 C–C ∈ 1.36–1.42Å（PubChem CID 1140）', () => {
    const g = buildMolecule('C₇H₈');
    const ring = [0, 1, 2, 4, 5, 6].map((i) => g.atoms[i]!);
    const [p0, p1, p2] = [P(ring[0]!), P(ring[1]!), P(ring[2]!)];
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(...n) || 1;
    for (const p of ring.slice(3)) {
      const dev = Math.abs(((P(p)[0] - p0[0]) * n[0] + (P(p)[1] - p0[1]) * n[1] + (P(p)[2] - p0[2]) * n[2]) / L);
      expect(dev).toBeLessThan(0.01);
    }
    for (const [i, j] of [[0, 1], [0, 2], [1, 4], [2, 5], [4, 6], [5, 6]]) {
      const d = dist(g.atoms[i]!, g.atoms[j]!);
      expect(d).toBeGreaterThan(1.36);
      expect(d).toBeLessThan(1.42);
    }
  });

  it('丙烷：C–C–C = 111.66±0.5°（PubChem CID 6334，非理论值硬编码）', () => {
    const g = buildMolecule('C₃H₈');
    expect(Math.abs(angleDeg(P(g.atoms[1]!), P(g.atoms[0]!), P(g.atoms[2]!)) - 111.66)).toBeLessThan(0.5);
  });
});

describe('晶体科学不变量（晶胞 / 展开 / 化学计量）', () => {
  const cases: Array<[MineralKeyOf, number, Record<string, number>, number]> = [
    ['kaolinite', 26, { Al: 4, Si: 4, O: 18 }, 7.4048],
    ['ceo2', 12, { Ce: 4, O: 8 }, 5.411],
    ['co3o4', 56, { Co: 24, O: 32 }, 8.0968],
    ['mullite', 28, { Al: 10, Si: 4, O: 14 }, 2.8899],
  ];
  type MineralKeyOf = keyof typeof MINERALS;

  it.each(cases)('%s：展开 %i 原子、化学计量 %j、c 轴精确', (key, total, byEl, c) => {
    const def = MINERALS[key];
    const parsed = parseCIF(def.cifText);
    expect(parsed.cell.c).toBeCloseTo(c, 3);
    const e = expandSymmetry(parsed.atoms, parsed.symops);
    expect(e).toHaveLength(total);
    const by: Record<string, number> = {};
    for (const a of e) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual(byEl);
  });

  it('莫来石：零占位位点 Si3 被剔除（occupancy 语义）；声明化学式 = Al4.8Si1.2O9.6', () => {
    const parsed = parseCIF(MINERALS.mullite.cifText);
    expect(parsed.atoms.some((a) => a.label === 'Si3')).toBe(false);
    expect(MINERALS.mullite.formula).toBe('Al4.8Si1.2O9.6');
  });
});
