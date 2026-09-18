/**
 * 莫来石（第六矿物）验收测试 —— 2026-09-17
 *
 * 数据源：COD 2310785（Birkenstock, Petříček, Pedersen, Schneider, Fischer,
 * "The modulated average structure of mullite", Acta Cryst. B71 (2015) 358,
 * doi:10.1107/S205252061500757X）——3:2 区固溶体平均结构，Pbam（No.55）。
 *
 * 覆盖：CIF 解析（晶胞/显式对称操作/零占位位点剔除/分裂位保留）、
 * 位点多重性与化学计量声明、中英文搜索直达、schema 放宽边界与管组件排除、
 * 1–3 层切片线性、分裂位同点原子不产生退化键。
 */
import { describe, expect, it } from 'vitest';
import { buildKaoliniteSheet } from './builders';
import { expandSymmetry, groupByLayer, parseCIF } from './crystal';
import { findMineral, MINERALS } from './minerals';
import { sheetParamsSchema, tubeParamsSchema } from './schema';

const cif = MINERALS.mullite.cifText;

const sheet = (over: Record<string, unknown> = {}) =>
  buildKaoliniteSheet(cif, {
    Lx: 32,
    Ly: 32,
    layers: 1,
    d001: 2.89,
    shape: '矩形',
    style: '球棍',
    edgeH: false,
    mineral: 'mullite',
    ...over,
  } as never);

describe('莫来石 CIF 解析（COD 2310785 平均结构）', () => {
  const parsed = parseCIF(cif);

  it('晶胞与 CIF 声明一致（Pbam 正交）', () => {
    expect(parsed.cell.a).toBeCloseTo(7.5911, 3);
    expect(parsed.cell.b).toBeCloseTo(7.6924, 3);
    expect(parsed.cell.c).toBeCloseTo(2.8899, 3);
    expect(parsed.cell.alpha).toBe(90);
    expect(parsed.cell.beta).toBe(90);
    expect(parsed.cell.gamma).toBe(90);
  });

  it('显式对称操作 8 个；零占位位点 Si3 不解析为原子', () => {
    expect(parsed.symops).toHaveLength(8);
    const labels = parsed.atoms.map((a) => a.label);
    expect(labels).toHaveLength(8); // 9 行位点 − 1 零占位（Si3 occupancy = 0）
    expect(labels).not.toContain('Si3');
    expect(labels).toContain('Si2'); // 分裂位双组分保留
  });

  it('对称展开位点多重性与 CIF 声明一致', () => {
    const expanded = expandSymmetry(parsed.atoms, parsed.symops);
    const byLabel: Record<string, number> = {};
    for (const a of expanded) byLabel[a.label] = (byLabel[a.label] ?? 0) + 1;
    expect(byLabel).toEqual({ Al1: 2, Al2: 4, Si2: 4, Al3: 4, O1: 4, O2: 4, O3: 2, O4: 4 });
    expect(expanded).toHaveLength(28);
  });

  it('渲染位点集元素统计 Al10Si4O14；注册表化学式 = CIF 声明值', () => {
    // 分裂位（Al2+Si2）与部分占位（Al3/O3/O4）按位点全显示——与蒙脱石 Ca0.5 先例
    // 一致；部分占位无法用整数原子精确表示，真实化学式以 formula 字段声明
    const by: Record<string, number> = {};
    for (const a of expandSymmetry(parsed.atoms, parsed.symops)) by[a.el] = (by[a.el] ?? 0) + 1;
    expect(by).toEqual({ Al: 10, Si: 4, O: 14 });
    expect(MINERALS.mullite.formula).toBe('Al4.8Si1.2O9.6');
  });

  it('Al2/Si2 分裂位双组分同坐标（平均结构特征，渲染互不闪烁）', () => {
    const expanded = expandSymmetry(parsed.atoms, parsed.symops);
    const al2 = expanded.filter((a) => a.label === 'Al2');
    const si2 = expanded.filter((a) => a.label === 'Si2');
    expect(si2).toHaveLength(4);
    for (const s of si2) {
      const coincide = al2.some(
        (a) => Math.abs(a.fx - s.fx) < 1e-6 && Math.abs(a.fy - s.fy) < 1e-6 && Math.abs(a.fz - s.fz) < 1e-6,
      );
      expect(coincide, `Si2(${s.fx},${s.fy},${s.fz}) 应与某 Al2 同坐标`).toBe(true);
    }
  });
});

