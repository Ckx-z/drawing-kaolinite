/**
 * 密排原子层（packed_layers，2026-09-10）验收测试
 *
 * 覆盖：几何基线（层数×格点/层间距/AB-ABC 错位）、掩码语义（不参与 =
 * 只保留第一层 → 上层凹陷）、层标记、schema 校验、worker 分发、确定性。
 */
import { describe, expect, it } from 'vitest';
import { buildPackedLayers } from './builders';
import { groupByLayer } from './crystal';
import { DEFAULT_PARAMS, packedLayerParamsSchema, sceneDocumentSchema } from './schema';
import { computeGeometry } from './worker';
import type { PackedLayerParams } from './types';

const P = (over: Partial<PackedLayerParams> = {}): PackedLayerParams => ({
  el: 'Si', n: 3, layers: 3, dist: 4, stacking: 'AB', mask: '',
  ...over,
});

describe('几何基线', () => {
  it('全参与：原子数 = 层数 × n²（n=3 三层 → 27）', () => {
    expect(buildPackedLayers(P()).atoms).toHaveLength(27);
    expect(buildPackedLayers(P({ layers: 1 })).atoms).toHaveLength(9);
    expect(buildPackedLayers(P({ n: 5, layers: 4 })).atoms).toHaveLength(100);
  });

  it('层间距 = √(2/3)·dist（理想密堆积）', () => {
    const g = buildPackedLayers(P({ n: 4, layers: 3 }));
    const layers = groupByLayer(g.atoms);
    expect(layers).toHaveLength(3);
    const zMean = (as: typeof g.atoms) => as.reduce((s, a) => s + a.z, 0) / as.length;
    const h = Math.sqrt(2 / 3) * 4;
    expect(zMean(layers[1]!) - zMean(layers[0]!)).toBeCloseTo(h, 6);
    expect(zMean(layers[2]!) - zMean(layers[1]!)).toBeCloseTo(h, 6);
  });

  it('AB：第三层回 A 位正上方（HCP）；ABC：三层错位（FCC）', () => {
    const ab = buildPackedLayers(P());
    const [a0, a1, a2] = groupByLayer(ab.atoms);
    // 第 0/2 层同位（ABAB）：取每层 x 最小原子，水平位置一致
    const minX = (as: typeof a0) => Math.min(...as.map((v) => v.x));
    expect(minX(a2!)).toBeCloseTo(minX(a0!), 9);
    expect(minX(a1!)).toBeCloseTo(minX(a0!) + 2, 9); // B 位偏移 dist/2

    const abc = buildPackedLayers(P({ stacking: 'ABC' }));
    const [b0, b1, b2] = groupByLayer(abc.atoms);
    expect(minX(b1!)).toBeCloseTo(minX(b0!) + 2, 9); // B 偏移 d/2
    expect(minX(b2!)).not.toBeCloseTo(minX(b0!), 9); // C 不回 A 位
    // C 偏移 = (d, √3d/3)：x 方向至少偏 d（格点 x 集合的比较）
    expect(minX(b2!)).toBeCloseTo(minX(b0!) + 4, 9);
  });

  it('层内三角密排：最近邻距 = dist', () => {
    const g = buildPackedLayers(P({ n: 4, layers: 1 }));
    const a0 = g.atoms[0]!;
    const dists = g.atoms.slice(1).map((v) => Math.hypot(v.x - a0.x, v.y - a0.y, v.z - a0.z));
    expect(Math.min(...dists)).toBeCloseTo(4, 9);
  });

  it('确定性：同参两次构建逐位一致', () => {
    const a = buildPackedLayers(P({ n: 6, layers: 5, mask: '0110' }));
    const b = buildPackedLayers(P({ n: 6, layers: 5, mask: '0110' }));
    expect(b).toEqual(a);
  });
});

describe('掩码：每原子"是否参与堆叠"', () => {
  it('不参与的原子只保留第一层（上层减少、第一层不变）', () => {
    const full = buildPackedLayers(P({ n: 5, layers: 4 }));
    // 关闭第一层中心原子（索引 12）与角原子（索引 0）
    const mask = Array.from({ length: 25 }, (_, i) => (i === 12 || i === 0 ? '0' : '1')).join('');
    const gated = buildPackedLayers(P({ n: 5, layers: 4, mask }));
    const layers = groupByLayer(gated.atoms);
    expect(layers).toHaveLength(4);
    expect(layers[0]).toHaveLength(25); // 第一层完整底座
    expect(gated.atoms.length).toBeLessThan(full.atoms.length);
    expect(layers[1]!.length).toBeLessThan(25); // 上层凹陷
    // 全 0 → 只有第一层
    const none = buildPackedLayers(P({ n: 3, layers: 4, mask: '0'.repeat(9) }));
    expect(none.atoms).toHaveLength(9);
  });

  it('掩码缺省/越界位 = 参与（n 调整后旧掩码安全）', () => {
    // 单字符掩码用于 n=3（语义 9 位）：后 8 位缺省参与，只关索引 0
    const g = buildPackedLayers(P({ n: 3, layers: 2, mask: '0' }));
    const layers = groupByLayer(g.atoms);
    expect(layers[0]).toHaveLength(9);
    expect(layers[1]!.length).toBe(9 - 1); // 只有索引 0 的归属格点被裁
  });
});

describe('schema 与分发', () => {
  it('默认参数过 parse 且 DEFAULT_PARAMS 一致', () => {
    const parsed = packedLayerParamsSchema.parse({});
    expect(parsed).toMatchObject({ el: 'Si', n: 7, layers: 3, dist: 4, stacking: 'AB', mask: '' });
    expect(DEFAULT_PARAMS.packed_layers).toMatchObject(parsed);
  });

  it('越界/非法拒绝：n=1/13、layers=0/9、dist 越界、mask 含 2、el 格式', () => {
    for (const bad of [
      { n: 1 }, { n: 13 }, { layers: 0 }, { layers: 9 }, { dist: 1 }, { dist: 9 },
      { mask: '012' }, { el: 'sI' }, { stacking: 'ABA' as never },
    ]) {
      const r = packedLayerParamsSchema.safeParse({ ...DEFAULT_PARAMS.packed_layers, ...bad });
      expect(r.success, `params ${JSON.stringify(bad)} 应被拒绝`).toBe(false);
    }
    expect(packedLayerParamsSchema.safeParse({ ...DEFAULT_PARAMS.packed_layers, mask: ''.padEnd(144, '1') }).success).toBe(true);
  });

  it('场景文档往返含 packed_layers（含掩码）', () => {
    const doc = {
      format: 'kaolin-scene/v1',
      saved: new Date().toISOString(),
      components: [
        {
          type: 'packed_layers',
          name: '密排原子层 1',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
          params: { ...DEFAULT_PARAMS.packed_layers, mask: '0110' },
        },
      ],
    };
    const parsed = sceneDocumentSchema.parse(doc);
    expect(parsed.components[0]!.params).toMatchObject({ mask: '0110', n: 7 });
  });

  it('computeGeometry 分发与直接调用一致（协议一致性）', () => {
    const p = P({ n: 4, layers: 3, mask: '0110' });
    const viaWorker = computeGeometry({ kind: 'packed_layers', cifText: '', params: p });
    expect(viaWorker).toEqual(buildPackedLayers(p));
  });
});
