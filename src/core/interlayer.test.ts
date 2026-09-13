import { describe, expect, it } from 'vitest';
import { buildKaoliniteSheet } from './builders';
import { MINERALS, mineralOf } from './minerals';

const els = (atoms: Array<{ el: string }>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const a of atoms) out[a.el] = (out[a.el] ?? 0) + 1;
  return out;
};

/** T-2.4 层间物种开关：注册表元素集驱动（伊利石 K、蒙脱石 Ca/Na） */
describe('showInterlayer 层间物种开关', () => {
  it('注册表：伊利石 K、蒙脱石 Ca/Na、高岭石族无', () => {
    expect(MINERALS.illite.interlayer).toEqual(['K']);
    expect(MINERALS.montmorillonite.interlayer).toEqual(['Ca', 'Na']);
    expect(MINERALS.kaolinite.interlayer).toEqual([]);
    expect(mineralOf('illite').interlayer).toContain('K');
  });

  it('伊利石：关闭 → 无 K；开启 → 含 K', () => {
    const base = { Lx: 30, Ly: 30, layers: 1, d001: 20.14, shape: '矩形', style: '空间填充', edgeH: false, mineral: 'illite' } as Parameters<typeof buildKaoliniteSheet>[1];
    const off = buildKaoliniteSheet(MINERALS.illite.cifText, { ...base, showInterlayer: false });
    const on = buildKaoliniteSheet(MINERALS.illite.cifText, { ...base, showInterlayer: true });
    expect(els(off.atoms).K ?? 0).toBe(0);
    expect(els(on.atoms).K ?? 0).toBeGreaterThan(0);
    expect(off.atoms.length).toBe(on.atoms.length - (els(on.atoms).K ?? 0));
  });

  it('蒙脱石：关闭 → 无 Ca', () => {
    const base = { Lx: 30, Ly: 30, layers: 1, d001: 15.0, shape: '矩形', style: '空间填充', edgeH: false, mineral: 'montmorillonite' } as Parameters<typeof buildKaoliniteSheet>[1];
    const off = buildKaoliniteSheet(MINERALS.montmorillonite.cifText, { ...base, showInterlayer: false });
    const on = buildKaoliniteSheet(MINERALS.montmorillonite.cifText, base);
    expect(els(off.atoms).Ca ?? 0).toBe(0);
    expect(els(on.atoms).Ca ?? 0).toBeGreaterThan(0);
  });

  it('高岭石：开关无效果（无层间物种，原子数不变）', () => {
    const base = { Lx: 30, Ly: 30, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false, mineral: 'kaolinite' } as Parameters<typeof buildKaoliniteSheet>[1];
    const off = buildKaoliniteSheet(MINERALS.kaolinite.cifText, { ...base, showInterlayer: false });
    const on = buildKaoliniteSheet(MINERALS.kaolinite.cifText, base);
    expect(off.atoms.length).toBe(on.atoms.length);
  });
});
