/**
 * 丙烷内置 preset 验收 —— 2026-09-19 重写（官方 preset = 数据库真实构象）
 *
 * 数据源：PubChem CID 6334 3D conformer（MMFF94，OEChem 生成）逐位转录进
 * builders.MOLECULES['C₃H₈']，源文件存档 data/propane.sdf（下载经程序化校验：
 * 11 原子 3C+8H / 10 键 / 零重复坐标——本会话网络存在内容注入损坏，裸 curl 两连坏）。
 *
 * 双路语义（与甲苯 C₇H₈ 同模式，D-2026-09-19）：
 *   搜索「丙烷/propane/C3H8」→ preset 真实构象；输入 SMILES "CCC" → 构象器示意级。
 *
 * 覆盖任务书第六节：分子式/原子键计数/键长窗口/C-C-C 键角/四面体代表角/
 * 非键最小距/确定性/数据源独立性（preset ≠ smilesTo3D）。
 * 键角复用测量系统 angleDeg（measures.ts 单一实现，不复制第二套数学）。
 */
import { describe, expect, it } from 'vitest';
import { buildMolecule, MOLECULES } from '../builders';
import { smilesTo3D } from './smiles';
import { resolveCanonicalFormula, resolveMoleculeQuery } from './registry';
import { angleDeg } from '../measures';
import { moleculeParamsSchema } from '../schema';

const g = buildMolecule('C₃H₈');
const P = (i: number): [number, number, number] => [g.atoms[i]!.x, g.atoms[i]!.y, g.atoms[i]!.z];
const d = (i: number, j: number): number => Math.hypot(g.atoms[i]!.x - g.atoms[j]!.x, g.atoms[i]!.y - g.atoms[j]!.y, g.atoms[i]!.z - g.atoms[j]!.z);
const centroidOf = (atoms: Array<{ x: number; y: number; z: number }>) => {
  const n = atoms.length || 1;
  return atoms.reduce((acc, a) => ({ x: acc.x + a.x / n, y: acc.y + a.y / n, z: acc.z + a.z / n }), { x: 0, y: 0, z: 0 });
};

describe('丙烷搜索别名', () => {
  it('中文名/英文/大小写/化学式多路命中 C₃H₈；近似词不误吞', () => {
    for (const q of ['丙烷', 'propane', 'Propane', 'PROPANE', 'C3H8', 'C₃H₈']) {
      expect(resolveMoleculeQuery(q), `"${q}" 应命中丙烷`).toBe('C₃H₈');
    }
    expect(resolveCanonicalFormula('C3H8')).toBe('C₃H₈');
    expect(resolveCanonicalFormula('C₃H₈')).toBe('C₃H₈');
    expect(resolveCanonicalFormula('c3h8')).toBe('C₃H₈');
    for (const f of ['C3H8O', 'C3H6', 'C2H6']) expect(resolveCanonicalFormula(f)).toBeNull();
    for (const q of ['prop', 'propan', '丙酮']) expect(resolveMoleculeQuery(q)).toBeNull();
    expect(moleculeParamsSchema.parse({ kind: 'C₃H₈' }).kind).toBe('C₃H₈');
  });
});

