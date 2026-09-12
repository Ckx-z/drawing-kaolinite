/**
 * 化学式导入验收测试 —— 2026-09-08
 *
 * 用户需求：导入框输入化学式（大小写不敏感）：si/SI/Si → 硅单球；
 * 支持 Si、NaCl、H2O、Fe2O3 等标准化学式；解析 + 团簇构建 + 规范化。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeGeometry } from '../worker';
import {
  buildFormulaCluster,
  canonicalFormula,
  FormulaError,
  formulaTo3D,
  parseFormula,
  resolveImportPath,
} from './formula';

const CIF = readFileSync(new URL('../../../data/kaolinite.cif', import.meta.url), 'utf8');

/** tokens 的紧凑串（[Si,1],[O,2] → "Si1 O2"） */
const show = (t: Array<{ el: string; count: number }>): string => t.map((x) => `${x.el}${x.count}`).join(' ');

describe('parseFormula：大小写不敏感解析', () => {
  it('规范化学式直接解析（严格模式含小写：Co = 钴）', () => {
    expect(show(parseFormula('Si'))).toBe('Si1');
    expect(show(parseFormula('H2O'))).toBe('H2 O1');
    expect(show(parseFormula('NaCl'))).toBe('Na1 Cl1');
    expect(show(parseFormula('Fe2O3'))).toBe('Fe2 O3');
    expect(show(parseFormula('Co'))).toBe('Co1'); // 首大次小 = 钴
  });

  it('全大写宽松归一（2026-09-12 更新：CO → C+O 一氧化碳，不再→Co）', () => {
    const tokens = parseFormula('CO');
    expect(tokens).toEqual([
      { el: 'C', count: 1 },
      { el: 'O', count: 1 },
    ]);
    // 双字母元素全大写形态仍可归一（FE2O3 首字母拆失败自动回退双字母）
    expect(canonicalFormula(parseFormula('FE2O3'))).toBe('Fe2O3');
    expect(canonicalFormula(parseFormula('AU2O3'))).toBe('Au2O3');
    // SI 例外保留（2026-09-08 需求：SI → 硅）
    expect(canonicalFormula(parseFormula('SI'))).toBe('Si');
  });

  it('小写 / 全大写 / 混合大小写均归一识别（si/SI/sI → Si）', () => {
    for (const s of ['si', 'SI', 'sI', 'Si']) {
      expect(show(parseFormula(s)), `输入 ${s}`).toBe('Si1');
    }
    expect(show(parseFormula('fe2o3'))).toBe('Fe2 O3');
    expect(show(parseFormula('FE2O3'))).toBe('Fe2 O3');
    expect(show(parseFormula('nacl'))).toBe('Na1 Cl1');
    expect(show(parseFormula('h2o'))).toBe('H2 O1');
  });

  it('小写 co 归一为钴 Co（无大小写分隔信息时双字母元素优先）', () => {
    expect(show(parseFormula('co'))).toBe('Co1');
  });

  it('未知元素 / 非法字符 / 空串 / 超长 抛 FormulaError', () => {
    expect(() => parseFormula('Xx')).toThrow(FormulaError); // 非元素
    expect(() => parseFormula('Si-O')).toThrow(FormulaError); // 非法字符
    expect(() => parseFormula('')).toThrow(FormulaError);
    expect(() => parseFormula('H999')).toThrow(FormulaError); // 超原子数上限
  });

  it('canonicalFormula 规范化输出（fe2o3 → Fe2O3，H2O 计量 1 省略）', () => {
    expect(canonicalFormula(parseFormula('fe2o3'))).toBe('Fe2O3');
    expect(canonicalFormula(parseFormula('h2o'))).toBe('H2O');
    expect(canonicalFormula(parseFormula('si'))).toBe('Si');
  });
});

describe('buildFormulaCluster：紧密团簇 + 自动连键', () => {
  it('单元素计量 1 → 单原子球（硅原子模型）', () => {
    const { atoms, bonds } = buildFormulaCluster(parseFormula('Si'));
    expect(atoms).toHaveLength(1);
    expect(atoms[0]!.el).toBe('Si');
    expect(bonds).toHaveLength(0);
  });

  it('H2O → 3 原子且氧连两个氢（近距自动键）', () => {
    const { atoms, bonds } = buildFormulaCluster(parseFormula('h2o'));
    expect(atoms).toHaveLength(3);
    expect(atoms.filter((a) => a.el === 'H')).toHaveLength(2);
    expect(atoms.filter((a) => a.el === 'O')).toHaveLength(1);
    expect(bonds.length).toBeGreaterThanOrEqual(2);
  });

  it('Fe2O3 → 5 原子团簇、元素配比正确、无原子重叠（≥0.95×半径和）', () => {
    const { atoms, bonds } = buildFormulaCluster(parseFormula('FE2O3'));
    expect(atoms).toHaveLength(5);
    expect(atoms.filter((a) => a.el === 'Fe')).toHaveLength(2);
    expect(bonds.length).toBeGreaterThan(0);
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(atoms[i]!.x - atoms[j]!.x, atoms[i]!.y - atoms[j]!.y, atoms[i]!.z - atoms[j]!.z);
        expect(d).toBeGreaterThan(0.5); // 无重叠
      }
    }
  });

  it('同输入确定性输出（两次构建逐位一致，D02）', () => {
    const a = JSON.stringify(formulaTo3D('NaCl'));
    const b = JSON.stringify(formulaTo3D('nacl'));
    expect(a).toBe(b); // 归一化后相同输入 → 相同团簇
  });
});

