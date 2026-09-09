import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../core/schema';
import { COMPONENT_TYPES } from '../core/schema';
import { PARAM_DEFS } from './paramDefs';

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

  it('数字型参数：默认值落在 [min, max] 内', () => {
    for (const t of COMPONENT_TYPES) {
      for (const def of PARAM_DEFS[t]) {
        if (def.type !== undefined) continue; // select/checkbox/toggle 非数字滑块
        const v = (DEFAULT_PARAMS[t] as Record<string, number>)[def.key];
        expect(v, `${t}.${def.key} 默认值缺失`).toBeDefined();
        expect(v, `${t}.${def.key}=${v} 低于 min=${def.min}`).toBeGreaterThanOrEqual(def.min ?? -Infinity);
        expect(v, `${t}.${def.key}=${v} 高于 max=${def.max}`).toBeLessThanOrEqual(def.max ?? Infinity);
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
        expect(def.options, `${t}.${def.key} 默认值 ${v} 不在选项中`).toContain(v);
      }
    }
  });

  it('卷曲进度滑块有百分比显示格式', () => {
    const progress = PARAM_DEFS.halloysite_tube.find((d) => d.key === 'progress');
    expect(progress?.disp?.(0.45)).toBe('45%');
  });
});