describe('丙烷结构（PubChem CID 6334 真实构象锁定）', () => {
  it('分子式 C₃H₈：3 C + 8 H = 11 原子；2 C–C + 8 C–H = 10 键', () => {
    expect(g.atoms).toHaveLength(11);
    const by: Record<string, number> = {};
    for (const a of g.atoms) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual({ C: 3, H: 8 });
    expect(g.bonds).toHaveLength(10);
    let cc = 0;
    let ch = 0;
    for (const [i, j] of g.bonds) {
      const pair = [g.atoms[i]!.el, g.atoms[j]!.el].sort().join('');
      if (pair === 'CC') cc++;
      else if (pair === 'CH') ch++;
    }
    expect(cc).toBe(2);
    expect(ch).toBe(8);
  });

  it('C–C 键长 1.50–1.56Å（实测 ≈1.519，sp3 碳链）', () => {
    for (const [i, j] of g.bonds) {
      if (g.atoms[i]!.el === 'C' && g.atoms[j]!.el === 'C') {
        const len = d(i, j);
        expect(len).toBeGreaterThan(1.5);
        expect(len).toBeLessThan(1.56);
      }
    }
  });

  it('C–H 键长 1.06–1.12Å（实测 ≈1.095）', () => {
    for (const [i, j] of g.bonds) {
      const pair = [g.atoms[i]!.el, g.atoms[j]!.el].sort().join('');
      if (pair === 'CH') {
        const len = d(i, j);
        expect(len).toBeGreaterThan(1.06);
        expect(len).toBeLessThan(1.12);
      }
    }
  });

  it('C–C–C 骨架角 107°–115°（实测 111.7°，sp3；复用测量系统 angleDeg）', () => {
    // 原子 0 = 中心碳（键表 [0,1]/[0,2] 两条 C–C）
    expect(g.bonds.filter(([i, j]) => g.atoms[i]!.el === 'C' && g.atoms[j]!.el === 'C')).toEqual([[0, 1], [0, 2]]);
    const theta = angleDeg(P(1), P(0), P(2));
    expect(theta).toBeGreaterThan(107);
    expect(theta).toBeLessThan(115);
    expect(theta).toBeCloseTo(111.66, 1); // 数据库构象锁定（非理论 109.5 硬编码）
  });

  it('四面体代表角：CH₂ 的 H–C–H 107.3°、CH₃ 的 H–C–H 108.3°、C–C–H 109.4°（窗口 104–112）', () => {
    const hchCH2 = angleDeg(P(3), P(0), P(4)); // 中心碳两氢
    expect(hchCH2).toBeGreaterThan(104);
    expect(hchCH2).toBeLessThan(112);
    expect(hchCH2).toBeCloseTo(107.3, 1);
    const hchCH3 = angleDeg(P(5), P(1), P(6)); // 端碳两氢
    expect(hchCH3).toBeGreaterThan(104);
    expect(hchCH3).toBeLessThan(112);
    const cch = angleDeg(P(1), P(0), P(3)); // 中心碳：碳臂-氢臂
    expect(cch).toBeGreaterThan(104);
    expect(cch).toBeLessThan(112);
    expect(cch).toBeCloseTo(109.44, 1);
  });

  it('非键最小距离：H⋯H ≥ 1.6Å（无原子重叠/拥挤堆叠）', () => {
    let min = Infinity;
    for (let i = 0; i < 11; i++) {
      for (let j = i + 1; j < 11; j++) {
        if (g.bonds.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
        min = Math.min(min, d(i, j));
      }
    }
    expect(min).toBeGreaterThanOrEqual(1.6); // 实测 1.765
  });

  it('质心居中（出口 centerAtoms）+ 确定性（两次构建逐位相同）', () => {
    const c = centroidOf(g.atoms);
    expect(Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)).toBeLessThan(1e-9);
    const g2 = buildMolecule('C₃H₈');
    for (const [i, a] of g.atoms.entries()) {
      expect(a.x).toBeCloseTo(g2.atoms[i]!.x, 12);
      expect(a.y).toBeCloseTo(g2.atoms[i]!.y, 12);
      expect(a.z).toBeCloseTo(g2.atoms[i]!.z, 12);
    }
  });

  it('数据源独立性：官方 preset ≠ smilesTo3D("CCC") 示意构象（两路并存）', () => {
    const s = smilesTo3D('CCC');
    expect(s.atoms).toHaveLength(11); // SMILES 路线照常工作（组成相同）
    const raw = MOLECULES['C₃H₈'].atoms;
    let maxDiff = 0;
    for (let i = 0; i < 11; i++) {
      for (let j = i + 1; j < 11; j++) {
        const d1 = Math.hypot(raw[i]!.x - raw[j]!.x, raw[i]!.y - raw[j]!.y, raw[i]!.z - raw[j]!.z);
        const d2 = Math.hypot(s.atoms[i]!.x - s.atoms[j]!.x, s.atoms[i]!.y - s.atoms[j]!.y, s.atoms[i]!.z - s.atoms[j]!.z);
        maxDiff = Math.max(maxDiff, Math.abs(d1 - d2));
      }
    }
    expect(maxDiff).toBeGreaterThan(0.02); // 几何不同 → 数据源独立（此前自洽比较已按任务书移除）
  });
});