describe('莫来石注册与搜索', () => {
  it('中文/英文/大小写/前缀四路直达', () => {
    expect(findMineral('莫来石')?.key).toBe('mullite');
    expect(findMineral('mullite')?.key).toBe('mullite');
    expect(findMineral('Mullite')?.key).toBe('mullite');
    expect(findMineral('Mull')?.key).toBe('mullite'); // ≥4 字符前缀
  });

  it('非层状标记：layered=false、无层间物种、d001 默认 = c 轴周期', () => {
    expect(MINERALS.mullite.layered).toBe(false);
    expect(MINERALS.mullite.interlayer).toEqual([]);
    expect(MINERALS.mullite.d001Default).toBeCloseTo(2.89, 2);
  });

  it('片层 schema 接受莫来石（d001 2.89 在放宽后边界内；2.0 仍越界）', () => {
    const p = sheetParamsSchema.parse({
      Lx: 32, Ly: 32, layers: 1, d001: 2.89, shape: '矩形', style: '球棍', edgeH: false, mineral: 'mullite',
    });
    expect(p.mineral).toBe('mullite');
    expect(() =>
      sheetParamsSchema.parse({ Lx: 32, Ly: 32, layers: 1, d001: 2.0, shape: '矩形', style: '球棍', edgeH: false }),
    ).toThrow();
  });

  it('管组件 schema 不含莫来石（骨架结构不可卷管）', () => {
    expect(() =>
      tubeParamsSchema.parse({ innerR: 14, length: 90, walls: 1, d001: 7.4, progress: 1, taperDeg: 0, style: '球棍', mineral: 'mullite' }),
    ).toThrow();
  });
});

describe('莫来石片层切片（骨架矿物沿 c 堆叠）', () => {
  it.each([1, 2, 3])('%s 层原子数线性缩放（28×na×nb×nc）且带层标记', (nc) => {
    const g = sheet({ layers: nc });
    // na = round(32/7.5911) = 4，nb = round(32/7.6924) = 4 → 每层 28×16 = 448
    expect(g.atoms).toHaveLength(28 * 16 * nc);
    expect(groupByLayer(g.atoms)).toHaveLength(nc);
    for (const a of g.atoms) {
      expect(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)).toBe(true);
    }
  });

  it('无退化键：分裂位同点原子对不成键，最短键长 > 0.5 Å', () => {
    const g = sheet();
    expect(g.bonds.length).toBeGreaterThan(0);
    let minLen = Infinity;
    for (const [i, j] of g.bonds) {
      const a = g.atoms[i]!;
      const b = g.atoms[j]!;
      minLen = Math.min(minLen, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    expect(minLen).toBeGreaterThan(0.5);
  });

  it('六角轮廓裁剪不崩溃（原子数减少且坐标有限）', () => {
    const g = sheet({ shape: '六角', Lx: 60, Ly: 60 });
    expect(g.atoms.length).toBeGreaterThan(0);
    expect(g.atoms.length).toBeLessThan(28 * 8 * 8); // 对比同尺寸矩形（na=nb=8），裁掉角部
    for (const a of g.atoms) expect(Number.isFinite(a.x)).toBe(true);
  });

  it('空间填充风格与单原子模式路径可用', () => {
    const full = sheet({ style: '空间填充' });
    expect(full.atoms.length).toBe(28 * 16);
    const single = sheet({ atomMode: 'single', singleEl: 'Al' });
    expect(single.atoms.every((a) => a.el === 'Al')).toBe(true);
  });
});
