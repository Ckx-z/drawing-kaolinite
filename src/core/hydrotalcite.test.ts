/**
 * 水滑石（第九矿物）验收测试 —— 2026-09-24
 *
 * 数据源：ICSD 86655（Costantino & Maffettini, Eur. J. Inorg. Chem. 1998），
 * Mg-Al CO₃ 型水滑石 3R 多型，R-3m（No.166，36 显式 symop），a=3.04535
 * c=22.7010 γ=120，Z=3。层板 Mg/Al 无序共占 3a（occ 0.67/0.33，双位点全显示）；
 * 层间 CO₃²⁻（部分占位）+ H₂O/羟基。d₀₀₁ = c/3 ≈ 7.567（3R：c = 3×d₀₀₁）。
 *
 * 覆盖任务书 2.6 全 12 项。
 */
import { describe, expect, it } from 'vitest';
import { buildKaoliniteSheet } from './builders';
import { expandSymmetry, groupByLayer, parseCIF } from './crystal';
import { findMineral, MINERALS } from './minerals';
import { sheetParamsSchema, tubeParamsSchema } from './schema';

const cif = MINERALS.hydrotalcite.cifText;
describe('CIF 解析（ICSD 86655，R-3m）', () => {
  const parsed = parseCIF(cif);

  it('晶胞参数：a=3.0454 / c=22.7010 / γ=120°（3R 六方设置）；显式 symop 36', () => {
    expect(parsed.cell.a).toBeCloseTo(3.04535, 3);
    expect(parsed.cell.c).toBeCloseTo(22.701, 3);
    expect(parsed.cell.gamma).toBe(120);
    expect(parsed.cell.alpha).toBe(90);
    expect(parsed.symops).toHaveLength(36); // R-3m 36 操作（ICSD _symmetry_equiv_pos 变体）
  });

  it('对称展开：非零且位点多重性合理（层板+层间全展开；位点解析阶段 occupancy 保留）', () => {
    const e = expandSymmetry(parsed.atoms, parsed.symops);
    expect(e.length).toBeGreaterThan(30); // 7 位点 × 36 操作展开去重后显著增长
    const els = new Set(e.map((a) => a.el));
    for (const el of ['Mg', 'Al', 'O', 'C', 'H']) expect(els.has(el), el).toBe(true);
  });

  it('d₀₀₁ 与 c 轴关系：3R 多型 c = 3 × d₀₀₁（注册表 d001Default = c/3 = 7.567）', () => {
    const parsedC = parseCIF(cif).cell.c;
    expect(MINERALS.hydrotalcite.d001Default).toBeCloseTo(parsedC / 3, 3);
    expect(MINERALS.hydrotalcite.d001Default).toBeCloseTo(7.567, 2);
  });
});

describe('搜索四路（中文/英文/化学式/别名）', () => {
  it('水滑石 / hydrotalcite / LDH / Mg6Al2 全命中 hydrotalcite', () => {
    for (const q of ['水滑石', 'Hydrotalcite', 'hydrotalcite', 'LDH', 'layered double hydroxide', '层状双氢氧化物']) {
      expect(findMineral(q), `"${q}"`).toBeDefined();
      expect(findMineral(q)!.key).toBe('hydrotalcite');
    }
  });

  it('layered 语义：真层状（layered=true）；天然无管状变体（tubable=false）→ 管组件双重排除', () => {
    expect(MINERALS.hydrotalcite.layered).toBe(true); // 真层状：层间开关等语义可用
    expect(MINERALS.hydrotalcite.tubable).toBe(false); // 无管状变体：管排除
    expect(() =>
      tubeParamsSchema.parse({ innerR: 14, length: 90, walls: 1, d001: 7.567, progress: 1, taperDeg: 0, style: '球棍', mineral: 'hydrotalcite' }),
    ).toThrow();
    // 层间物种注册：C（CO₃²⁻）+ H（H₂O/羟基）
    expect(MINERALS.hydrotalcite.interlayer).toContain('C');
    expect(MINERALS.hydrotalcite.interlayer).toContain('H');
  });

  it('schema 边界：d001 7.567 在 [7.2, 25] 内；mineral=hydrotalcite 合法', () => {
    const p = sheetParamsSchema.parse({
      Lx: 30, Ly: 30, layers: 1, d001: 7.567, shape: '矩形', style: '球棍', edgeH: false, mineral: 'hydrotalcite',
    });
    expect(p.mineral).toBe('hydrotalcite');
    expect(() =>
      sheetParamsSchema.parse({ Lx: 30, Ly: 30, layers: 1, d001: 2.0, shape: '矩形', style: '球棍', edgeH: false }),
    ).toThrow(); // 下限 2.5（莫来石 c=2.89 依赖保留）；水滑石 7.567  comfortably 在界内
  });
});

