import { describe, expect, it } from 'vitest';
import { ELEMENTS, getElement } from './elements';

/**
 * 元素数据不变量测试（T-1.1 首个单测，同时是 T-1.3 内核移植时的数据基线校验）
 */
describe('ELEMENTS 元素显示数据库', () => {
  it('覆盖黏土矿物与配套场景所需元素', () => {
    const required = ['H', 'O', 'Al', 'Si', 'Ce', 'Ca', 'K', 'Fe', 'Mg', 'Na', 'Ti', 'C', 'N'];
    for (const sym of required) {
      expect(getElement(sym), `缺少元素 ${sym}`).toBeDefined();
    }
  });

  it('每条记录半径为正、vdw > cov、颜色为合法 hex', () => {
    for (const [sym, info] of Object.entries(ELEMENTS)) {
      expect(info.cov, `${sym} cov`).toBeGreaterThan(0);
      expect(info.vdw, `${sym} vdw`).toBeGreaterThan(info.cov);
      expect(info.color, `${sym} color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(info.name.length, `${sym} name`).toBeGreaterThan(0);
    }
  });

  it('未知元素返回 undefined（渲染层回退色的依据）', () => {
    expect(getElement('Xx')).toBeUndefined();
  });
});

/**
 * 2026-09-11 扩全周期表（修复"搜索部分化学元素识别不出来"）：
 * 守护 118 种齐全 + 原有 34 项基线逐字不变（已有场景显示零回归）。
 */
describe('ELEMENTS 全周期表（2026-09-11）', () => {
  /** 扩表前的 33 项基线（快照锁定，任何改动都是回归） */
  const BASELINE_34: Record<string, { name: string; cov: number; vdw: number; color: string }> = {
    H: { name: '氢', cov: 0.31, vdw: 1.2, color: '#ECECEC' },
    C: { name: '碳', cov: 0.76, vdw: 1.7, color: '#4B4B55' },
    N: { name: '氮', cov: 0.71, vdw: 1.55, color: '#3F66C4' },
    O: { name: '氧', cov: 0.66, vdw: 1.52, color: '#D64550' },
    Na: { name: '钠', cov: 1.66, vdw: 2.27, color: '#E8A33D' },
    Mg: { name: '镁', cov: 1.41, vdw: 1.73, color: '#7FA96B' },
    Al: { name: '铝', cov: 1.21, vdw: 1.84, color: '#C9A2A2' },
    Si: { name: '硅', cov: 1.11, vdw: 2.1, color: '#E2C47E' },
    K: { name: '钾', cov: 2.03, vdw: 2.75, color: '#8E6FB8' },
    Ca: { name: '钙', cov: 1.76, vdw: 2.31, color: '#93B3A5' },
    Ti: { name: '钛', cov: 1.6, vdw: 2.11, color: '#B7C0CA' },
    Fe: { name: '铁', cov: 1.32, vdw: 2.04, color: '#C4744F' },
    Ce: { name: '铈', cov: 1.86, vdw: 2.4, color: '#C77E8E' },
    Zn: { name: '锌', cov: 1.22, vdw: 1.39, color: '#9BA8B5' },
    S: { name: '硫', cov: 1.05, vdw: 1.8, color: '#D9B23A' },
    P: { name: '磷', cov: 1.07, vdw: 1.8, color: '#D97E4A' },
    F: { name: '氟', cov: 0.57, vdw: 1.47, color: '#9FC7A8' },
    Cl: { name: '氯', cov: 1.02, vdw: 1.75, color: '#7FBF7F' },
    Br: { name: '溴', cov: 1.2, vdw: 1.85, color: '#A0674B' },
    I: { name: '碘', cov: 1.39, vdw: 1.98, color: '#8A6FA8' },
    Li: { name: '锂', cov: 1.28, vdw: 1.82, color: '#CC8080' },
    B: { name: '硼', cov: 0.84, vdw: 1.92, color: '#E5AF9F' },
    V: { name: '钒', cov: 1.34, vdw: 2.02, color: '#A08FE0' },
    Cr: { name: '铬', cov: 1.39, vdw: 2.05, color: '#8A99C7' },
    Mn: { name: '锰', cov: 1.39, vdw: 2.05, color: '#9C7AC7' },
    Co: { name: '钴', cov: 1.26, vdw: 2.0, color: '#D98BA0' },
    Ni: { name: '镍', cov: 1.24, vdw: 1.63, color: '#7FBFA0' },
    Cu: { name: '铜', cov: 1.32, vdw: 1.96, color: '#C77E4A' },
    Zr: { name: '锆', cov: 1.75, vdw: 2.36, color: '#8FBFC9' },
    Mo: { name: '钼', cov: 1.54, vdw: 2.17, color: '#7FAFD0' },
    Ag: { name: '银', cov: 1.45, vdw: 2.11, color: '#C8C8D0' },
    Sn: { name: '锡', cov: 1.46, vdw: 2.3, color: '#C8B0A0' },
    Ba: { name: '钡', cov: 2.15, vdw: 2.68, color: '#8FC98F' },
  };

  /** 周期表 1–118 全符号（按原子序数） */
  const ALL_118 = new Set([
    'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
    'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
    'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
    'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
    'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
    'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
    'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
    'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
    'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
    'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
    'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
  ]);

  it('118 种齐全：周期表符号逐一在库、无多余键', () => {
    expect(Object.keys(ELEMENTS)).toHaveLength(118);
    for (const el of ALL_118) expect(ELEMENTS[el], `缺少 ${el}`).toBeDefined();
    for (const k of Object.keys(ELEMENTS)) expect(ALL_118.has(k), `多余键 ${k}`).toBe(true);
  });

  it('新增元素数据完整（用户报告的高频搜索元素抽样）', () => {
    expect(ELEMENTS.Au).toMatchObject({ name: '金' });
    expect(ELEMENTS.Pt).toMatchObject({ name: '铂' });
    expect(ELEMENTS.W).toMatchObject({ name: '钨' });
    expect(ELEMENTS.Pd).toMatchObject({ name: '钯' });
    expect(ELEMENTS.La).toMatchObject({ name: '镧' });
    expect(ELEMENTS.Nd).toMatchObject({ name: '钕' });
    expect(ELEMENTS.Ga).toMatchObject({ name: '镓' });
    expect(ELEMENTS.Ge).toMatchObject({ name: '锗' });
    expect(ELEMENTS.Sr).toMatchObject({ name: '锶' });
    expect(ELEMENTS.Pb).toMatchObject({ name: '铅' });
    expect(ELEMENTS.Bi).toMatchObject({ name: '铋' });
    expect(ELEMENTS.U).toMatchObject({ name: '铀' });
  });

  it('原有 33 项基线数据逐字不变（显示零回归）', () => {
    expect(Object.keys(BASELINE_34)).toHaveLength(33);
    for (const [el, base] of Object.entries(BASELINE_34)) {
      expect(ELEMENTS[el], `${el} 不应被改动或移除`).toEqual(base);
    }
  });
});
