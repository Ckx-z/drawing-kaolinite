/**
 * 甲苯（C₇H₈ preset）验收测试 —— 2026-09-17
 *
 * 数据源：PubChem CID 1140 3D 构象（MMFF94 力场优化，OEChem 生成），
 * 坐标逐位转录进 builders.MOLELECULES['C₇H₈']，源文件存档 data/toluene.sdf。
 * 与水分子修复（2026-09-18 canonical 注册表）同一设计不变量：
 * 搜索词只解析身份（别名/化学式 → kind 'C₇H₈'），几何唯一来自 preset。
 *
 * 覆盖：中英文/缩写/化学式多路搜索、非别名防御、组成与键数、
 * 分键型键长窗口（芳 C–C / 环–CH₃ / C–H）、苯环共面、质心居中、
 * preset 与 SMILES 双路并存互不干扰。
 */
import { describe, expect, it } from 'vitest';
import { buildMolecule, MOLECULES } from '../builders';
import { resolveCanonicalFormula, resolveMoleculeQuery } from './registry';
import { moleculeParamsSchema } from '../schema';
import { smilesTo3D } from './smiles';

const centroidOf = (atoms: Array<{ x: number; y: number; z: number }>) => {
  const n = atoms.length || 1;
  return atoms.reduce(
    (acc, a) => ({ x: acc.x + a.x / n, y: acc.y + a.y / n, z: acc.z + a.z / n }),
    { x: 0, y: 0, z: 0 },
  );
};

const g = buildMolecule('C₇H₈');
const dist = (i: number, j: number): number => {
  const a = g.atoms[i]!;
  const b = g.atoms[j]!;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
};

// 键型分组（与 builders.MOLECULES['C₇H₈'] 键表对应：0–6 = C，3 为 CH₃ 碳）
const RING_CC: Array<[number, number]> = [[0, 1], [0, 2], [1, 4], [2, 5], [4, 6], [5, 6]];
const RING_ME = 0; // 键 [0,3]：苯环 C – CH₃
const AROM_CH: Array<[number, number]> = [[1, 7], [2, 8], [4, 12], [5, 13], [6, 14]];
const ME_CH: Array<[number, number]> = [[3, 9], [3, 10], [3, 11]];

describe('甲苯搜索别名（canonical 注册表）', () => {
  it('中文名/别名/英文/缩写/大小写多路命中 C₇H₈', () => {
    for (const q of ['甲苯', '甲基苯', 'toluene', 'Toluene', 'TOLUENE', 'TOL', 'tol', 'methylbenzene', 'Methylbenzene', 'C7H8']) {
      expect(resolveMoleculeQuery(q), `"${q}" 应命中甲苯`).toBe('C₇H₈');
    }
  });

  it('化学式升级：C7H8 / C₇H₈ / c7h8 → preset；近似式不误吞', () => {
    expect(resolveCanonicalFormula('C7H8')).toBe('C₇H₈');
    expect(resolveCanonicalFormula('C₇H₈')).toBe('C₇H₈');
    expect(resolveCanonicalFormula('c7h8')).toBe('C₇H₈');
    for (const f of ['C7H8O', 'C6H6', 'C7H8N', 'CH3C6H5', 'C7H10']) {
      expect(resolveCanonicalFormula(f), `"${f}" 不应命中 preset`).toBeNull();
    }
  });

  it('查询防御：前缀/近形词不误吞（纯字母小写化后精确匹配）', () => {
    for (const q of ['tolu', 'toluen', '甲苯酚', 'toluene2', 'xylene', '苯']) {
      expect(resolveMoleculeQuery(q), `"${q}" 不应命中`).toBeNull();
    }
  });

  it('schema：kind C₇H₈ 合法，旧七种 kind 枚举不受影响', () => {
    expect(moleculeParamsSchema.parse({ kind: 'C₇H₈' }).kind).toBe('C₇H₈');
    expect(moleculeParamsSchema.parse({ kind: 'H₂O' }).kind).toBe('H₂O');
  });
});

