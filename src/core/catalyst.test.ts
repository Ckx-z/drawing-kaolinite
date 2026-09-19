/**
 * 催化氧化物素材验收 —— 2026-09-18（Co₃O₄ 尖晶石 + CeO₂ 萤石，CIF 直驱）
 *
 * 数据源：COD 9005888（Co₃O₄，Liu & Prewilt 高温衍射精修，Fd-3m origin 2，
 * a=8.0968，Co1 8a / Co2 16d / O 32e u=0.263，全占位有序模型）与
 * COD 9009008（CeO₂，Fm-3m 萤石，a=5.4110，Ce 4a / O 8c）。
 *
 * 覆盖：晶胞/对称展开化学计量（56=Co24O32、12=Ce4O8）、中英文/化学式/
 * 别名多路搜索、不错拆防御（Co3O4 不被分子侧误吞、C3H8/C7H8 不被矿物侧
 * 误吞）、非层状语义（layered=false + 管组件排除）、立方晶胞 1–3 层切片、
 * 风格化 CeO₂ 簇装颗粒并存不受影响。
 */
import { describe, expect, it } from 'vitest';
import { buildKaoliniteSheet, buildParticle } from './builders';
import { expandSymmetry, groupByLayer, parseCIF } from './crystal';
import { findMineral, MINERALS } from './minerals';
import { resolveMoleculeQuery } from './molecules/registry';
import { PARAM_DEFS } from '../ui/paramDefs';
import { sheetParamsSchema, tubeParamsSchema } from './schema';

describe('Co₃O₄ CIF 解析（COD 9005888 尖晶石）', () => {
  const def = MINERALS.co3o4;
  const parsed = parseCIF(def.cifText);

  it('晶胞立方（a=b=c=8.0968，三夹角 90°）；显式 symop 192', () => {
    expect(parsed.cell.a).toBeCloseTo(8.0968, 3);
    expect(parsed.cell.b).toBeCloseTo(8.0968, 3);
    expect(parsed.cell.c).toBeCloseTo(8.0968, 3);
    expect(parsed.cell.alpha).toBe(90);
    expect(parsed.cell.beta).toBe(90);
    expect(parsed.cell.gamma).toBe(90);
    expect(parsed.symops).toHaveLength(192);
  });

  it('对称展开 56 原子 = Co₂₄O₃₂（8a Co²⁺ + 16d Co³⁺ + 32e O，化学计量严格一致）', () => {
    const e = expandSymmetry(parsed.atoms, parsed.symops);
    expect(e).toHaveLength(56);
    const by: Record<string, number> = {};
    for (const a of e) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual({ Co: 24, O: 32 });
  });
});

describe('CeO₂ CIF 解析（COD 9009008 萤石）', () => {
  const def = MINERALS.ceo2;
  const parsed = parseCIF(def.cifText);

  it('晶胞立方（a=5.4110）；显式 symop 192', () => {
    expect(parsed.cell.a).toBeCloseTo(5.411, 3);
    expect(parsed.cell.c).toBeCloseTo(5.411, 3);
    expect(parsed.cell.alpha).toBe(90);
    expect(parsed.symops).toHaveLength(192);
  });

  it('对称展开 12 原子 = Ce₄O₈（4a + 8c，萤石化学计量严格一致）', () => {
    const e = expandSymmetry(parsed.atoms, parsed.symops);
    expect(e).toHaveLength(12);
    const by: Record<string, number> = {};
    for (const a of e) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual({ Ce: 4, O: 8 });
  });
});

describe('搜索直达与不错拆', () => {
  it('中文名：四氧化三钴 / 二氧化铈', () => {
    expect(findMineral('四氧化三钴')?.key).toBe('co3o4');
    expect(findMineral('二氧化铈')?.key).toBe('ceo2');
  });

  it('英文/化学式/别名大小写不敏感：Co3O4/CO3O4/cobalt oxide/ceria/CeO2/cerianite', () => {
    for (const q of ['co3o4', 'Co3O4', 'CO3O4', 'cobalt oxide', 'tricobalt tetroxide', 'cobalt spinel']) {
      expect(findMineral(q), `"${q}" → co3o4`).toBeDefined();
      expect(findMineral(q)!.key).toBe('co3o4');
    }
    for (const q of ['ceo2', 'CeO2', 'CEO2', 'ceria', 'cerium oxide', 'cerianite', 'ceo₂']) {
      expect(findMineral(q), `"${q}" → ceo2`).toBeDefined();
      expect(findMineral(q)!.key).toBe('ceo2');
    }
  });

  it('不错拆：矿物化学式不被分子侧误吞（Co3O4/CeO2 ≠ 分子）；分子式不被矿物侧误吞', () => {
    // 分子注册表对矿物式返回 null（含数字大小写混合串不做小写折叠，Co2 先例规则）
    expect(resolveMoleculeQuery('Co3O4')).toBeNull();
    expect(resolveMoleculeQuery('CeO2')).toBeNull();
    // 分子化学式不命中矿物
    expect(findMineral('C3H8')).toBeNull();
    expect(findMineral('C7H8')).toBeNull();
    expect(findMineral('propane')).toBeNull();
    expect(findMineral('toluene')).toBeNull();
  });
});

