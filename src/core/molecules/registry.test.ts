import { describe, expect, it } from 'vitest';
import { buildMolecule } from '../builders';
import { centerAtoms } from './center';
import { formulaTo3D } from './formula';
import { normalizeSubscript, resolveCanonicalFormula, resolveMoleculeQuery } from './registry';
import { smilesTo3D } from './smiles';
import type { Atom } from '../geometry';

/** Canonical 分子注册表（2026-09-18）：别名统一 + 几何不变量 + 双路一致 */
const dist = (a: Atom, b: Atom): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleDeg = (a: Atom, v: Atom, c: Atom): number => {
  const d1 = [a.x - v.x, a.y - v.y, a.z - v.z];
  const d2 = [c.x - v.x, c.y - v.y, c.z - v.z];
  const cos = (d1[0]! * d2[0]! + d1[1]! * d2[1]! + d1[2]! * d2[2]!) / (Math.hypot(...d1) * Math.hypot(...d2));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
};

describe('H₂O 内置参考几何（Test 1-4）', () => {
  const g = buildMolecule('H₂O');
  const O = g.atoms.find((a) => a.el === 'O')!;
  const Hs = g.atoms.filter((a) => a.el === 'H');

  it('3 原子 = 1 O + 2 H；两条 O–H ≈ 0.96 Å；H–O–H ≈ 104.5°', () => {
    expect(g.atoms).toHaveLength(3);
    expect(Hs).toHaveLength(2);
    expect(dist(O, Hs[0]!)).toBeGreaterThan(0.94);
    expect(dist(O, Hs[0]!)).toBeLessThan(0.98);
    expect(dist(O, Hs[1]!)).toBeGreaterThan(0.94);
    expect(dist(O, Hs[1]!)).toBeLessThan(0.98);
    const ang = angleDeg(Hs[0]!, O, Hs[1]!);
    expect(ang).toBeGreaterThan(103.5);
    expect(ang).toBeLessThan(105.5);
  });

  it('质心居中不改变键长与键角（Test 5，几何不变量）', () => {
    const raw = [
      { el: 'O', x: 0, y: 0, z: 0 },
      { el: 'H', x: 0.759, y: 0.587, z: 0 },
      { el: 'H', x: -0.759, y: 0.587, z: 0 },
    ];
    const centered = centerAtoms(raw);
    const rO = raw[0]!, rH1 = raw[1]!, rH2 = raw[2]!;
    const cO = centered[0]!, cH1 = centered[1]!, cH2 = centered[2]!;
    expect(dist(cO, cH1)).toBeCloseTo(dist(rO, rH1), 12);
    expect(dist(cO, cH2)).toBeCloseTo(dist(rO, rH2), 12);
    expect(angleDeg(cH1, cO, cH2)).toBeCloseTo(angleDeg(rH1, rO, rH2), 10);
  });
});

describe('五别名统一（Test 6-10 + 几何一致性）', () => {
  const QUERIES = ['水', '水分子', 'H2O', 'H₂O', 'water', 'Water', 'h2o'];

  it('全部解析为 canonical H₂O', () => {
    for (const q of QUERIES) expect(resolveMoleculeQuery(q)).toBe('H₂O');
  });

  it('距离矩阵 fingerprint 一致（不同别名 → 同一套几何）', () => {
    const fp = (atoms: Atom[]): string[] => {
      const ds: number[] = [];
      for (let i = 0; i < atoms.length; i++)
        for (let j = i + 1; j < atoms.length; j++) ds.push(dist(atoms[i]!, atoms[j]!));
      return ds.map((d) => d.toFixed(6)).sort();
    };
    const ref = fp(buildMolecule('H₂O').atoms);
    for (const q of QUERIES) {
      const kind = resolveMoleculeQuery(q)!;
      expect(fp(buildMolecule(kind).atoms), `别名 ${q}`).toEqual(ref);
    }
  });

  it('非别名输入返回 null（不劫持 SMILES/化学式路径）', () => {
    for (const q of ['CCO', 'PtCl4', 'Fe2O3', '[Pt4+]', 'Co2', '']) expect(resolveMoleculeQuery(q)).toBeNull(); // Co2=钴化学式，不劫持
  });
});

