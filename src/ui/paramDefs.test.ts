import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../core/schema';
import { COMPONENT_TYPES } from '../core/schema';
import { PARAM_DEFS } from './paramDefs';

/** 边界解析（与 ParamPanel RangeControl 同规则）：函数型随当前参数求值 */
const bound = (b: number | ((p: Record<string, unknown>) => number) | undefined, p: Record<string, unknown>, fallback: number): number =>
  typeof b === 'function' ? b(p) : (b ?? fallback);

/**
 * 防呆守护：每个数字型参数定义的默认值必须落在 [min, max] 内，
 * 且 select 型定义的选项必须包含当前默认值——防止面板与 schema 漂移。
 */
describe('PARAM_DEFS 与 DEFAULT_PARAMS/schema 一致性', () => {
  it('五类组件均有参数定义', () => {
    for (const t of COMPONENT_TYPES) {
      expect(PARAM_DEFS[t].length, `${t} 缺少参数定义`).toBeGreaterThan(0);
    }
  });

  it('数字型参数：默认值落在 [min, max] 内（含动态边界）', () => {
    for (const t of COMPONENT_TYPES) {
      const params = DEFAULT_PARAMS[t] as Record<string, unknown>;
      for (const def of PARAM_DEFS[t]) {
        if (def.type !== undefined) continue; // select/checkbox/toggle 非数字滑块
        const v = params[def.key] as number;
        expect(v, `${t}.${def.key} 默认值缺失`).toBeDefined();
        const min = bound(def.min, params, -Infinity);
        const max = bound(def.max, params, Infinity);
        expect(v, `${t}.${def.key}=${v} 低于 min=${min}`).toBeGreaterThanOrEqual(min);
        if (typeof def.max === 'function') {
          // 动态上限键（singleLayers）：默认值是"全部层"哨兵 3，可能超过当前动态上限
          // （如默认 layers=1）——超界由 RangeControl 钳制显示 + builder clamp，此处只守 schema 静态上限
          expect(v, `${t}.${def.key}=${v} 超过 schema 静态上限`).toBeLessThanOrEqual(3);
        } else {
          expect(v, `${t}.${def.key}=${v} 高于 max=${max}`).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('toggle 型参数：on/off 值均合法且默认值为其一', () => {
    for (const t of COMPONENT_TYPES) {
      for (const def of PARAM_DEFS[t]) {
        if (def.type !== 'toggle') continue;
        expect(def.on, `${t}.${def.key} 缺少 on`).toBeDefined();
        expect(def.off, `${t}.${def.key} 缺少 off`).toBeDefined();
        const v = (DEFAULT_PARAMS[t] as Record<string, string>)[def.key];
        expect([def.on, def.off], `${t}.${def.key} 默认值 ${v} 不是 on/off 之一`).toContain(v);
      }
    }
  });

  it('select 型参数：默认值在选项列表中', () => {
    for (const t of COMPONENT_TYPES) {
      for (const def of PARAM_DEFS[t]) {
        if (def.type !== 'select') continue;
        const v = (DEFAULT_PARAMS[t] as Record<string, string>)[def.key];
        expect(def.options, `${t}.${def.key} 缺少 options`).toBeDefined();
        const vals = def.options!.map((op) => (typeof op === 'string' ? op : op.value));
        expect(vals, `${t}.${def.key} 默认值 ${v} 不在选项中`).toContain(v);
      }
    }
  });

  it('卷曲进度滑块有百分比显示格式', () => {
    const progress = PARAM_DEFS.halloysite_tube.find((d) => d.key === 'progress');
    expect(progress?.disp?.(0.45)).toBe('45%');
  });

  it('单原子层数滑块：片层/管有且上限随堆叠/壁层数动态，颗粒无', () => {
    const sheetDef = PARAM_DEFS.kaolinite_sheet.find((d) => d.key === 'singleLayers');
    expect(sheetDef, '片层应有单原子层数控件').toBeDefined();
    expect(sheetDef!.when?.({ atomMode: 'full' } as never)).toBe(false); // 仅 single 模式显示
    expect(sheetDef!.when?.({ atomMode: 'single' } as never)).toBe(true);
    const maxOf = sheetDef!.max as (p: Record<string, unknown>) => number;
    expect(maxOf({ layers: 1 })).toBe(1);
    expect(maxOf({ layers: 3 })).toBe(3);

    const tubeDef = PARAM_DEFS.halloysite_tube.find((d) => d.key === 'singleLayers');
    expect(tubeDef, '管应有单原子层数控件').toBeDefined();
    expect((tubeDef!.max as (p: Record<string, unknown>) => number)({ walls: 2 })).toBe(2);

    expect(
      PARAM_DEFS.nanoparticle.find((d) => d.key === 'singleLayers'),
      '颗粒无层结构，不应有单原子层数控件',
    ).toBeUndefined();
  });

  it('元素下拉扩全周期表（2026-09-12：密排层 el 与单原子 singleEl 共用 118 项）', () => {
    const elDef = PARAM_DEFS.packed_layers.find((d) => d.key === 'el');
    expect(elDef!.options).toHaveLength(118);
    const vals = elDef!.options!.map((op) => (typeof op === 'string' ? op : op.value));
    for (const sym of ['Si', 'Au', 'Pt', 'W', 'La', 'Nd', 'U', 'Og']) {
      expect(vals, `密排层元素下拉应含 ${sym}`).toContain(sym);
    }
    // 显示为 "符号 中文名"（对象选项 label）
    const au = elDef!.options!.find((op) => typeof op !== 'string' && op.value === 'Au') as { value: string; label: string };
    expect(au.label).toBe('Au 金');
    // 单原子元素（片层）共用同一来源
    const singleElDef = PARAM_DEFS.kaolinite_sheet.find((d) => d.key === 'singleEl');
    expect(singleElDef!.options).toHaveLength(118);
  });
});
