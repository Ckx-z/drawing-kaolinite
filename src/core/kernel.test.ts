import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHalloysiteTube, buildKaoliniteSheet, buildMolecule, buildParticle } from './builders';
import { expandSymmetry, parseCIF } from './crystal';

/**
 * T-1.3 内核移植回归测试 —— 断言数值 = T-0.1 基线（demo/core/test.js 实测）。
 * 这些数字必须逐位复现：任何偏差都说明移植改变了逻辑。
 */
const CIF = readFileSync(new URL('../../data/kaolinite.cif', import.meta.url), 'utf8');

describe('CIF 解析与对称展开（Bish & Von Dreele 1989, AMCSD 0012232）', () => {
  const parsed = parseCIF(CIF);

  it('晶胞参数与位点数', () => {
    expect(parsed.cell.a).toBeCloseTo(5.1554, 4);
    expect(parsed.cell.b).toBeCloseTo(8.9448, 4);
    expect(parsed.cell.c).toBeCloseTo(7.4048, 4);
    expect(parsed.cell.beta).toBeCloseTo(104.862, 3);
    expect(parsed.symops).toEqual(['x,y,z', '1/2+x,1/2+y,z']);
    expect(parsed.atoms).toHaveLength(13);
  });

  it('对称展开 = 26 原子/晶胞（Al4Si4O18 化学计量）', () => {
    const expanded = expandSymmetry(parsed.atoms, parsed.symops);
    expect(expanded).toHaveLength(26);
    const byEl = expanded.reduce<Record<string, number>>((acc, a) => {
      acc[a.el] = (acc[a.el] ?? 0) + 1;
      return acc;
    }, {});
    expect(byEl).toEqual({ Al: 4, Si: 4, O: 18 });
  });
});

describe('片层切片（基线：60×50Å 单层 = 2448 原子 / 3372 键）', () => {
  it('矩形 60×50 单层', () => {
    const sheet = buildKaoliniteSheet(CIF, {
      Lx: 60,
      Ly: 50,
      layers: 1,
      d001: 7.4,
      shape: '矩形',
      style: '空间填充',
      edgeH: false,
    });
    expect(sheet.atoms).toHaveLength(2448);
    expect(sheet.bonds).toHaveLength(3372);
  });

  it('六角 70×70 + 边缘饱和（基线 2597/3514）', () => {
    const hex = buildKaoliniteSheet(CIF, {
      Lx: 70,
      Ly: 70,
      layers: 1,
      d001: 7.4,
      shape: '六角',
      style: '空间填充',
      edgeH: true,
    });
    expect(hex.atoms).toHaveLength(2597);
    expect(hex.bonds).toHaveLength(3514);
  });

  it('三层堆叠层数生效（原子数 ≈ 3× 单层）', () => {
    const tri = buildKaoliniteSheet(CIF, {
      Lx: 60,
      Ly: 50,
      layers: 3,
      d001: 10,
      shape: '矩形',
      style: '空间填充',
      edgeH: false,
    });
    // 3 层共享同一 na×nb 骨架：层内原子 3×，羟基氢 3×
    expect(tri.atoms.length).toBeGreaterThan(2448 * 2);
  });
});

describe('卷曲成管（基线：闭合 7259 键 > 60% 半卷 6930 键，开口端自动断键）', () => {
  const TUBE_PARAMS = { innerR: 14, length: 60, walls: 1, d001: 7.4, progress: 1, taperDeg: 0, style: '空间填充' } as const;

  it('闭合管原子与键数', () => {
    const tube = buildHalloysiteTube(CIF, TUBE_PARAMS);
    expect(tube.atoms).toHaveLength(4991);
    expect(tube.bonds).toHaveLength(7259);
  });

  it('60% 卷曲键数少于闭合管（断键机制生效）', () => {
    const arc = buildHalloysiteTube(CIF, { ...TUBE_PARAMS, progress: 0.6 });
    expect(arc.atoms).toHaveLength(4991);
    expect(arc.bonds).toHaveLength(6930);
    expect(arc.bonds.length).toBeLessThan(7259);
  });

  it('管半径校验（基线：绕 z=14 平面量测 内壁≈11.4 / 外壁≈23.2）', () => {
    const tube = buildHalloysiteTube(CIF, TUBE_PARAMS);
    let rmin = 1e9;
    let rmax = -1e9;
    for (const a of tube.atoms) {
      const r = Math.hypot(a.x, a.z - 14); // 与 demo 基线同口径（管轴 ∥ y）
      if (r < rmin) rmin = r;
      if (r > rmax) rmax = r;
    }
    expect(rmin).toBeGreaterThan(10.9);
    expect(rmin).toBeLessThan(11.9);
    expect(rmax).toBeGreaterThan(22.7);
    expect(rmax).toBeLessThan(23.7);
  });

  it('双层壁（d001=10 水合）原子数显著大于单层', () => {
    const wall2 = buildHalloysiteTube(CIF, { ...TUBE_PARAMS, walls: 2, d001: 10, length: 100 });
    expect(wall2.atoms.length).toBeGreaterThan(10000);
  });
});

describe('颗粒与分子', () => {
  it('簇装颗粒（基线：radius9 grains150 seed7 = 217 原子）', () => {
    const part = buildParticle({ radius: 9, grains: 150, seed: 7, mode: '簇装' });
    expect(part.atoms).toHaveLength(217);
    expect(part.bonds).toHaveLength(0);
  });

  it('同种子同颗粒形（确定性复现，模块复用的保证）', () => {
    const a = buildParticle({ radius: 9, grains: 150, seed: 7, mode: '簇装' });
    const b = buildParticle({ radius: 9, grains: 150, seed: 7, mode: '簇装' });
    expect(b).toEqual(a);
  });

  it('H₂O：3 原子 2 键', () => {
    const mol = buildMolecule('H₂O');
    expect(mol.atoms).toHaveLength(3);
    expect(mol.bonds).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });
});
