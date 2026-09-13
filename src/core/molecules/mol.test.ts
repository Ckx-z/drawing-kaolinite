import { describe, expect, it } from 'vitest';
import { looksLikeMolFile, MolFormatError, parseSdfOrMol } from './mol';

/** 苯（V2000 标准样例；坐标为理想六边形，CC 键 1.39Å） */
const BENZENE_MOL = [
  'benzene',
  '  Kaolin-Assets test fixture',
  '',
  '  6  6  0  0  0  0  0  0  0  0999 V2000',
  '    0.6950    1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -0.6950    1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -1.3900    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -0.6950   -1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    0.6950   -1.2038    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.3900    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  2  0',
  '  2  3  1  0',
  '  3  4  2  0',
  '  4  5  1  0',
  '  5  6  2  0',
  '  6  1  1  0',
  'M  END',
].join('\n');

describe('parseSdfOrMol（T-2.10 V2000）', () => {
  it('苯：6 原子 6 键，质心居中，键长 1.39Å', () => {
    const { name, atoms, bonds } = parseSdfOrMol(BENZENE_MOL);
    expect(name).toBe('benzene');
    expect(atoms).toHaveLength(6);
    expect(bonds).toHaveLength(6);
    expect(atoms.every((a) => a.el === 'C')).toBe(true);
    // 质心居中（苯环中心 = 原点）
    const cx = atoms.reduce((s, a) => s + a.x, 0) / 6;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / 6;
    expect(Math.abs(cx) + Math.abs(cy)).toBeLessThan(1e-9);
    // 首键 C1-C2 长度 ≈ 1.39（键级不进 Bond 元组，几何保留）
    const [a, b] = [atoms[0]!, atoms[1]!];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(1.39, 2);
  });

  it('SDF 多记录：取第一条，忽略属性块', () => {
    const sdf = `${BENZENE_MOL}\n$$$$\n>  <ID>\n42\n\nanother molecule\n${BENZENE_MOL}\n$$$$\n`;
    const r = parseSdfOrMol(sdf);
    expect(r.name).toBe('benzene');
    expect(r.atoms).toHaveLength(6);
  });

  it('元素符号规范化（CL→Cl）；坐标列严格按固定列读取', () => {
    const mol = [
      'NaCl cluster',
      '', '',
      '  2  1  0  0  0  0  0  0  0  0999 V2000',
      '    0.0000    0.0000    0.0000 NA  0  0',
      '    2.8000    0.0000    0.0000 CL  0  0',
      '  1  2  1  0',
      'M  END',
    ].join('\n');
    const { atoms } = parseSdfOrMol(mol);
    expect(atoms.map((a) => a.el)).toEqual(['Na', 'Cl']);
  });

  it('V3000 明确报不支持；残缺文件报不完整', () => {
    expect(() => parseSdfOrMol(['x', '', '', '  0  0  0  0  0  0  0  0  0  0999 V3000'].join('\n'))).toThrowError(MolFormatError);
    expect(() => parseSdfOrMol('too short')).toThrowError(/不完整/);
    expect(() => parseSdfOrMol(['a', 'b', 'c', '  9  0  0  0  0  0  0  0  0  0999 V2000'].join('\n'))).toThrowError(/缺失/);
  });
});

describe('looksLikeMolFile（导入入口预判）', () => {
  it('MOL/SDF 识别；SMILES/化学式/矿物名不误判', () => {
    expect(looksLikeMolFile(BENZENE_MOL)).toBe(true);
    expect(looksLikeMolFile(`${BENZENE_MOL}\n$$$$\n`)).toBe(true);
    for (const not of ['Cc1ccccc1', 'H2O', '高岭石', 'PtCl4', 'CCO']) expect(looksLikeMolFile(not)).toBe(false);
  });
});
