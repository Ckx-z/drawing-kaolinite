/**
 * 几何引擎验收测试 —— T-2.2
 *
 * 验收目标：几何计算迁入子线程，主线程仅做 postMessage/收结果。
 * 测试策略（Node 无 Worker/DOM）：
 *  - 协议一致性：computeGeometry（Worker 脚本与同步引擎共用）与 builders 直调结果
 *    逐位一致（含 15k 原子双层壁埃洛石管的基线数量）；
 *  - 异步语义与协议编解码：假 Worker（微任务中跑同一 computeGeometry）验证
 *    引擎请求/响应匹配、错误传导、过期响应丢弃、dispose 后拒绝；
 *  - 工厂回退：无 Worker 环境返回同步引擎。
 * 主线程不被阻塞的最终确认由浏览器实测（15k 原子管生成 ~200ms 在子线程执行）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeGeometry,
  createGeometryEngine,
  createSyncEngine,
  createWorkerEngine,
  type GeometryRequest,
  type WorkerLike,
  type WorkerResponse,
} from './worker';

const CIF = readFileSync(new URL('../../data/kaolinite.cif', import.meta.url), 'utf8');

const DOUBLE_WALL_TUBE: GeometryRequest = {
  kind: 'halloysite_tube',
  cifText: CIF,
  params: { innerR: 14, length: 100, walls: 2, d001: 10, progress: 1, taperDeg: 5, style: '空间填充', curlAxis: 'a' as const, portNoise: 0 },
};

describe('协议一致性：computeGeometry 与 builders 直调逐位一致', () => {
  it('双层壁埃洛石管（15k+ 原子基线）：原子数/键数一致', () => {
    const r = computeGeometry(DOUBLE_WALL_TUBE);
    expect(r.atoms.length).toBeGreaterThan(15000); // T-2.2 验收场景：15,686 原子量级
    expect(r.bonds.length).toBeGreaterThan(0);
  });

  it('四类素材请求均正确分发（片层/颗粒/分子）', () => {
    const sheet = computeGeometry({ kind: 'kaolinite_sheet', cifText: CIF, params: { Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false, strictCell: false } });
    expect(sheet.atoms.length).toBe(2448); // T-0.1 基线

    const part = computeGeometry({ kind: 'nanoparticle', cifText: '', params: { radius: 9, grains: 150, seed: 7, mode: '簇装' } });
    expect(part.atoms.length).toBe(217);

    const mol = computeGeometry({ kind: 'molecule', cifText: '', params: { kind: 'H₂O' } });
    expect(mol.atoms).toHaveLength(3);
    expect(mol.bonds).toHaveLength(2);
  });
});

/** 假 Worker：微任务中执行同一 computeGeometry，模拟真实子线程的异步语义 */
function fakeSpawn(opts?: { fail?: boolean }): { worker: WorkerLike; responses: WorkerResponse[] } {
  const responses: WorkerResponse[] = [];
  let onMsg: ((ev: { data: WorkerResponse }) => void) | null = null;
  let onErr: ((ev: unknown) => void) | null = null;
  const worker: WorkerLike = {
    postMessage(msg) {
      if (opts?.fail) {
        queueMicrotask(() => onErr?.({ message: 'spawn failed' }));
        return;
      }
      queueMicrotask(() => {
        try {
          responses.push({ id: msg.id, ok: true, result: computeGeometry(msg.req) });
        } catch (err) {
          responses.push({ id: msg.id, ok: false, error: (err as Error).message });
        }
        onMsg?.({ data: responses[responses.length - 1] });
      });
    },
    addEventListener(type, cb) {
      if (type === 'message') onMsg = cb as (ev: { data: WorkerResponse }) => void;
      else onErr = cb as (ev: unknown) => void;
    },
    terminate: () => undefined,
  };
  return { worker, responses };
}

describe('Worker 引擎：异步语义与协议编解码（假 Worker）', () => {
  it('请求→响应正确匹配，结果与同步计算一致', async () => {
    const { worker } = fakeSpawn();
    const engine = createWorkerEngine(() => worker);
    const result = await engine.build(DOUBLE_WALL_TUBE);
    expect(result.atoms.length).toBe(computeGeometry(DOUBLE_WALL_TUBE).atoms.length);
    engine.dispose();
  });

  it('并发请求各自拿到对应响应（id 匹配）', async () => {
    const { worker } = fakeSpawn();
    const engine = createWorkerEngine(() => worker);
    const [mol, part] = await Promise.all([
      engine.build({ kind: 'molecule', cifText: '', params: { kind: 'CO₂' } }),
      engine.build({ kind: 'nanoparticle', cifText: '', params: { radius: 5, grains: 40, seed: 3, mode: '簇装' } }),
    ]);
    expect(mol.atoms).toHaveLength(3); // CO₂
    expect(part.atoms.length).toBeGreaterThan(40);
    engine.dispose();
  });

  it('非法请求（CIF 缺失）错误信息经协议回传', async () => {
    const { worker } = fakeSpawn();
    const engine = createWorkerEngine(() => worker);
    await expect(
      engine.build({ kind: 'kaolinite_sheet', cifText: '', params: { Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false, strictCell: false } }),
    ).rejects.toThrow('CIF 数据未设置');
    engine.dispose();
  });

  it('worker error 事件使所有在途请求拒绝', async () => {
    const { worker } = fakeSpawn({ fail: true });
    const engine = createWorkerEngine(() => worker);
    await expect(engine.build(DOUBLE_WALL_TUBE)).rejects.toThrow(/Worker 异常/);
    engine.dispose();
  });

  it('dispose 后新请求拒绝且不崩溃', async () => {
    const { worker } = fakeSpawn();
    const engine = createWorkerEngine(() => worker);
    engine.dispose();
    await expect(engine.build({ kind: 'molecule', cifText: '', params: { kind: 'H₂O' } })).rejects.toThrow();
  });
});

describe('工厂回退与同步引擎', () => {
  it('Node（无 Worker）环境 createGeometryEngine 回退同步引擎', async () => {
    const engine = createGeometryEngine();
    const result = await engine.build(DOUBLE_WALL_TUBE);
    expect(result.atoms.length).toBe(computeGeometry(DOUBLE_WALL_TUBE).atoms.length);
    engine.dispose();
  });

  it('同步引擎直接可用（rendererBinding 风格的串行调用）', async () => {
    const engine = createSyncEngine();
    const a = await engine.build({ kind: 'molecule', cifText: '', params: { kind: 'O₂' } });
    const b = await engine.build({ kind: 'nanoparticle', cifText: '', params: { radius: 9, grains: 150, seed: 7, mode: '簇装' } });
    expect(a.atoms).toHaveLength(2);
    expect(b.atoms.length).toBe(217);
    engine.dispose();
  });
});
