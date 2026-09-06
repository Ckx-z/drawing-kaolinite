/**
 * 网格缓存验收测试 —— T-2.9
 *
 * 验收标准（TODO）：命中缓存的实例化 < 50ms（对比实时生成 200ms+）；
 * 缓存失效以参数指纹（hash）判定。
 * 环境：fake-indexeddb + localStorage shim；内层引擎用假件（记录调用次数）。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheKey,
  clearGeometryCache,
  createCachedEngine,
  defaultTubePrebakeRequests,
  fingerprint,
  prebake,
} from './cache';
import type { GeometryEngine, GeometryRequest, GeometryResult } from './worker';

// localStorage shim（本模块未用到，保持与其他缓存类测试一致的环境隔离）
const storeMap = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => storeMap.get(k) ?? null,
    setItem: (k: string, v: string) => void storeMap.set(k, v),
    removeItem: (k: string) => void storeMap.delete(k),
    clear: () => storeMap.clear(),
    key: (i: number) => [...storeMap.keys()][i] ?? null,
    get length() {
      return storeMap.size;
    },
  },
  configurable: true,
});

const REQ: GeometryRequest = {
  kind: 'molecule',
  cifText: '',
  params: { kind: 'H₂O' },
};
const RESULT: GeometryResult = {
  atoms: [
    { el: 'O', x: 0, y: 0, z: 0 },
    { el: 'H', x: 0.76, y: 0.59, z: 0 },
    { el: 'H', x: -0.76, y: 0.59, z: 0 },
  ],
  bonds: [
    [0, 1],
    [0, 2],
  ],
};

function fakeInner(result: GeometryResult = RESULT) {
  const inner: GeometryEngine = {
    build: (req) => {
      calls.push(req);
      return Promise.resolve(structuredClone(result));
    },
    dispose: () => undefined,
  };
  const calls: GeometryRequest[] = [];
  return { inner, calls };
}

beforeEach(async () => {
  storeMap.clear();
  await clearGeometryCache();
});

describe('指纹（缓存失效判据）', () => {
  it('参数规范化：键顺序无关（同一指纹）', () => {
    expect(fingerprint({ a: 1, b: [2, 3] })).toBe(fingerprint({ b: [2, 3], a: 1 }));
  });

  it('内容不同 → 指纹不同（参数/CIF 任一变化即失效）', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(cacheKey({ ...REQ, params: { kind: 'H₂O' } })).not.toBe(
      cacheKey({ ...REQ, params: { kind: 'O₂' } }),
    );
    expect(cacheKey({ ...REQ, cifText: 'data1' })).not.toBe(cacheKey({ ...REQ, cifText: 'data2' }));
  });

  it('缓存键含 kind 与两段指纹', () => {
    const key = cacheKey(REQ);
    expect(key.startsWith('geo:molecule:')).toBe(true);
    expect(key.match(/:/g)).toHaveLength(5); // geo:kind:fp(params):fp(cif)，指纹自带 1 个冒号
  });
});

describe('缓存引擎（T-2.9 核心）', () => {
  it('首次未命中走 inner 并回填；二次命中不再调 inner 且结果一致', async () => {
    const { inner, calls } = fakeInner();
    const engine = createCachedEngine(inner);

    const r1 = await engine.build(REQ);
    expect(r1).toEqual(RESULT);
    expect(calls).toHaveLength(1);

    const r2 = await engine.build(REQ); // 命中
    expect(r2).toEqual(RESULT);
    expect(calls).toHaveLength(1); // inner 未再被调用
  });

  it('大 16k 原子结果命中 < 50ms（验收标准）', async () => {
    // 构造 15,686 原子的仿真结果（埃洛石管量级）
    const bigAtoms = Array.from({ length: 15686 }, (_, i) => ({
      el: i % 3 === 0 ? 'Al' : i % 3 === 1 ? 'Si' : 'O',
      x: (i % 100) * 1.4,
      y: ((i / 100) | 0) * 1.4,
      z: (i % 37) * 0.9,
    }));
    const big: GeometryResult = { atoms: bigAtoms, bonds: [] };
    const { inner, calls } = fakeInner(big);
    const engine = createCachedEngine(inner);

    await engine.build(REQ); // 首次（回填）
    expect(calls).toHaveLength(1);

    const t0 = performance.now();
    const hit = await engine.build(REQ); // 二次（命中）
    const ms = performance.now() - t0;
    expect(hit.atoms).toHaveLength(15686);
    expect(ms, `命中耗时 ${ms}ms`).toBeLessThan(50);
  });

  it('参数或 CIF 不同 → 未命中（指纹失效）', async () => {
    const { inner, calls } = fakeInner();
    const engine = createCachedEngine(inner);
    await engine.build(REQ);
    await engine.build({ ...REQ, params: { kind: 'O₂' } });
    await engine.build({ ...REQ, cifText: 'different-cif' });
    expect(calls).toHaveLength(3);
  });

  it('inner 失败不缓存且异常透传', async () => {
    let fail = true;
    const flaky: GeometryEngine = {
      build: () => (fail ? Promise.reject(new Error('构建失败')) : Promise.resolve(RESULT)),
      dispose: () => undefined,
    };
    const engine = createCachedEngine(flaky);
    await expect(engine.build(REQ)).rejects.toThrow('构建失败');
    // 修复后同一请求重新构建成功（失败从未污染缓存）
    fail = false;
    await expect(engine.build(REQ)).resolves.toEqual(RESULT);
  });

  it('LRU 上限：limit=2 时第四条入库淘汰最旧，重访重建', async () => {
    const { inner, calls } = fakeInner();
    const engine = createCachedEngine(inner, { limit: 2 });
    const reqs: GeometryRequest[] = [
      REQ,
      { ...REQ, params: { kind: 'O₂' } },
      { ...REQ, params: { kind: 'CO₂' } },
      { ...REQ, params: { kind: 'N₂' } },
    ];
    for (const r of reqs) await engine.build(r);
    expect(calls).toHaveLength(4);

    await engine.build(reqs[0]); // 最旧已被淘汰 → inner 再次调用
    expect(calls).toHaveLength(5);
    await engine.build(reqs[3]); // 仍命中
    expect(calls).toHaveLength(5);
  });
});

describe('预烘焙', () => {
  it('prebake 逐条构建入库；后续命中不再调 inner', async () => {
    const { inner, calls } = fakeInner();
    const engine = createCachedEngine(inner);
    const reqs = defaultTubePrebakeRequests('cif-data'); // 10 条
    const done = await prebake(engine, reqs);
    expect(done).toBe(10);
    expect(calls).toHaveLength(10);

    const hits = await prebake(engine, reqs); // 全命中
    expect(hits).toBe(10);
    expect(calls).toHaveLength(10);
  });

  it('缺 CIF 的请求失败被跳过不中断', async () => {
    const real: GeometryEngine = {
      build: (req) =>
        req.kind === 'kaolinite_sheet' && !req.cifText
          ? Promise.reject(new Error('CIF 缺失'))
          : Promise.resolve(RESULT),
      dispose: () => undefined,
    };
    const engine = createCachedEngine(real);
    const done = await prebake(engine, [
      { kind: 'kaolinite_sheet', cifText: '', params: { Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false, strictCell: false } },
      REQ,
    ]);
    expect(done).toBe(1); // 失败跳过
  });

  it('默认预烘焙清单：5 档 innerR × 2 壁数 = 10 条', () => {
    expect(defaultTubePrebakeRequests('cif')).toHaveLength(10);
  });
});