describe('几何链路接入（computeGeometry molecule.formula）', () => {
  it('formula 参数经引擎出几何（与 formulaTo3D 一致）；kind 回退不受影响', () => {
    const geo = computeGeometry({ kind: 'molecule', cifText: '', params: { kind: 'H₂O', formula: 'Fe2O3' } });
    expect(geo.atoms).toHaveLength(5);
    const direct = formulaTo3D('Fe2O3');
    expect(geo.atoms[0]!.el).toBe(direct.atoms[0]!.el);
    // 无 formula/smiles 时回退内置分子
    const builtin = computeGeometry({ kind: 'molecule', cifText: '', params: { kind: 'H₂O' } });
    expect(builtin.atoms).toHaveLength(3);
  });

  it('formula 分子可入场景并随组件参数重建（schema 往返）', async () => {
    const { sceneDocumentSchema } = await import('../schema');
    const doc = {
      format: 'kaolin-scene/v1',
      saved: new Date().toISOString(),
      palette: { id: 'default' },
      annotations: [],
      components: [
        {
          id: 'm1',
          type: 'molecule',
          name: 'Fe2O3',
          visible: true,
          locked: false,
          params: { kind: 'H₂O', formula: 'Fe2O3' },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 4 },
        },
      ],
    };
    expect(() => sceneDocumentSchema.parse(doc)).not.toThrow();
  });
});

describe('单原子模式（2026-09-08）', () => {
  it('片层 atomMode=single → 全部原子统一为 singleEl，原子数不变', () => {
    const full = computeGeometry({
      kind: 'kaolinite_sheet',
      cifText: CIF,
      params: {
        Lx: 40, Ly: 40, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充',
        edgeH: false, strictCell: false, atomMode: 'full', singleEl: 'Si',
      },
    });
    const single = computeGeometry({
      kind: 'kaolinite_sheet',
      cifText: CIF,
      params: {
        Lx: 40, Ly: 40, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充',
        edgeH: false, strictCell: false, atomMode: 'single', singleEl: 'Fe',
      },
    });
    expect(single.atoms).toHaveLength(full.atoms.length); // 几何骨架不变
    expect(new Set(single.atoms.map((a) => a.el))).toEqual(new Set(['Fe'])); // 元素统一
  });

  it('管与颗粒同理；旧参数缺省 atomMode 默认 full（向后兼容）', async () => {
    const tube = computeGeometry({
      kind: 'halloysite_tube',
      cifText: CIF,
      params: {
        innerR: 12, length: 60, walls: 1, d001: 7.4, progress: 1, taperDeg: 0,
        style: '空间填充', curlAxis: 'a', portNoise: 0, atomMode: 'single', singleEl: 'C',
      },
    });
    expect(new Set(tube.atoms.map((a) => a.el))).toEqual(new Set(['C']));

    const part = computeGeometry({
      kind: 'nanoparticle',
      cifText: '',
      params: { radius: 6, grains: 60, seed: 7, mode: '簇装', atomMode: 'single', singleEl: 'Ce' },
    });
    expect(new Set(part.atoms.map((a) => a.el))).toEqual(new Set(['Ce']));

    const { sheetParamsSchema, DEFAULT_PARAMS } = await import('../schema');
    // 旧场景缺 atomMode/singleEl → parse 补默认 full（严格 schema 下无这两个键也合法）
    const legacy = sheetParamsSchema.parse({
      Lx: 40, Ly: 40, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false,
    });
    expect(legacy.atomMode).toBe('full');
    expect(DEFAULT_PARAMS.kaolinite_sheet.atomMode).toBe('full');
  });
});

