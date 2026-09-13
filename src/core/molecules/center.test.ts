import { describe, expect, it } from 'vitest';
import { buildMolecule } from '../builders';
import { centerAtoms } from './center';
import { formulaTo3D } from './formula';
import { smilesTo3D } from './smiles';

/** 分子几何居中回归（2026-09-13）：所有分子构建出口质心 = 原点（拖拽/对齐不偏心） */
const centroidOf = (atoms: Array<{ x: number; y: number; z: number }>) => {
  const n = atoms.length || 1;
  return atoms.reduce(
    (acc, a) => ({ x: acc.x + a.x / n, y: acc.y + a.y / n, z: acc.z + a.z / n }),
    { x: 0, y: 0, z: 0 },
  );
};

describe('centerAtoms', () => {
  it('平移集合到质心为原点，单原子/空集不动', () => {
    const moved = centerAtoms([
      { x: 10, y: 0, z: 0 },
      { x: 12, y: 0, z: 0 },
    ]);
    expect(moved.map((a) => a.x)).toEqual([-1, 1]);
    const single = [{ x: 5, y: 5, z: 5 }];
    expect(centerAtoms(single)).toEqual(single);
    expect(centerAtoms([])).toEqual([]);
  });

  it('不改入参（返回新数组）', () => {
    const src = [{ x: 3, y: 0, z: 0 }];
    centerAtoms(src);
    expect(src[0]!.x).toBe(3);
  });
});

describe('分子构建出口质心 = 原点', () => {
  it('SMILES：甲苯 / 乙醇 / 苯', () => {
    for (const s of ['Cc1ccccc1', 'CCO', 'c1ccccc1']) {
      const c = centroidOf(smilesTo3D(s).atoms);
      expect(Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)).toBeLessThan(1e-9);
    }
  });

  it('化学式：CO / H2O / PtCl4', () => {
    for (const f of ['CO', 'H2O', 'PtCl4']) {
      const c = centroidOf(formulaTo3D(f).atoms);
      expect(Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)).toBeLessThan(1e-9);
    }
  });

  it('预设分子表：全部 kind', () => {
    for (const kind of ['H₂O', 'CO₂', 'O₂', 'N₂', '·OH (羟基自由基)'] as const) {
      const c = centroidOf(buildMolecule(kind).atoms);
      expect(Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)).toBeLessThan(1e-9);
    }
  });
});
