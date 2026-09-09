/**
 * 元素显示数据库（类型化版本）
 * 数据与 demo/core/crystal.js 的 ELEMENTS 保持一致（T-1.3 移植时的数据基线）。
 * 字段含义见 DATA_DICT.md §九：cov 共价半径(Å) / vdw 范德华半径(Å) / color 期刊柔和配色(sRGB hex)
 */

export interface ElementInfo {
  /** 中文名 */
  name: string;
  /** 共价半径（键连判据用，Å） */
  cov: number;
  /** 范德华半径（空间填充显示半径 = vdw × 0.92，Å） */
  vdw: number;
  /** 显示颜色（sRGB hex） */
  color: string;
}

export const ELEMENTS: Readonly<Record<string, ElementInfo>> = {
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
  // 化学式导入（2026-09-08）补齐的常用元素；半径 Cordero 2008，配色延续期刊柔和系
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

/** 按元素符号取显示数据；未知元素返回 undefined（渲染层需回退色） */
export function getElement(symbol: string): ElementInfo | undefined {
  return ELEMENTS[symbol];
}