describe('甲苯 preset 几何（PubChem CID 1140 转录锁定）', () => {
  it('15 原子（C7H8）15 键', () => {
    expect(g.atoms).toHaveLength(15);
    expect(g.bonds).toHaveLength(15);
    const by: Record<string, number> = {};
    for (const a of g.atoms) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual({ C: 7, H: 8 });
  });

  it('芳 C–C 1.36–1.42Å（MMFF94 芳环键长）', () => {
    for (const [i, j] of RING_CC) {
      const d = dist(i, j);
      expect(d, `键 ${i}-${j}`).toBeGreaterThan(1.36);
      expect(d, `键 ${i}-${j}`).toBeLessThan(1.42);
    }
  });

  it('苯环–CH₃ 1.47–1.53Å', () => {
    const d = dist(RING_ME, 3);
    expect(d).toBeGreaterThan(1.47);
    expect(d).toBeLessThan(1.53);
  });

  it('C–H 键 1.04–1.12Å（芳氢与甲基氢同窗口）', () => {
    for (const [i, j] of [...AROM_CH, ...ME_CH]) {
      const d = dist(i, j);
      expect(d, `键 ${i}-${j}`).toBeGreaterThan(1.04);
      expect(d, `键 ${i}-${j}`).toBeLessThan(1.12);
    }
  });

  it('苯环 6 碳共面（任三点法平面，其余偏离 < 0.01Å）', () => {
    const ring = [0, 1, 2, 4, 5, 6].map((i) => g.atoms[i]!);
    const [p0, p1, p2] = ring;
    const u = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
    const v = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z };
    const n = {
      x: u.y * v.z - u.z * v.y,
      y: u.z * v.x - u.x * v.z,
      z: u.x * v.y - u.y * v.x,
    };
    const L = Math.hypot(n.x, n.y, n.z) || 1;
    for (const p of ring.slice(3)) {
      const dev = Math.abs(((p.x - p0.x) * n.x + (p.y - p0.y) * n.y + (p.z - p0.z) * n.z) / L);
      expect(dev).toBeLessThan(0.01);
    }
  });

  it('质心居中（buildMolecule 出口 centerAtoms）', () => {
    const c = centroidOf(g.atoms);
    expect(Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)).toBeLessThan(1e-9);
  });

  it('居中为纯平移：与 MOLECULES 表原始坐标的原子间距离逐位一致', () => {
    const raw = MOLECULES['C₇H₈'].atoms;
    for (const [i, j] of RING_CC) {
      const a = raw[i]!;
      const b = raw[j]!;
      const dRaw = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      expect(dist(i, j)).toBeCloseTo(dRaw, 12);
    }
  });

  it('确定性：两次构建几何逐位相同', () => {
    const g2 = buildMolecule('C₇H₈');
    for (let i = 0; i < g.atoms.length; i++) {
      expect(g.atoms[i]!.x).toBeCloseTo(g2.atoms[i]!.x, 12);
      expect(g.atoms[i]!.y).toBeCloseTo(g2.atoms[i]!.y, 12);
      expect(g.atoms[i]!.z).toBeCloseTo(g2.atoms[i]!.z, 12);
    }
  });
});

describe('SMILES 双路并存（防御）', () => {
  it('Cc1ccccc1 仍走构象器：同组成但几何不同于 preset', () => {
    const s = smilesTo3D('Cc1ccccc1');
    expect(s.atoms).toHaveLength(15);
    const by: Record<string, number> = {};
    for (const a of s.atoms) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual({ C: 7, H: 8 });
    // 构象器（规则式）与 MMFF94 preset 必有可测差异（如环–CH₃ 键长）
    let maxDiff = 0;
    for (let i = 0; i < 15; i++) {
      for (let j = i + 1; j < 15; j++) {
        const da = g.atoms[i]!;
        const db = g.atoms[j]!;
        const sa = s.atoms[i]!;
        const sb = s.atoms[j]!;
        const d1 = Math.hypot(da.x - db.x, da.y - db.y, da.z - db.z);
        const d2 = Math.hypot(sa.x - sb.x, sa.y - sb.y, sa.z - sb.z);
        maxDiff = Math.max(maxDiff, Math.abs(d1 - d2));
      }
    }
    expect(maxDiff).toBeGreaterThan(0.02);
  });
});
