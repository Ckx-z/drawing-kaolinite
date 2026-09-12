/**
 * 单原子层数（2026-09-10）验收测试
 *
 * 语义（用户确认）：单原子模式下只显示前 N 层单原子层（其余层不生成），
 * 每层是完整晶体学层（z 间隔 d001）可区分；默认 N=全部层（旧行为不变）。
 *
 * 覆盖：buildSlab 层标记与 groupByLayer、1 层/多层/超界 clamp、旧参数默认
 * 兼容、管（壁层数）卷曲后层保留、schema 校验、颗粒不引入该参数、撤销重做。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHalloysiteTube, buildKaoliniteSheet } from './builders';
import { groupByLayer } from './crystal';
import { packedLayerParamsSchema, particleParamsSchema, sheetParamsSchema, tubeParamsSchema } from './schema';
import { attachHistory } from '../state/history';
import { createSceneStore } from '../state/sceneStore';

const CIF = readFileSync(new URL('../../data/kaolinite.cif', import.meta.url), 'utf8');

/** 60×50Å 基线参数（与 kernel.test.ts 同款；layers/atomMode 由用例覆写） */
const SHEET_BASE = {
  Lx: 60,
  Ly: 50,
  d001: 7.4,
  shape: '矩形',
  style: '空间填充',
  edgeH: false,
  strictCell: false,
  singleEl: 'Fe',
} as const;

const sheet = (over: Record<string, unknown>) =>
  buildKaoliniteSheet(CIF, { ...SHEET_BASE, layers: 1, atomMode: 'full', ...over } as never);

const TUBE_BASE = {
  innerR: 14,
  length: 90,
  d001: 7.4,
  progress: 1,
  taperDeg: 0,
  style: '空间填充',
  curlAxis: 'a',
  portNoise: 0,
  singleEl: 'Si',
} as const;

const tube = (over: Record<string, unknown>) =>
  buildHalloysiteTube(CIF, { ...TUBE_BASE, walls: 1, atomMode: 'full', ...over } as never);

