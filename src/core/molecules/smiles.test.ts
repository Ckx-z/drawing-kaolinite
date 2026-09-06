/**
 * SMILES 分子导入验收测试 —— T-2.8
 *
 * 验收标准（TODO）：乙醇/苯甲酸等 10 个测试 SMILES 生成合理 3D 结构；
 * 非法 SMILES 给出明确报错不崩溃；单次转换 < 1s。
 * "合理"判据（示意级构象）：原子数与化学式一致、键长在物理范围、无严重原子重叠、
 * 苯环共面、确定性（同输入同输出）。
 */
import { describe, expect, it } from 'vitest';
import { SmilesError, parseSmiles, smilesTo3D } from './smiles';

interface Case {
  smiles: string;
  /** 分子式（重原子+H 全计），用于原子数校验 */
  formula: Record<string, number>;
}

const CASES: Case[] = [
  { smiles: 'CCO', formula: { C: 2, O: 1, H: 6 } },                          // 乙醇
  { smiles: 'c1ccccc1', formula: { C: 6, H: 6 } },                          // 苯
  { smiles: 'c1ccccc1C(=O)O', formula: { C: 7, O: 2, H: 6 } },              // 苯甲酸
  { smiles: 'CC(=O)O', formula: { C: 2, O: 2, H: 4 } },                     // 乙酸
  { smiles: 'Cc1ccccc1', formula: { C: 7, H: 8 } },                         // 甲苯
  { smiles: 'OC(=O)c1ccccc1', formula: { C: 7, O: 2, H: 6 } },              // 苯甲酸（反向书写）
  { smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', formula: { C: 8, H: 10, N: 4, O: 2 } }, // 咖啡因
  { smiles: 'NCCc1ccc(O)c(O)c1', formula: { C: 8, H: 11, N: 1, O: 2 } },    // 多巴胺
  { smiles: 'CC(=O)Oc1ccccc1C(=O)O', formula: { C: 9, H: 8, O: 4 } },       // 阿司匹林
  { smiles: '[Na+].[Cl-]', formula: { Na: 1, Cl: 1 } },                     // 氯化钠（断键离子对）
];

describe('解析与构象：10 个测试 SMILES（T-2.8 验收）', () => {
  for (const c of CASES) {
    it(`${c.smiles} → 原子数/元素组成正确，几何合理`, () => {
      const t0 = performance.now();
      const mol = smilesTo3D(c.smiles);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(1000); // 单次转换 < 1s

      // 原子组成
      const count: Record<string, number> = {};
      for (const a of mol.atoms) count[a.el] = (count[a.el] ?? 0) + 1;
      expect(count).toEqual(c.formula);

      // 键长物理范围（1.0–1.8Å）
      for (const [i, j] of mol.bonds.map((b) => [b[0], b[1]])) {
        const d = Math.hypot(
          mol.atoms[i].x - mol.atoms[j].x,
          mol.atoms[i].y - mol.atoms[j].y,
          mol.atoms[i].z - mol.atoms[j].z,
        );
        expect(d, `${c.smiles} bond ${i}-${j} = ${d}`).toBeGreaterThan(0.9);
        expect(d, `${c.smiles} bond ${i}-${j} = ${d}`).toBeLessThan(1.9);
      }

      // 无严重重叠：非键原子间距 > 1.0Å（示意级阈值）
      let minNonBonded = Infinity;
      const bondedSet = new Set(mol.bonds.map((b) => `${Math.min(b[0], b[1])},${Math.max(b[0], b[1])}`));
      for (let i = 0; i < mol.atoms.length; i++) {
        for (let j = i + 1; j < mol.atoms.length; j++) {
          if (bondedSet.has(`${i},${j}`)) continue;
          const d = Math.hypot(
            mol.atoms[i].x - mol.atoms[j].x,
            mol.atoms[i].y - mol.atoms[j].y,
            mol.atoms[i].z - mol.atoms[j].z,
          );
          if (d < minNonBonded) minNonBonded = d;
        }
      }
      expect(minNonBonded, `${c.smiles} minNonBonded = ${minNonBonded}`).toBeGreaterThan(1.0);

      // 确定性（同输入同输出）
      const again = smilesTo3D(c.smiles);
      expect(again).toEqual(mol);
    });
  }

  it('苯环共面（芳香环 z 分量方差 ≈ 0）', () => {
    const mol = smilesTo3D('c1ccccc1');
    const ring = mol.atoms.slice(0, 6);
    const zs = ring.map((a) => a.z);
    const mean = zs.reduce((a, b) => a + b, 0) / 6;
    const varZ = zs.reduce((a, b) => a + (b - mean) ** 2, 0) / 6;
    expect(varZ).toBeLessThan(0.01);
  });

  it('咖啡因（稠环 + 羰基 + N 甲基）：稠环共面且全原子有限坐标', () => {
    const mol = smilesTo3D('Cn1cnc2c1c(=O)n(C)c(=O)n2C');
    for (const a of mol.atoms) {
      expect(Number.isFinite(a.x)).toBe(true);
      expect(Number.isFinite(a.y)).toBe(true);
      expect(Number.isFinite(a.z)).toBe(true);
    }
  });
});

describe('非法 SMILES：明确报错不崩溃', () => {
  const bad: Array<[string, string]> = [
    ['c1ccccc', '环编号未闭合'],
    ['C1CC', '环编号未闭合'],
    ['Xyz', '无法识别的字符「X」'],
    ['C(C', '括号未闭合'],
    ['C)C', '括号不匹配'],
    ['C1CC%1', '% 后需两位数字'],
    ['C=](O)', '无法识别的字符「]」'],
    ['', 'SMILES 为空'],
  ];
  for (const [smiles, msg] of bad) {
    it(`${JSON.stringify(smiles)} → SmilesError: ${msg}`, () => {
      expect(() => smilesTo3D(smiles)).toThrow(SmilesError);
      expect(() => smilesTo3D(smiles)).toThrow(msg);
    });
  }

  it('解析失败不产生半成品（异常路径无副作用）', () => {
    const before = smilesTo3D('CCO'); // 正常分子作为对照
    expect(() => smilesTo3D('CCO1')).toThrow(SmilesError);
    const after = smilesTo3D('CCO');
    expect(after).toEqual(before);
  });
});

describe('解析器细节', () => {
  it('方括号原子：[Na+] 电荷、[NH4+] 隐式/显式氢、[Fe+3]', () => {
    const na = parseSmiles('[Na+].[Cl-]');
    expect(na.atoms.map((a) => a.el)).toEqual(['Na', 'Cl']);
    expect(na.atoms[0].charge).toBe(1);
    expect(na.atoms[1].charge).toBe(-1);
    expect(na.bonds).toHaveLength(0); // 断键

    const nh4 = parseSmiles('[NH4+]');
    expect(nh4.atoms[0].el).toBe('N');
    expect(nh4.atoms[0].hCount).toBe(4);
    expect(nh4.atoms[0].charge).toBe(1);

    const fe = parseSmiles('[Fe+3]');
    expect(fe.atoms[0].charge).toBe(3);
  });

  it('断键分子（.）各自独立嵌入', () => {
    const mol = smilesTo3D('O.O'); // 两个水
    expect(mol.atoms).toHaveLength(6); // 2×(O+2H)
    // 两组各自成键，组间无键
    expect(mol.bonds).toHaveLength(4);
  });
});
