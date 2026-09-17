import { describe, expect, it } from 'vitest';
import { filterLib, GROUP_ORDER, groupParams, LIB, PARAM_DEFS, type ParamDef } from './paramDefs';

/** 参数分组（2026-09-16 渐进式展示）：字段无遗漏、组序正确、缺省归基础 */
describe('groupParams', () => {
  it('每类组件：分组后字段总数与原定义一致（无遗漏无重复）', () => {
    for (const [type, defs] of Object.entries(PARAM_DEFS)) {
      const groups = groupParams(defs);
      const flat = groups.flatMap((g) => g.defs);
      expect(flat.length, `${type} 分组后字段数应等于原定义`).toBe(defs.length);
      expect(new Set(flat.map((d) => d.key)).size, `${type} 无重复字段`).toBe(defs.length);
    }
  });

  it('组序遵循 GROUP_ORDER；缺省 group 归"基础"', () => {
    const groups = groupParams([{ key: 'x' } as ParamDef, { key: 'y', group: '高级' } as ParamDef]);
    expect(groups.map((g) => g.name)).toEqual(['基础', '高级']);
    expect(groups[0]!.defs.map((d) => d.key)).toEqual(['x']);
    // 空组不出现
    expect(groupParams([{ key: 'a', group: '显示' } as ParamDef]).map((g) => g.name)).toEqual(['显示']);
  });

  it('片层：晶体结构（d001/矿物）与高级（edgeH/strictCell）正确成组', () => {
    const groups = groupParams(PARAM_DEFS.kaolinite_sheet);
    const byName = Object.fromEntries(groups.map((g) => [g.name, g.defs.map((d) => d.key)]));
    expect(byName['基础']).toContain('Lx');
    expect(byName['晶体结构']).toEqual(expect.arrayContaining(['d001', 'mineral']));
    expect(byName['高级']).toEqual(expect.arrayContaining(['edgeH', 'strictCell']));
    expect(byName['显示']).toEqual(expect.arrayContaining(['atomMode', 'singleEl', 'singleLayers', 'showInterlayer']));
  });

  it('管：形貌组含卷曲进度；基础在首（默认展开组）', () => {
    const groups = groupParams(PARAM_DEFS.halloysite_tube);
    expect(groups[0]!.name).toBe('基础');
    const morph = groups.find((g) => g.name === '形貌');
    expect(morph?.defs.map((d) => d.key)).toContain('progress');
  });

  it('基底全部基础（单组）；颗粒高级组含 grains/seed', () => {
    expect(groupParams(PARAM_DEFS.rubber_substrate)).toHaveLength(1);
    expect(groupParams(PARAM_DEFS.rubber_substrate)[0]!.name).toBe('基础');
    const adv = groupParams(PARAM_DEFS.nanoparticle).find((g) => g.name === '高级');
    expect(adv?.defs.map((d) => d.key)).toEqual(expect.arrayContaining(['grains', 'seed']));
  });

  it('GROUP_ORDER：基础恒在首位（渐进式默认展开组）', () => {
    expect(GROUP_ORDER[0]).toBe('基础');
  });
});

describe('filterLib（素材搜索）', () => {
  it('中文名/英文副标题/说明包含匹配，不区分大小写；空查询全量', () => {
    expect(filterLib(LIB, '')).toHaveLength(LIB.length);
    expect(filterLib(LIB, '埃洛石').map((i) => i.type)).toEqual(['halloysite_tube']);
    expect(filterLib(LIB, 'halloysite').map((i) => i.type)).toEqual(['halloysite_tube']);
    expect(filterLib(LIB, '密排').map((i) => i.type)).toEqual(['packed_layers']);
    expect(filterLib(LIB, 'zzz')).toEqual([]);
    // 返回副本（不改原数组引用语义）
    expect(filterLib(LIB, '')).not.toBe(LIB);
  });
});