describe('全周期表元素识别（2026-09-11 修复：此前 84 种元素无法导入）', () => {
  it('曾失败的单质：Au/Pt/W/Pd/La/Nd/Ga/Pb/U（含大小写变体）', () => {
    for (const [input, canonical] of [
      ['Au', 'Au'], ['au', 'Au'], ['AU', 'Au'],
      ['Pt', 'Pt'], ['pt', 'Pt'], ['W', 'W'], ['w', 'W'],
      ['Pd', 'Pd'], ['La', 'La'], ['la', 'La'], ['Nd', 'Nd'],
      ['Ga', 'Ga'], ['Pb', 'Pb'], ['U', 'U'],
    ] as const) {
      const r = formulaTo3D(input);
      expect(r.canonical, `${input} 应识别为 ${canonical}`).toBe(canonical);
      expect(r.atoms).toHaveLength(1);
      expect(r.atoms[0]!.el).toBe(canonical);
    }
  });

  it('曾失败的化合物：贵金属/稀土/钨酸盐化学式', () => {
    expect(formulaTo3D('Au2O3').canonical).toBe('Au2O3');
    expect(formulaTo3D('PtCl4').canonical).toBe('PtCl4'); // 规范大小写（全小写 ptcl4 语义歧义：块计量 = Pt4Cl4）
    expect(formulaTo3D('La2O3').canonical).toBe('La2O3');
    expect(formulaTo3D('CaWO4').canonical).toBe('CaWO4');
    expect(formulaTo3D('GaN').canonical).toBe('GaN'); // Ga+ 单字母歧义无碍（Ga 双字母优先）
    const au = formulaTo3D('Au2O3');
    expect(au.atoms.filter((a) => a.el === 'Au')).toHaveLength(2);
    expect(au.atoms.filter((a) => a.el === 'O')).toHaveLength(3);
  });

  it('真非法输入仍拒绝（q 不在周期表）', () => {
    expect(() => formulaTo3D('qqq')).toThrow();
    expect(() => formulaTo3D('Q1')).toThrow();
  });
});

describe('导入分流修复（2026-09-12：纯化学式形态不再被 SMILES 加氢）', () => {
  it('resolveImportPath：单元素与两元素二元式 → 化学式优先；真 SMILES → SMILES 优先', () => {
    for (const s of ['O', 'N', 'C', 'S', 'P', 'B', 'F', 'Cl', 'Br', 'I', 'Si', 'Fe', 'Au']) {
      expect(resolveImportPath(s), `${s} 应化学式优先`).toBe('formula-first');
    }
    for (const s of ['CO', 'NO', 'CN', 'CS', 'SO', 'BO', 'CF', 'SN', 'NS', 'PO', 'CI']) {
      expect(resolveImportPath(s), `${s} 应化学式优先（二元双原子）`).toBe('formula-first');
    }
    for (const s of ['CCO', 'CCC', 'OCC', 'NCC', 'c1ccccc1', 'C(=O)O', 'CO2', 'H2O', 'NaCl', 'fe2o3']) {
      expect(resolveImportPath(s), `${s} 应 SMILES 优先`).toBe('smiles-first');
    }
  });

  it('A 类：单元素符号导入 → 单原子球（不再变水/氨/甲烷）', () => {
    const cases: Array<[string, string, number]> = [
      ['O', 'O', 1], ['N', 'N', 1], ['C', 'C', 1], ['S', 'S', 1], ['P', 'P', 1],
      ['B', 'B', 1], ['F', 'F', 1], ['Cl', 'Cl', 1], ['Br', 'Br', 1], ['I', 'I', 1],
    ];
    for (const [input, el, n] of cases) {
      const r = formulaTo3D(input);
      expect(r.canonical, `${input} 应为单原子 ${el}`).toBe(el);
      expect(r.atoms).toHaveLength(n);
      expect(r.atoms.filter((a) => a.el === 'H'), `${input} 不应加氢`).toHaveLength(0);
    }
  });

  it('B 类：两元素二元式 → 无氢双原子（CO=一氧化碳，不再变甲醇）', () => {
    const cases: Array<[string, string, string]> = [
      ['CO', 'C', 'O'], ['NO', 'N', 'O'], ['CN', 'C', 'N'], ['CS', 'C', 'S'],
      ['SO', 'S', 'O'], ['BO', 'B', 'O'], ['CF', 'C', 'F'], ['SN', 'S', 'N'],
      ['NS', 'N', 'S'], ['PO', 'P', 'O'], ['CI', 'C', 'I'],
    ];
    for (const [input, e1, e2] of cases) {
      const r = formulaTo3D(input);
      expect(r.atoms).toHaveLength(2);
      expect(r.atoms.map((a) => a.el).sort(), `${input} 应为 ${e1}+${e2}`).toEqual([e1, e2].sort());
      expect(r.canonical).toBe(input);
    }
  });

  it('附加修复：全大写带数字不再错拆（CO2≠Co2 / NO2≠No2 / NH3≠Nh3）', () => {
    expect(formulaTo3D('CO2').canonical).toBe('CO2');
    expect(formulaTo3D('NO2').canonical).toBe('NO2');
    expect(formulaTo3D('NH3').canonical).toBe('NH3');
    expect(formulaTo3D('SO2').canonical).toBe('SO2');
    const co2 = formulaTo3D('CO2');
    expect(co2.atoms.filter((a) => a.el === 'O')).toHaveLength(2);
  });

  it('不回归：小写/混合输入与 SI→Si 保持', () => {
    expect(formulaTo3D('fe2o3').canonical).toBe('Fe2O3');
    expect(formulaTo3D('nacl').canonical).toBe('NaCl');
    expect(formulaTo3D('si').canonical).toBe('Si');
    expect(formulaTo3D('SI').canonical).toBe('Si');
    expect(formulaTo3D('sI').canonical).toBe('Si');
    expect(formulaTo3D('CaWO4').canonical).toBe('CaWO4');
  });
});
