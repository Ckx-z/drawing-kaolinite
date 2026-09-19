/**
 * 丙烷内置 preset 验收 —— 2026-09-18
 *
 * 几何唯一真源 = 内置 SMILES 规则式构象器（builders.MOLECULES['C₃H₈'] 模块
 * 初始化时由 smilesTo3D('CCC') 运行时生成——零手搓坐标、零新依赖）。
 * 搜索别名：丙烷/propane/C3H8（与甲苯 C₇H₈ 同一注册表语义）。
 */
import { describe, expect, it } from 'vitest';
import { buildMolecule, MOLECULES } from '../builders';
import { smilesTo3D } from './smiles';
import { resolveCanonicalFormula, resolveMoleculeQuery } from './registry';
import { moleculeParamsSchema } from '../schema';

const g = buildMolecule('C₃H₈');
const centroidOf = (atoms: Array<{ x: number; y: number; z: number }>) => {
  const n = atoms.length || 1;
  return atoms.reduce((acc, a) => ({ x: acc.x + a.x / n, y: acc.y + a.y / n, z: acc.z + a.z / n }), { x: 0, y: 0, z: 0 });
};

describe('丙烷搜索别名', () => {
  it('中文名/英文/大小写/化学式多路命中 C₃H₈', () => {
    for (const q of ['丙烷', 'propane', 'Propane', 'PROPANE', 'C3H8', 'C₃H₈']) {
      expect(resolveMoleculeQuery(q), `"${q}" 应命中丙烷`).toBe('C₃H₈');
    }
    expect(resolveCanonicalFormula('C3H8')).toBe('C₃H₈');
    expect(resolveCanonicalFormula('C₃H₈')).toBe('C₃H₈');
    expect(resolveCanonicalFormula('c3h8')).toBe('C₃H₈');
    // 近似式不误吞
    for (const f of ['C3H8O', 'C3H6', 'C2H6']) expect(resolveCanonicalFormula(f)).toBeNull();
    for (const q of ['prop', 'propan', '丙酮']) expect(resolveMoleculeQuery(q)).toBeNull();
  });

  it('schema：kind C₃H₈ 合法', () => {
    expect(moleculeParamsSchema.parse({ kind: 'C₃H₈' }).kind).toBe('C₃H₈');
  });
});

describe('丙烷几何（SMILES CCC 规则式构象）', () => {
  it('11 原子（C3H8）10 键（2 C–C + 8 C–H）', () => {
    expect(g.atoms).toHaveLength(11);
    expect(g.bonds).toHaveLength(10);
    const by: Record<string, number> = {};
    for (const a of g.atoms) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual({ C: 3, H: 8 });
  });

  it('键长窗口：C–C 1.46–1.60Å、C–H 1.00–1.16Å（sp3 链几何）', () => {
    for (const [i, j] of g.bonds) {
      const a = g.atoms[i]!;
      const b = g.atoms[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (a.el === 'C' && b.el === 'C') {
        expect(d).toBeGreaterThan(1.46);
        expect(d).toBeLessThan(1.6);
      } else {
        expect(d).toBeGreaterThan(1.0);
        expect(d).toBeLessThan(1.16);
      }
    }
  });

  it('质心居中（buildMolecule 出口 centerAtoms，无偏心）', () => {
    const c = centroidOf(g.atoms);
    expect(Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)).toBeLessThan(1e-9);
  });

  it('单一真源：preset 与 smilesTo3D("CCC") 距离矩阵逐位一致', () => {
    const s = smilesTo3D('CCC');
    expect(s.atoms).toHaveLength(11);
    const raw = MOLECULES['C₃H₈'].atoms;
    for (let i = 0; i < 11; i++) {
      for (let j = i + 1; j < 11; j++) {
        const d1 = Math.hypot(raw[i]!.x - raw[j]!.x, raw[i]!.y - raw[j]!.y, raw[i]!.z - raw[j]!.z);
        const d2 = Math.hypot(s.atoms[i]!.x - s.atoms[j]!.x, s.atoms[i]!.y - s.atoms[j]!.y, s.atoms[i]!.z - s.atoms[j]!.z);
        expect(d1).toBeCloseTo(d2, 10);
      }
    }
  });

  it('确定性：两次构建逐位相同', () => {
    const g2 = buildMolecule('C₃H₈');
    for (const [i, a] of g.atoms.entries()) {
      expect(a.x).toBeCloseTo(g2.atoms[i]!.x, 12);
      expect(a.y).toBeCloseTo(g2.atoms[i]!.y, 12);
      expect(a.z).toBeCloseTo(g2.atoms[i]!.z, 12);
    }
  });
});