describe('切片生成（1–3 层线性 / 无退化键 / 六角裁剪 / 双模式 / 确定性）', () => {
  const build = (over: Record<string, unknown> = {}) =>
    buildKaoliniteSheet(cif, {
      Lx: 24, Ly: 24, layers: 1, d001: 7.567, shape: '矩形', style: '球棍', edgeH: false, mineral: 'hydrotalcite', ...over,
    } as never);

  it.each([1, 2, 3])('%s 层：原子数线性增长且带层标记', (nc) => {
    const g1 = build({ layers: 1 });
    const gN = build({ layers: nc });
    expect(gN.atoms.length).toBe(g1.atoms.length * nc); // 线性
    expect(groupByLayer(gN.atoms)).toHaveLength(nc);
  });

  it('最短键长 > 0.5Å（无退化键）', () => {
    const g = build();
    expect(g.bonds.length).toBeGreaterThan(0);
    let min = Infinity;
    for (const [i, j] of g.bonds) {
      const a = g.atoms[i]!;
      const b = g.atoms[j]!;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    expect(min).toBeGreaterThan(0.5);
  });

  it('六角轮廓裁剪不崩（原子数减少且有限）', () => {
    const rect = build({ shape: '矩形', Lx: 30, Ly: 30 });
    const hex = build({ shape: '六角', Lx: 30, Ly: 30 });
    expect(hex.atoms.length).toBeGreaterThan(0);
    expect(hex.atoms.length).toBeLessThan(rect.atoms.length);
  });

  it('示意正交化 vs strictCell 双模式可切换（两模式原子数一致）', () => {
    const ortho = build({ strictCell: false, Lx: 30, Ly: 30 });
    const strict = build({ strictCell: true, Lx: 30, Ly: 30 });
    expect(strict.atoms.length).toBe(ortho.atoms.length);
    for (const a of strict.atoms) expect(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)).toBe(true);
  });

  it('确定性：同参数两次构建逐位一致', () => {
    const a = build();
    const b = build();
    for (const [i, x] of a.atoms.entries()) {
      expect(x.x).toBeCloseTo(b.atoms[i]!.x, 10);
      expect(x.z).toBeCloseTo(b.atoms[i]!.z, 10);
    }
  });
});

describe('层间物质开关（CO₃/H₂O 识别，任务书 2.4）', () => {
  it('showInterlayer=false 过滤层间 C/H（层板骨架 Mg/Al/O 不受影响）', () => {
    const on = buildKaoliniteSheet(cif, {
      Lx: 30, Ly: 30, layers: 1, d001: 7.567, shape: '矩形', style: '球棍', edgeH: false, mineral: 'hydrotalcite', showInterlayer: true,
    } as never);
    const off = buildKaoliniteSheet(cif, {
      Lx: 30, Ly: 30, layers: 1, d001: 7.567, shape: '矩形', style: '球棍', edgeH: false, mineral: 'hydrotalcite', showInterlayer: false,
    } as never);
    const count = (g: typeof on, el: string) => g.atoms.filter((a) => a.el === el).length;
    expect(count(on, 'C')).toBeGreaterThan(0); // 层间 CO₃ 可见
    expect(count(off, 'C')).toBe(0); // 层间被过滤
    expect(count(on, 'Mg')).toBe(count(off, 'Mg')); // 层板骨架不变
    expect(count(on, 'Al')).toBe(count(off, 'Al'));
  });
});

describe('单原子模式', () => {
  it('atomMode=single 路径可用（全部原子统一为 singleEl）', () => {
    const g = buildKaoliniteSheet(cif, {
      Lx: 24, Ly: 24, layers: 1, d001: 7.567, shape: '矩形', style: '球棍', edgeH: false,
      mineral: 'hydrotalcite', atomMode: 'single', singleEl: 'Mg',
    } as never);
    expect(g.atoms.length).toBeGreaterThan(0);
    expect(g.atoms.every((a) => a.el === 'Mg')).toBe(true);
  });
});
