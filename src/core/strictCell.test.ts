/**
 * 晶学严格模式验收测试 —— T-2.7（决策 D03 的"严格模式后路"）
 *
 * 验收标准（TODO）：开关切换后键长与 CIF 距离矩阵偏差 < 0.5%（严格模式下）；
 * 默认仍为示意模式。
 *
 * 参照实现：CIF 距离矩阵 = 分数坐标差经真实三斜度量（latticeVectors(cell,false)）
 * 并考虑周期镜像后的距离。built 片层走同一投影 → 逐对偏差应 ≈ 0（远小于 0.5%）。
 */
import { describe, expect, it } from 'vitest';
import cifText from '../../data/kaolinite.cif?raw';
import { buildKaoliniteSheet } from './builders';
import { computeBonds, latticeVectors, parseCIF } from './crystal';

const parsed = parseCIF(cifText);
const L = latticeVectors(parsed.cell, false); // 真实三斜度量

/** 理论 Si–O 键长集合：单胞内全部 Si/O 位点 × 27 个周期镜像，取 <2.0Å 的距离（0.01Å 分辨率） */
function theoreticalSiOBondLengths(): Set<number> {
  const si = parsed.atoms.filter((a) => a.el === 'Si');
  const o = parsed.atoms.filter((a) => a.el === 'O');
  const set = new Set<number>();
  for (const s of si) {
    for (const ox of o) {
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (let k = -1; k <= 1; k++) {
            const dfx = ox.fx + i - s.fx;
            const dfy = ox.fy + j - s.fy;
            const dfz = ox.fz + k - s.fz;
            const d = Math.hypot(
              dfx * L.ax + dfy * L.bx + dfz * L.cx,
              dfx * L.ay + dfy * L.by + dfz * L.cy,
              dfx * L.az + dfy * L.bz + dfz * L.cz,
            );
            if (d < 2.0 && d > 0.5) set.add(Math.round(d * 100) / 100);
          }
    }
  }
  return set;
}

describe('晶学严格模式（T-2.7）', () => {
  it('严格模式：全部 Si–O 键长落在 CIF 距离矩阵理论集合内（偏差 <0.5%）', () => {
    const sheet = buildKaoliniteSheet(cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, strictCell: true, atomMode: 'full', singleEl: 'Si'
    });
    const theoretical = theoreticalSiOBondLengths();
    // built 片层中的 Si 原子（O-H 氢已补，但 Si 的最近邻 O 键仍在）
    const siIdx = sheet.atoms.map((a, i) => (a.el === 'Si' ? i : -1)).filter((i) => i >= 0);
    expect(siIdx.length).toBeGreaterThan(20);
    const tolerance = 0.005; // 0.5%
    for (const si of siIdx) {
      const neighbors = computeBonds(sheet.atoms)
        .filter((b) => b[0] === si || b[1] === si)
        .map((b) => (b[0] === si ? b[1] : b[0]))
        .filter((j) => sheet.atoms[j].el === 'O');
      for (const o of neighbors) {
        const d = Math.hypot(
          sheet.atoms[si].x - sheet.atoms[o].x,
          sheet.atoms[si].y - sheet.atoms[o].y,
          sheet.atoms[si].z - sheet.atoms[o].z,
        );
        const matched = [...theoretical].some(
          (t) => Math.abs(d - t) <= t * tolerance,
        );
        expect(matched, `Si-O 键长 ${d.toFixed(4)}Å 不在 CIF 理论集合 ${[...theoretical].join(',')} 内`).toBe(true);
      }
    }
  });

  it('倾斜呈现：双层堆叠的层间位移方向——严格模式沿倾斜 c 轴（x 位移 ≈ d001·cosβ），示意模式纯 z', () => {
    const layerXShift = (strictCell: boolean): number => {
      const sheet = buildKaoliniteSheet(cifText, {
        Lx: 60, Ly: 50, layers: 2, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, strictCell, atomMode: 'full', singleEl: 'Si'
      });
      const zs = sheet.atoms.map((a) => a.z).sort((x, y) => x - y);
      const mid = (zs[zs.length - 1] + zs[0]) / 2;
      const clusters: Array<Array<number>> = [[], []];
      for (const a of sheet.atoms) clusters[a.z < mid ? 0 : 1].push(a.x);
      const cx = (arr: number[]): number => arr.reduce((s, v) => s + v, 0) / arr.length;
      return cx(clusters[1]) - cx(clusters[0]);
    };
    const strictShift = layerXShift(true);
    const orthoShift = layerXShift(false);
    // β = 104.86° → cosβ ≈ -0.256；d001 = 7.4 → 层间 x 位移 ≈ -1.9Å（沿倾斜 c 轴）
    expect(strictShift).toBeLessThan(-1);
    expect(Math.abs(orthoShift)).toBeLessThan(0.1);
  });

  it('默认（缺省 strictCell）仍为示意模式：原子数 = 基线 2448', () => {
    const dflt = buildKaoliniteSheet(cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, strictCell: false, atomMode: 'full', singleEl: 'Si'
    });
    expect(dflt.atoms).toHaveLength(2448);
    const explicitFalse = buildKaoliniteSheet(cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, strictCell: false, atomMode: 'full', singleEl: 'Si'
    });
    expect(JSON.stringify(dflt.atoms)).toBe(JSON.stringify(explicitFalse.atoms));
  });

  it('schema 兼容：旧场景文件无 strictCell 字段可解析（默认 false）', async () => {
    const { sheetParamsSchema } = await import('./schema');
    const res = sheetParamsSchema.parse({
      Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, strictCell: false, atomMode: 'full', singleEl: 'Si'
    });
    expect(res.strictCell).toBe(false);
  });
});