describe('化学式 → canonical 升级（worker/fallback 共用）', () => {
  it('H2O/H₂O/CO2/N2/O2 → 对应 preset；无 preset → null（继续团簇）', () => {
    expect(resolveCanonicalFormula('H2O')).toBe('H₂O');
    expect(resolveCanonicalFormula('H₂O')).toBe('H₂O');
    expect(resolveCanonicalFormula('CO2')).toBe('CO₂');
    expect(resolveCanonicalFormula('N2')).toBe('N₂');
    expect(resolveCanonicalFormula('O2')).toBe('O₂');
    for (const f of ['PtCl4', 'Fe2O3', 'CH4', 'Co2']) expect(resolveCanonicalFormula(f)).toBeNull(); // Co2=钴，不吞为 CO₂
  });

  it('升级前后几何对比：团簇 H2O 角度偏离参考值，preset 为 104.5°', () => {
    const cluster = formulaTo3D('H2O'); // 未升级路径（无 preset 分子的现状）
    const cO = cluster.atoms.find((a) => a.el === 'O')!;
    const cHs = cluster.atoms.filter((a) => a.el === 'H');
    const clusterAngle = angleDeg(cHs[0]!, cO, cHs[1]!);
    const g = buildMolecule('H₂O');
    const presetAngle = angleDeg(g.atoms[1]!, g.atoms[0]!, g.atoms[2]!);
    // 团簇是示意几何（角度由吸附位决定，非 104.5°）——这正是本 Bug 的根因证据
    expect(Math.abs(clusterAngle - 104.5)).toBeGreaterThan(2);
    expect(Math.abs(presetAngle - 104.5)).toBeLessThan(1);
  });
});

describe('下标归一（不误伤大小写化学式路径）', () => {
  it('₂→2 等归一；Co2 不受影响（归一只用于别名键，不经化学式解析器）', () => {
    expect(normalizeSubscript('H₂O')).toBe('H2O');
    expect(normalizeSubscript('CO₂')).toBe('CO2');
    expect(normalizeSubscript('Fe₂O₃')).toBe('Fe2O3');
    expect(normalizeSubscript('Co2')).toBe('Co2'); // 原样（无下标）
    // 'Co2' 不是别名（别名表无此键）→ 不劫持
    expect(resolveMoleculeQuery('Co2')).toBeNull();
  });
});

describe('O₂ / CO₂ / N₂ 基础回归', () => {
  it('O₂/N₂ 双原子；CO₂ 三原子近 180°', () => {
    const o2 = buildMolecule('O₂');
    expect(o2.atoms).toHaveLength(2);
    expect(o2.atoms.every((a) => a.el === 'O')).toBe(true);
    const n2 = buildMolecule('N₂');
    expect(n2.atoms).toHaveLength(2);
    expect(n2.atoms.every((a) => a.el === 'N')).toBe(true);
    const co2 = buildMolecule('CO₂');
    const C = co2.atoms.find((a) => a.el === 'C')!;
    const Os = co2.atoms.filter((a) => a.el === 'O');
    expect(co2.atoms).toHaveLength(3);
    expect(angleDeg(Os[0]!, C, Os[1]!)).toBeGreaterThan(175);
  });
});

describe('SMILES / MOL 路径不受影响（防御）', () => {
  it('SMILES 入口照常（乙醇 9 原子）；团簇照常（PtCl4 5 原子）', () => {
    expect(smilesTo3D('CCO').atoms).toHaveLength(9);
    expect(formulaTo3D('PtCl4').atoms).toHaveLength(5);
  });
});
