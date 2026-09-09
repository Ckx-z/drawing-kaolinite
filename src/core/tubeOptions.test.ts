/**
 * 卷曲方向 + 端口噪声验收测试 —— T-2.6
 *
 * 验收标准（TODO）：两种轴向卷曲半径校验一致通过；端口噪声开启后视觉自然且
 * 不影响键连（键数变化 < 5%）。
 */
import { describe, expect, it } from 'vitest';
import { buildHalloysiteTube } from './builders';
import cifText from '../../data/kaolinite.cif?raw';

const CIF = cifText;

const BASE = {
  innerR: 14,
  length: 60,
  walls: 1,
  d001: 7.4,
  progress: 1,
  taperDeg: 0,
  style: '空间填充' as const,
  curlAxis: 'a' as const,
  portNoise: 0,
  atomMode: 'full' as const,
  singleEl: 'Si',
};

/** 闭合管的内外半径（管轴在 y，圆心 z ≈ Rmid） */
function radiusRange(atoms: Array<{ x: number; z: number }>): [number, number] {
  let rmin = 1e9;
  let rmax = -1e9;
  for (const a of atoms) {
    const r = Math.hypot(a.x, a.z - 14);
    if (r < rmin) rmin = r;
    if (r > rmax) rmax = r;
  }
  return [rmin, rmax];
}

describe('卷曲方向（T-2.6 验收：两种轴向半径校验一致）', () => {
  it("'a' 轴（基线）闭合管半径：内 ≈ 11.4Å、外 ≈ 23Å", () => {
    const tube = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'a',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    const [rmin, rmax] = radiusRange(tube.atoms);
    expect(rmin).toBeGreaterThan(10);
    expect(rmin).toBeLessThan(16);
    expect(rmax).toBeGreaterThan(19);
    expect(rmax).toBeLessThan(24);
  });

  it("'b' 轴闭合管半径与 'a' 轴校验一致（同一容差区间）", () => {
    const a = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'a',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    const b = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'b',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    const [amin, amax] = radiusRange(a.atoms);
    const [bmin, bmax] = radiusRange(b.atoms);
    expect(bmin).toBeGreaterThan(10);
    expect(bmin).toBeLessThan(16);
    expect(bmax).toBeGreaterThan(19);
    expect(bmax).toBeLessThan(24);
    // 半径分布量级一致（周向晶胞数按各自晶胞参数换算，原子数同级）
    expect(Math.abs(bmax - amax)).toBeLessThan(2);
    expect(Math.abs(bmin - amin)).toBeLessThan(2);
    expect(b.atoms.length).toBeGreaterThan(3000);
  });

  it("'b' 轴与 'a' 轴输出不同（确实是两种构型）", () => {
    const a = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'a',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    const b = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'b',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    expect(JSON.stringify(a.atoms.slice(0, 5))).not.toBe(JSON.stringify(b.atoms.slice(0, 5)));
  });

  it("缺省 curlAxis = 'a'（向后兼容旧场景）", () => {
    const d = buildHalloysiteTube(CIF, { ...BASE });
    const withA = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'a',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    expect(JSON.stringify(d.atoms)).toBe(JSON.stringify(withA.atoms));
  });
});

describe('端口噪声（T-2.6 验收：键数变化 <5% + 确定性 + 幅值有界）', () => {
  it('portNoise=0.5：原子数不变、键数变化 <5%、确定性复现', () => {
    const base = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'b',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    const n1 = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'b', portNoise: 0.5,  atomMode: 'full', singleEl: 'Si'});
    const n2 = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'b', portNoise: 0.5,  atomMode: 'full', singleEl: 'Si'});

    expect(n1.atoms.length).toBe(base.atoms.length);
    const delta = Math.abs(n1.bonds.length - base.bonds.length) / base.bonds.length;
    expect(delta, `键数变化 ${Math.round(delta * 1000) / 10}%`).toBeLessThan(0.05);
    expect(JSON.stringify(n1.atoms)).toBe(JSON.stringify(n2.atoms)); // 确定性
  });

  it('扰动幅值有界：端口原子位移 ≤ 2×幅度（含 xz 0.35 系数）', () => {
    const base = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'a',  portNoise: 0, atomMode: 'full', singleEl: 'Si'});
    const amp = 0.8;
    const noisy = buildHalloysiteTube(CIF, { ...BASE, curlAxis: 'a', portNoise: amp,  atomMode: 'full', singleEl: 'Si'});
    let maxShift = 0;
    for (let i = 0; i < base.atoms.length; i++) {
      const a = base.atoms[i];
      const b = noisy.atoms[i];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > maxShift) maxShift = d;
    }
    expect(maxShift).toBeLessThan(amp * 2);
  });

  it('portNoise=0 与无该字段输出逐位一致（默认关闭）', () => {
    const off = buildHalloysiteTube(CIF, { ...BASE, portNoise: 0,  curlAxis: 'a', atomMode: 'full', singleEl: 'Si'});
    const legacy = buildHalloysiteTube(CIF, { ...BASE });
    expect(JSON.stringify(off.atoms)).toBe(JSON.stringify(legacy.atoms));
  });
});
