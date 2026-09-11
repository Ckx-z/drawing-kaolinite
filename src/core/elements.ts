/**
 * 元素显示数据库（类型化版本）
 * 数据与 demo/core/crystal.js 的 ELEMENTS 保持一致（T-1.3 移植时的数据基线）。
 * 字段含义见 DATA_DICT.md §九：cov 共价半径(Å) / vdw 范德华半径(Å) / color 期刊柔和配色(sRGB hex)
 *
 * 2026-09-11：扩到全周期表 118 种（修复"搜索部分化学元素识别不出来"——
 * 此前 parseFormula/smiles 方括号原子均以本表为合法性判据，缺项即无法导入）。
 * 原 34 项数值与颜色逐字保留（零回归）；新增项半径取 Cordero 2008（超重
 * 元素用预测值 vdw≈2.0），配色按 CPK/Jmol 惯例色系延续"期刊柔和"风格。
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
  /* ---------- 原有 34 项（基线数据，勿改动——回归测试逐项快照锁定） ---------- */
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

  /* ---------- 2026-09-11 全周期表补齐（半径 Cordero 2008；CPK 惯例柔和配色） ---------- */
  He: { name: '氦', cov: 0.28, vdw: 1.4, color: '#C4E8E8' },
  Ne: { name: '氖', cov: 0.58, vdw: 1.54, color: '#B3E3F5' },
  Ar: { name: '氩', cov: 1.06, vdw: 1.88, color: '#8FC9D6' },
  Kr: { name: '氪', cov: 1.16, vdw: 2.02, color: '#7AB2BC' },
  Xe: { name: '氙', cov: 1.4, vdw: 2.16, color: '#8BAB7A' },
  Rn: { name: '氡', cov: 1.5, vdw: 2.2, color: '#9AAC9E' },
  Be: { name: '铍', cov: 0.96, vdw: 1.53, color: '#A8C96B' },
  Sc: { name: '钪', cov: 1.7, vdw: 2.11, color: '#E8C79E' },
  Ga: { name: '镓', cov: 1.22, vdw: 1.87, color: '#C49595' },
  Ge: { name: '锗', cov: 1.2, vdw: 2.11, color: '#8A9E9E' },
  As: { name: '砷', cov: 1.19, vdw: 1.85, color: '#C2A0D0' },
  Se: { name: '硒', cov: 1.2, vdw: 1.9, color: '#E8B45A' },
  Rb: { name: '铷', cov: 2.2, vdw: 3.03, color: '#A07FBF' },
  Sr: { name: '锶', cov: 1.95, vdw: 2.49, color: '#8FCC8F' },
  Y: { name: '钇', cov: 1.9, vdw: 2.32, color: '#B4D8D8' },
  Nb: { name: '铌', cov: 1.64, vdw: 2.34, color: '#B79AB5' },
  Tc: { name: '锝', cov: 1.47, vdw: 2.39, color: '#84BFBF' },
  Ru: { name: '钌', cov: 1.46, vdw: 2.45, color: '#B48F9E' },
  Rh: { name: '铑', cov: 1.42, vdw: 2.44, color: '#C0A08A' },
  Pd: { name: '钯', cov: 1.39, vdw: 2.15, color: '#B8BFCA' },
  Cd: { name: '镉', cov: 1.44, vdw: 2.17, color: '#A8C4B8' },
  In: { name: '铟', cov: 1.42, vdw: 2.26, color: '#C09EC4' },
  Sb: { name: '锑', cov: 1.46, vdw: 2.06, color: '#9EB8C4' },
  Te: { name: '碲', cov: 1.38, vdw: 2.06, color: '#C4A86A' },
  Cs: { name: '铯', cov: 2.32, vdw: 3.43, color: '#B08FC0' },
  La: { name: '镧', cov: 2.07, vdw: 2.43, color: '#D0A8B4' },
  Pr: { name: '镨', cov: 2.03, vdw: 2.47, color: '#D2A8A2' },
  Nd: { name: '钕', cov: 2.01, vdw: 2.45, color: '#C9A4B8' },
  Pm: { name: '钷', cov: 1.99, vdw: 2.43, color: '#C9AABF' },
  Sm: { name: '钐', cov: 1.98, vdw: 2.42, color: '#CBAFC6' },
  Eu: { name: '铕', cov: 1.98, vdw: 2.42, color: '#D0B4C0' },
  Gd: { name: '钆', cov: 1.96, vdw: 2.38, color: '#D0AFC2' },
  Tb: { name: '铽', cov: 1.94, vdw: 2.34, color: '#C4A8C9' },
  Dy: { name: '镝', cov: 1.92, vdw: 2.31, color: '#BEA4C9' },
  Ho: { name: '钬', cov: 1.92, vdw: 2.3, color: '#C9AECB' },
  Er: { name: '铒', cov: 1.89, vdw: 2.29, color: '#C9B4D0' },
  Tm: { name: '铥', cov: 1.9, vdw: 2.27, color: '#B4A2C9' },
  Yb: { name: '镱', cov: 1.87, vdw: 2.26, color: '#C2B8CE' },
  Lu: { name: '镥', cov: 1.87, vdw: 2.24, color: '#B4AEC4' },
  Hf: { name: '铪', cov: 1.75, vdw: 2.23, color: '#9FB8C4' },
  Ta: { name: '钽', cov: 1.7, vdw: 2.22, color: '#A8BFCF' },
  W: { name: '钨', cov: 1.62, vdw: 2.18, color: '#8FA0B5' },
  Re: { name: '铼', cov: 1.51, vdw: 2.16, color: '#9EAEBC' },
  Os: { name: '锇', cov: 1.44, vdw: 2.16, color: '#9CB0C9' },
  Ir: { name: '铱', cov: 1.41, vdw: 2.02, color: '#A8B8C9' },
  Pt: { name: '铂', cov: 1.36, vdw: 2.09, color: '#C4C8CF' },
  Au: { name: '金', cov: 1.36, vdw: 2.14, color: '#D4B84A' },
  Hg: { name: '汞', cov: 1.32, vdw: 2.23, color: '#B8C4CC' },
  Tl: { name: '铊', cov: 1.45, vdw: 2.27, color: '#A89EC4' },
  Pb: { name: '铅', cov: 1.46, vdw: 2.38, color: '#8C8FA3' },
  Bi: { name: '铋', cov: 1.48, vdw: 2.39, color: '#9E8FC4' },
  Po: { name: '钋', cov: 1.4, vdw: 2.37, color: '#A89EB4' },
  At: { name: '砹', cov: 1.5, vdw: 2.4, color: '#9EABC0' },
  Fr: { name: '钫', cov: 2.6, vdw: 3.48, color: '#C2A8CC' },
  Ra: { name: '镭', cov: 2.21, vdw: 2.83, color: '#A8C0B4' },
  Ac: { name: '锕', cov: 2.15, vdw: 2.47, color: '#C4AE9E' },
  Th: { name: '钍', cov: 2.06, vdw: 2.45, color: '#CBBFA8' },
  Pa: { name: '镤', cov: 2.0, vdw: 2.43, color: '#BFB0A8' },
  U: { name: '铀', cov: 1.96, vdw: 2.41, color: '#C4B87A' },
  Np: { name: '镎', cov: 1.9, vdw: 2.39, color: '#B4B49E' },
  Pu: { name: '钚', cov: 1.87, vdw: 2.43, color: '#BFB0A8' },
  Am: { name: '镅', cov: 1.8, vdw: 2.44, color: '#B8AEA8' },
  Cm: { name: '锔', cov: 1.69, vdw: 2.45, color: '#B0AFAE' },
  Bk: { name: '锫', cov: 1.68, vdw: 2.44, color: '#ABAAB0' },
  Cf: { name: '锎', cov: 1.68, vdw: 2.45, color: '#A4A4B0' },
  Es: { name: '锿', cov: 1.65, vdw: 2.45, color: '#A0A2AC' },
  Fm: { name: '镄', cov: 1.67, vdw: 2.45, color: '#9EA6AC' },
  Md: { name: '钔', cov: 1.73, vdw: 2.46, color: '#A2A2A8' },
  No: { name: '锘', cov: 1.76, vdw: 2.46, color: '#A6A2A2' },
  Lr: { name: '铹', cov: 1.61, vdw: 2.46, color: '#9E9EA4' },
  Rf: { name: '𬬻', cov: 1.57, vdw: 2.0, color: '#98A8B4' },
  Db: { name: '𬭊', cov: 1.49, vdw: 2.0, color: '#9CA8AE' },
  Sg: { name: '𬭳', cov: 1.43, vdw: 2.0, color: '#9EAAB2' },
  Bh: { name: '𬭛', cov: 1.41, vdw: 2.0, color: '#9E9FAE' },
  Hs: { name: '𬭶', cov: 1.34, vdw: 2.0, color: '#98A0A8' },
  Mt: { name: '鿏', cov: 1.29, vdw: 2.0, color: '#9A9EA8' },
  Ds: { name: '𫟼', cov: 1.28, vdw: 2.0, color: '#949CA4' },
  Rg: { name: '𬬭', cov: 1.21, vdw: 2.0, color: '#96989E' },
  Cn: { name: '鿔', cov: 1.22, vdw: 2.0, color: '#8E929A' },
  Nh: { name: '鿭', cov: 1.36, vdw: 2.0, color: '#9AA6A0' },
  Fl: { name: '𫓧', cov: 1.43, vdw: 2.0, color: '#8E9A94' },
  Mc: { name: '镆', cov: 1.62, vdw: 2.0, color: '#94A09C' },
  Lv: { name: '𫟷', cov: 1.75, vdw: 2.0, color: '#8C9494' },
  Ts: { name: '鿬', cov: 1.65, vdw: 2.0, color: '#8E929E' },
  Og: { name: '鿫', cov: 1.57, vdw: 2.0, color: '#8A8E96' },
};

/** 按元素符号取显示数据；未知元素返回 undefined（渲染层需回退色） */
export function getElement(symbol: string): ElementInfo | undefined {
  return ELEMENTS[symbol];
}