describe('层标记与 groupByLayer（内核层感知）', () => {
  it('buildSlab 片层 3 层 → 3 桶且每桶原子数相等、z 均值递增', () => {
    const g = sheet({ layers: 3 });
    const layers = groupByLayer(g.atoms);
    expect(layers).toHaveLength(3);
    expect(layers[1]!.length).toBe(layers[0]!.length);
    expect(layers[2]!.length).toBe(layers[0]!.length);
    const zMean = (as: typeof g.atoms) => as.reduce((s, a) => s + a.z, 0) / as.length;
    expect(zMean(layers[0]!)).toBeLessThan(zMean(layers[1]!));
    expect(zMean(layers[1]!)).toBeLessThan(zMean(layers[2]!));
    // 层间距 ≈ d001（z 均值差在层厚尺度内即可，不逐位断言）
    expect(zMean(layers[1]!) - zMean(layers[0]!)).toBeGreaterThan(5);
  });

  it('羟基 H 随所属氧的层（每桶含 H）', () => {
    const g = sheet({ layers: 2 });
    for (const bucket of groupByLayer(g.atoms)) {
      expect(bucket.some((a) => a.el === 'H')).toBe(true);
    }
  });

  it('无 layer 标记的原子（分子/颗粒风格）归第 0 桶', () => {
    const buckets = groupByLayer([
      { el: 'O', x: 0, y: 0, z: 0 },
      { el: 'H', x: 1, y: 0, z: 0 },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toHaveLength(2);
  });

  it('管卷曲后壁层标记保留（walls=2 → 2 桶）', () => {
    const g = tube({ walls: 2 });
    expect(groupByLayer(g.atoms)).toHaveLength(2);
  });
});

describe('单原子层数：前 N 层单原子（sheet）', () => {
  it('1 层：single + layers=3 + singleLayers=1 → 原子数与 full 单层一致，全为 singleEl', () => {
    const g = sheet({ layers: 3, atomMode: 'single', singleLayers: 1 });
    const full1 = sheet({ layers: 1 });
    expect(g.atoms).toHaveLength(full1.atoms.length);
    expect(g.atoms.every((a) => a.el === 'Fe')).toBe(true);
    expect(groupByLayer(g.atoms)).toHaveLength(1);
  });

  it('多层：singleLayers=2 → 原子数与 full 双层一致，2 桶可区分', () => {
    const g = sheet({ layers: 3, atomMode: 'single', singleLayers: 2 });
    const full2 = sheet({ layers: 2 });
    expect(g.atoms).toHaveLength(full2.atoms.length);
    expect(g.atoms.every((a) => a.el === 'Fe')).toBe(true);
    const layers = groupByLayer(g.atoms);
    expect(layers).toHaveLength(2);
    expect(layers[1]!.length).toBe(layers[0]!.length); // 完整晶体学层，非合并塌层
  });

  it('超界 clamp：layers=1 + singleLayers=3 → 1 层（安全处理，不报错）', () => {
    const g = sheet({ layers: 1, atomMode: 'single', singleLayers: 3 });
    expect(groupByLayer(g.atoms)).toHaveLength(1);
  });

  it('旧参数缺 singleLayers → 按"全部层"处理（=旧行为）', () => {
    const g = sheet({ layers: 2, atomMode: 'single' }); // 字面量不带 singleLayers
    const full2 = sheet({ layers: 2 });
    expect(g.atoms).toHaveLength(full2.atoms.length);
    expect(g.atoms.every((a) => a.el === 'Fe')).toBe(true);
  });
});

describe('单原子层数：管（walls）', () => {
  it('walls=2 + singleLayers=1 → 原子数 = full 单壁，1 桶', () => {
    const g = tube({ walls: 2, atomMode: 'single', singleLayers: 1 });
    const full1 = tube({ walls: 1 });
    expect(g.atoms).toHaveLength(full1.atoms.length);
    expect(g.atoms.every((a) => a.el === 'Si')).toBe(true);
    expect(groupByLayer(g.atoms)).toHaveLength(1);
  });

  it('singleLayers=2（=walls）→ 与 full 双壁原子数一致（默认全层语义）', () => {
    const g = tube({ walls: 2, atomMode: 'single', singleLayers: 2 });
    const full2 = tube({ walls: 2 });
    expect(g.atoms).toHaveLength(full2.atoms.length);
  });
});

describe('schema 校验与兼容', () => {
  const sheetInput = {
    Lx: 60, Ly: 50, layers: 3, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false,
  } as const;

  it('singleLayers 取整 1–3 合法；0/负/非整/4 拒绝', () => {
    for (const ok of [1, 2, 3]) {
      expect(sheetParamsSchema.safeParse({ ...sheetInput, singleLayers: ok }).success).toBe(true);
    }
    for (const bad of [0, -1, 1.5, 4]) {
      const r = sheetParamsSchema.safeParse({ ...sheetInput, singleLayers: bad });
      expect(r.success, `singleLayers=${bad} 应被拒绝`).toBe(false);
    }
    const tubeInput = {
      innerR: 14, length: 90, walls: 3, d001: 7.4, progress: 1, taperDeg: 0, style: '空间填充',
    } as const;
    expect(tubeParamsSchema.safeParse({ ...tubeInput, singleLayers: 2 }).success).toBe(true);
    expect(tubeParamsSchema.safeParse({ ...tubeInput, singleLayers: 4 }).success).toBe(false);
  });

  it('旧场景缺键 → default 补 3（意图"全部层"）', () => {
    const parsed = sheetParamsSchema.parse(sheetInput);
    expect(parsed.singleLayers).toBe(3);
  });

  it('元素校验收紧（2026-09-12）：真实元素合法、非元素串拒绝', () => {
    const sheetBase = { Lx: 60, Ly: 50, layers: 3, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false };
    for (const ok of ['Au', 'Pt', 'W', 'Nd']) {
      expect(sheetParamsSchema.safeParse({ ...sheetBase, singleEl: ok }).success, `singleEl=${ok} 应合法`).toBe(true);
    }
    for (const bad of ['Zz', 'Xx', 'DD']) {
      expect(sheetParamsSchema.safeParse({ ...sheetBase, singleEl: bad }).success, `singleEl=${bad} 应拒绝`).toBe(false);
    }
    const packedBase = { n: 5, layers: 2, dist: 4, stacking: 'AB', mask: '' };
    expect(packedLayerParamsSchema.safeParse({ ...packedBase, el: 'Au' }).success).toBe(true);
    expect(packedLayerParamsSchema.safeParse({ ...packedBase, el: 'Zz' }).success).toBe(false);
  });

  it('颗粒不引入 singleLayers（strictObject 拒绝未知键，锁定无层语义）', () => {
    const r = particleParamsSchema.safeParse({
      radius: 9, grains: 160, seed: 7, mode: '簇装', singleLayers: 2,
    });
    expect(r.success).toBe(false);
  });
});

describe('撤销/重做（updateParams 快照含新参数）', () => {
  it('singleLayers 2→1 → undo 恢复 2', () => {
    const store = createSceneStore();
    // 递增时钟：确保连续 updateParams 不落入合并窗口（mergeWindowMs=0 时同毫秒仍合并）
    let tick = 0;
    const history = attachHistory(store, { mergeWindowMs: 0, now: () => ++tick });
    const id = store.getState().addComponent('kaolinite_sheet');
    store.getState().updateParams(id, { layers: 3, atomMode: 'single', singleLayers: 2 });
    store.getState().updateParams(id, { singleLayers: 1 });
    expect(store.getState().components[0]!.params).toMatchObject({ singleLayers: 1 });
    history.undo();
    expect(store.getState().components[0]!.params).toMatchObject({ singleLayers: 2 });
  });
});