describe('非层状语义与切片', () => {
  it('layered=false、无层间物种、d001 默认 = c 轴（= 立方 a）', () => {
    expect(MINERALS.co3o4.layered).toBe(false);
    expect(MINERALS.ceo2.layered).toBe(false);
    expect(MINERALS.co3o4.interlayer).toEqual([]);
    expect(MINERALS.ceo2.interlayer).toEqual([]);
    expect(MINERALS.co3o4.d001Default).toBeCloseTo(8.0968, 3);
    expect(MINERALS.ceo2.d001Default).toBeCloseTo(5.411, 3);
  });

  it('管组件双重排除：管 schema 枚举与矿物下拉选项均不含 co3o4/ceo2', () => {
    expect(() =>
      tubeParamsSchema.parse({ innerR: 14, length: 90, walls: 1, d001: 7.4, progress: 1, taperDeg: 0, style: '球棍', mineral: 'co3o4' }),
    ).toThrow();
    expect(() =>
      tubeParamsSchema.parse({ innerR: 14, length: 90, walls: 1, d001: 7.4, progress: 1, taperDeg: 0, style: '球棍', mineral: 'ceo2' }),
    ).toThrow();
    const tubeMineralField = PARAM_DEFS.halloysite_tube.find((f) => f.key === 'mineral')!;
    const opts = ((tubeMineralField as unknown as { options: readonly unknown[] }).options ?? []).map((o) => (o as { value: string }).value);
    expect(opts).not.toContain('co3o4');
    expect(opts).not.toContain('ceo2');
  });

  it.each([1, 2, 3])('Co₃O₄ %s 层切片线性（56×na×nb×nc）且带层标记', (nc) => {
    const g = buildKaoliniteSheet(MINERALS.co3o4.cifText, {
      Lx: 40, Ly: 40, layers: nc, d001: 8.0968, shape: '矩形', style: '球棍', edgeH: false, mineral: 'co3o4',
    } as never);
    // na = round(40/8.0968) = 5 → 每层 56×25 = 1400
    expect(g.atoms).toHaveLength(56 * 25 * nc);
    expect(groupByLayer(g.atoms)).toHaveLength(nc);
    for (const a of g.atoms) expect(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)).toBe(true);
  });

  it('CeO₂ 切片：矩形与六角轮廓均不崩溃（原子数非零有限）', () => {
    for (const shape of ['矩形', '六角'] as const) {
      const g = buildKaoliniteSheet(MINERALS.ceo2.cifText, {
        Lx: 32, Ly: 32, layers: 2, d001: 5.411, shape, style: '球棍', edgeH: false, mineral: 'ceo2',
      } as never);
      expect(g.atoms.length).toBeGreaterThan(0);
      expect(g.bonds.length).toBeGreaterThan(0);
    }
  });

  it('schema：片层 mineral 字段接受 co3o4/ceo2', () => {
    for (const key of ['co3o4', 'ceo2'] as const) {
      const p = sheetParamsSchema.parse({
        Lx: 32, Ly: 32, layers: 1, d001: 8.0968, shape: '矩形', style: '球棍', edgeH: false, mineral: key,
      });
      expect(p.mineral).toBe(key);
    }
  });
});

describe('与现有系统并存', () => {
  it('CeO₂ 风格化簇装颗粒不受影响（buildParticle 照常，非 CIF 路径）', () => {
    const p = buildParticle({ radius: 9, grains: 160, seed: 7, mode: '簇装' });
    expect(p.atoms.length).toBeGreaterThan(100);
    const els = new Set(p.atoms.map((a) => a.el));
    expect(els.has('Ce')).toBe(true);
    expect(els.has('O')).toBe(true);
  });

  it('五种层状矿物回归：管下拉仍为五层状（莫来石/Co₃O₄/CeO₂ 均按 layered=false 排除）', () => {
    const tubeMineralField = PARAM_DEFS.halloysite_tube.find((f) => f.key === 'mineral')!;
    const opts = ((tubeMineralField as unknown as { options: readonly unknown[] }).options ?? []).map((o) => (o as { value: string }).value);
    expect(opts).toHaveLength(5);
    expect(opts).toEqual(expect.arrayContaining(['kaolinite', 'dickite', 'nacrite', 'montmorillonite', 'illite']));
    expect(opts).not.toContain('mullite');
  });
});
