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
};

/** 按元素符号取显示数据；未知元素返回 undefined（渲染层需回退色） */
export function getElement(symbol: string): ElementInfo | undefined {
  return ELEMENTS[symbol];
}
