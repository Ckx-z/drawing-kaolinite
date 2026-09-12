/**
 * 矿物注册表验收测试 —— 2026-09-12（中文矿物名搜索 + 五矿物 CIF 结构接线）
 *
 * 覆盖：中文名/别名/英文名匹配矩阵（含不误吞化学式输入）、
 * 五矿物 CIF 解析与对称展开的原子数/化学计量基线（严格晶体结构锁定）、
 * buildKaoliniteSheet 对五矿物各生成单层、d001 默认值、场景参数兼容。
 */
import { describe, expect, it } from 'vitest';
import { buildKaoliniteSheet } from './builders';
import { expandSymmetry, groupByLayer, parseCIF } from './crystal';
import { findMineral, MINERAL_KEYS, MINERALS, mineralOf } from './minerals';
import { sheetParamsSchema } from './schema';

const countByEl = (atoms: Array<{ el: string }>): Record<string, number> => {
  const by: Record<string, number> = {};
  for (const a of atoms) by[a.el] = (by[a.el] ?? 0) + 1;
  return by;
};

describe('矿物名称匹配（中文搜索识别）', () => {
  it('中文名/别名/英文前缀命中正确的矿物', () => {
    expect(findMineral('高岭石')?.key).toBe('kaolinite');
    expect(findMineral('地开石')?.key).toBe('dickite');
    expect(findMineral('珍珠石')?.key).toBe('nacrite');
    expect(findMineral('珍珠陶土')?.key).toBe('nacrite'); // 别名
    expect(findMineral('蒙脱石')?.key).toBe('montmorillonite');
    expect(findMineral('伊利石')?.key).toBe('illite');
    expect(findMineral('montmorillonite')?.key).toBe('montmorillonite');
    expect(findMineral('Mont')?.key).toBe('montmorillonite'); // ≥4 字符前缀
    expect(findMineral('Kaolinite')?.key).toBe('kaolinite'); // 大小写不敏感
  });

  it('化学式/单元素输入不被英文包含匹配误吞', () => {
    for (const s of ['C', 'CO', 'Si', 'NAC', 'ill', 'cao', '']) {
      expect(findMineral(s), `"${s}" 不应命中矿物`).toBeNull();
    }
  });

  it('mineralOf 未知键回退高岭石（旧场景兼容）', () => {
    expect(mineralOf(undefined).key).toBe('kaolinite');
    expect(mineralOf('no-such').key).toBe('kaolinite');
    expect(MINERAL_KEYS).toHaveLength(5);
  });
});

describe('五矿物 CIF 晶体结构基线（原子数 / 化学计量 / 对称性锁定）', () => {
  const BASELINES: Record<string, { expanded: number; byEl: Record<string, number>; symops: number; c: number }> = {
    kaolinite: { expanded: 26, byEl: { Al: 4, Si: 4, O: 18 }, symops: 2, c: 7.4048 },
    dickite: { expanded: 52, byEl: { Al: 8, Si: 8, O: 36 }, symops: 4, c: 14.736 },
    nacrite: { expanded: 68, byEl: { Al: 8, Si: 8, O: 36, H: 16 }, symops: 4, c: 14.593 },
    montmorillonite: { expanded: 38, byEl: { Al: 4, Si: 8, O: 24, Ca: 2 }, symops: 1, c: 15.0 },
    illite: { expanded: 76, byEl: { K: 4, Al: 16, Si: 8, O: 48 }, symops: 8, c: 20.143 },
  };

  it.each(Object.entries(BASELINES))('%s：对称展开原子数与化学计量与 CIF 一致', (key, base) => {
    const def = MINERALS[key as keyof typeof MINERALS];
    const parsed = parseCIF(def.cifText);
    expect(parsed.symops, `${key} 对称操作数`).toHaveLength(base.symops);
    expect(parsed.cell.c).toBeCloseTo(base.c, 2);
    const expanded = expandSymmetry(parsed.atoms, parsed.symops);
    expect(expanded, `${key} 展开原子数`).toHaveLength(base.expanded);
    expect(countByEl(expanded), `${key} 化学计量`).toEqual(base.byEl);
  });

  it('高岭石/地开石/珍珠石同族同计量（Al2Si2O5(OH)4 多型）；珍珠石 CIF 含显式 H', () => {
    const kao = countByEl(expandSymmetry(parseCIF(MINERALS.kaolinite.cifText).atoms, parseCIF(MINERALS.kaolinite.cifText).symops));
    const dic = countByEl(expandSymmetry(parseCIF(MINERALS.dickite.cifText).atoms, parseCIF(MINERALS.dickite.cifText).symops));
    expect(dic.Al).toBe(kao.Al * 2); // 双层晶胞 = 2×高岭石晶胞
    expect(dic.Si).toBe(kao.Si * 2);
  });
});

describe('五矿物片层生成（严格 CIF 管线）', () => {
  it.each(MINERAL_KEYS)('%s：单层生成成功且带层标记', (key) => {
    const def = MINERALS[key];
    const g = buildKaoliniteSheet(def.cifText, {
      Lx: 60,
      Ly: 50,
      layers: 1,
      d001: def.d001Default,
      shape: '矩形',
      style: '空间填充',
      edgeH: false,
    } as never);
    expect(g.atoms.length).toBeGreaterThan(0);
    expect(groupByLayer(g.atoms)).toHaveLength(1);
    // 元素集合与 CIF 展开一致（无编造元素）
    const els = new Set(g.atoms.map((a) => a.el));
    for (const el of els) expect(['Al', 'Si', 'O', 'H', 'K', 'Ca']).toContain(el);
  });

  it('蒙脱石含间层 Ca、伊利石含层间 K（CIF 位点原样呈现）', () => {
    const mt = buildKaoliniteSheet(MINERALS.montmorillonite.cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 15, shape: '矩形', style: '空间填充', edgeH: false,
    } as never);
    expect(mt.atoms.some((a) => a.el === 'Ca')).toBe(true);
    const il = buildKaoliniteSheet(MINERALS.illite.cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 20.14, shape: '矩形', style: '空间填充', edgeH: false,
    } as never);
    expect(il.atoms.some((a) => a.el === 'K')).toBe(true);
  });
});

describe('场景参数与默认值', () => {
  it('mineral 字段默认 kaolinite（旧场景缺键兼容）；d001 上限放宽到 25', () => {
    const parsed = sheetParamsSchema.parse({
      Lx: 70, Ly: 60, layers: 1, d001: 20.14, shape: '矩形', style: '空间填充', edgeH: false,
    });
    expect(parsed.mineral).toBe('kaolinite');
    const illiteParsed = sheetParamsSchema.parse({
      Lx: 70, Ly: 60, layers: 1, d001: 20.14, shape: '矩形', style: '空间填充', edgeH: false,
      mineral: 'illite',
    });
    expect(illiteParsed.mineral).toBe('illite');
  });

  it('d001 默认 = 各矿物 c 轴周期（双层晶胞矿物取完整周期）', () => {
    expect(MINERALS.kaolinite.d001Default).toBeCloseTo(7.4, 2);
    expect(MINERALS.dickite.d001Default).toBeCloseTo(14.736, 2);
    expect(MINERALS.illite.d001Default).toBeCloseTo(20.143, 2);
  });
});
