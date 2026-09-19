/**
 * 球棍视觉半径规则验收 —— 2026-09-19b（修复 H 球过小）
 *
 * 规则：ballAndStick radius = max(cov × 0.42, 0.20Å)；bond r = 0.12Å。
 * H（cov 0.31 → 0.130）经下限抬到 0.20：H/bond ≈ 1.67——H 是"球"而非
 * 圆柱末端白帽子。真实元素数据/原子坐标/键长测量零触碰（存参数不存网格，
 * 渲染规则层变更，旧场景重开自动生效）。
 */
import { describe, expect, it } from 'vitest';
import { getElement } from '../core/elements';
import { buildMolecule } from '../core/builders';
import {
  BALL_STICK_ATOM_SCALE,
  BALL_STICK_BOND_RADIUS,
  BALL_STICK_MIN_ATOM_RADIUS,
  SPACE_FILLING_VDW_SCALE,
  displayRadius,
} from './visualScale';

describe('球棍视觉半径规则（visualScale 单一事实源）', () => {
  it('H 球明显大于键圆柱：renderRadius(H) > bondRadius × 1.5', () => {
    expect(displayRadius('H', true)).toBeGreaterThan(BALL_STICK_BOND_RADIUS * 1.5); // 0.20 > 0.18
  });

  it('C 球仍明显大于 H 球（元素辨识层级 C > H > bond）', () => {
    expect(displayRadius('C', true)).toBeGreaterThan(displayRadius('H', true)); // 0.319 > 0.20
    expect(displayRadius('H', true)).toBeGreaterThan(BALL_STICK_BOND_RADIUS); // 0.20 > 0.12
  });

  it('H 使用最小视觉半径：renderRadius(H) ≈ BALL_STICK_MIN_ATOM_RADIUS', () => {
    expect(displayRadius('H', true)).toBeCloseTo(BALL_STICK_MIN_ATOM_RADIUS, 12); // max(0.130, 0.20)
  });

  it('C 不被下限钳制：renderRadius(C) ≈ cov(C) × 0.42', () => {
    const covC = getElement('C')!.cov;
    expect(displayRadius('C', true)).toBeCloseTo(covC * BALL_STICK_ATOM_SCALE, 12); // 0.3192
    // 矿物最小元素 O 同样不受钳制（cov 0.66 → 0.277 > 0.20）
    const covO = getElement('O')!.cov;
    expect(displayRadius('O', true)).toBeCloseTo(covO * BALL_STICK_ATOM_SCALE, 12);
    expect(displayRadius('O', true)).toBeGreaterThan(BALL_STICK_MIN_ATOM_RADIUS);
  });

  it('空间填充完全不受影响：spaceFillRadius(H) === vdw(H) × 0.92', () => {
    const vdwH = getElement('H')!.vdw;
    expect(displayRadius('H', false)).toBeCloseTo(vdwH * SPACE_FILLING_VDW_SCALE, 12);
    const vdwC = getElement('C')!.vdw;
    expect(displayRadius('C', false)).toBeCloseTo(vdwC * SPACE_FILLING_VDW_SCALE, 12);
  });

  it('化学真实数据零触碰：丙烷 C–H 中心距仍为数据库构象值（视觉半径不进几何）', () => {
    const g = buildMolecule('C₃H₈');
    const d = (i: number, j: number): number =>
      Math.hypot(g.atoms[i]!.x - g.atoms[j]!.x, g.atoms[i]!.y - g.atoms[j]!.y, g.atoms[i]!.z - g.atoms[j]!.z);
    // PubChem CID 6334 构象锁定值（propane.test 同源断言）
    expect(d(0, 3)).toBeCloseTo(1.0956, 3);
    expect(d(0, 1)).toBeCloseTo(1.5193, 3);
  });

  it('未知元素回退半径仍受下限保护（球棍）与 vdW 回退（空间填充）', () => {
    expect(displayRadius('Xx', true)).toBeCloseTo(Math.max(1 * BALL_STICK_ATOM_SCALE, BALL_STICK_MIN_ATOM_RADIUS), 12);
    expect(displayRadius('Xx', false)).toBeCloseTo(1.6 * SPACE_FILLING_VDW_SCALE, 12);
  });
});

describe('SVG 导出一致性', () => {
  it('SVG 与 3D 复用同一 displayRadius（baseRadiusFor 委托，无独立第二套半径）', async () => {
    // RendererService.baseRadiusFor 为模块私有函数，但其唯一实现是
    // displayRadius 的委托（同模块导入）；静态确认无第二处 cov/vdw 缩放散落
    const src = (await import('fs')).readFileSync(new URL('./RendererService.ts', import.meta.url), 'utf8');
    expect(src).toContain('return displayRadius(el, ballstick)');
    // 不再存在旧的散落实现（cov * 0.95 / vdw * 0.92 字面量）
    expect(src).not.toMatch(/cov \* 0\.95/);
    expect(src).not.toMatch(/vdw \* 0\.92/);
  });
});
