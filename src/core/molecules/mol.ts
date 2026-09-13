/**
 * MOL/SDF 分子文件导入（T-2.10，2026-09-13）：
 * MDL V2000 固定列格式——ChemDraw / Materials Studio / Gaussian / Avogadro
 * 等专业软件的通用导出格式。SDF = 多记录（$$$$ 分隔）+ 属性块，v1 取首条
 * 记录的分子（属性块忽略）。坐标直接采用文件中的 3D 构象（比 SMILES 规则式
 * 生成精确）；出口统一质心居中（centerAtoms）。
 *
 * 格式（V2000）：
 *   行1 标题（分子名） / 行2 备注 / 行3 程序信息
 *   行4 counts：原子数(0-3) 键数(3-6)
 *   原子块：x(0-10) y(10-20) z(20-30) 元素(31-34)
 *   键块：  首(0-3) 尾(3-6) 键级(6-9)
 *   （首行含 V3000 → 报"暂不支持"，给明确文案）
 */
import type { Atom, Bond } from '../geometry';
import { centerAtoms } from './center';

export class MolFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MolFormatError';
  }
}

/** 解析单条 V2000 MOL 记录（SDF 已切分后的块） */
export function parseMolV2000(text: string): { name: string; atoms: Atom[]; bonds: Bond[] } {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (lines.length < 4) throw new MolFormatError('MOL 文件不完整（不足 4 行头部）');
  const name = lines[0]!.trim();
  const counts = lines[3]!;
  if (counts.includes('V3000')) throw new MolFormatError('V3000 格式暂不支持，请在源软件中另存为 V2000');
  const nAtoms = parseInt(counts.slice(0, 3).trim(), 10);
  const nBonds = parseInt(counts.slice(3, 6).trim(), 10);
  if (!Number.isFinite(nAtoms) || nAtoms <= 0 || nAtoms > 1000) throw new MolFormatError(`原子数异常（${counts.slice(0, 6).trim()}）`);
  if (!Number.isFinite(nBonds) || nBonds < 0) throw new MolFormatError('键数异常');

  const atoms: Atom[] = [];
  for (let i = 0; i < nAtoms; i++) {
    const ln = lines[4 + i];
    if (!ln) throw new MolFormatError(`原子块第 ${i + 1} 行缺失`);
    const x = parseFloat(ln.slice(0, 10));
    const y = parseFloat(ln.slice(10, 20));
    const z = parseFloat(ln.slice(20, 30));
    const el = ln.slice(31, 34).trim();
    if (![x, y, z].every(Number.isFinite) || !el) throw new MolFormatError(`原子行格式错误："${ln.trim()}"`);
    atoms.push({ el: el[0]!.toUpperCase() + el.slice(1).toLowerCase(), x, y, z });
  }
  const bonds: Bond[] = [];
  for (let i = 0; i < nBonds; i++) {
    const ln = lines[4 + nAtoms + i];
    if (!ln) throw new MolFormatError(`键块第 ${i + 1} 行缺失`);
    const a = parseInt(ln.slice(0, 3).trim(), 10) - 1;
    const b = parseInt(ln.slice(3, 6).trim(), 10) - 1;
    if (!(a >= 0 && a < nAtoms && b >= 0 && b < nAtoms)) throw new MolFormatError(`键行原子越界："${ln.trim()}"`);
    bonds.push([a, b]);
  }
  return { name, atoms: centerAtoms(atoms), bonds };
}

/** SDF：按 $$$$: 切分取第一条分子记录（MOL 文件整文即单记录） */
export function parseSdfOrMol(text: string): { name: string; atoms: Atom[]; bonds: Bond[] } {
  if (text.trim().startsWith('$$$$')) throw new MolFormatError('SDF 首记录为空');
  const first = text.split(/^\$\$\$\$$/m)[0] ?? text;
  return parseMolV2000(first);
}

/** 文本疑似 MOL/SDF（导入入口预判：counts 行特征 + 4 行以上） */
export function looksLikeMolFile(text: string): boolean {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.length < 5) return false;
  const counts = lines[3] ?? '';
  // counts 行：两位数字开头（V2000）或含 V3000 标记
  return /^\s*\d{1,3}\s+\d{1,3}/.test(counts) || counts.includes('V3000');
}
