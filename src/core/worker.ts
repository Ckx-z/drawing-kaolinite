/**
 * 几何生成引擎 —— T-2.2（Web Worker 化）
 *
 * 设计：
 *  - computeGeometry：四类素材（片层/管/颗粒/分子）的统一计算入口，Worker 脚本与
 *    主线程同步回退共用同一份逻辑（协议一致性有单测保证）；
 *  - GeometryEngine 接口：createSyncEngine（主线程直算；Node 单测 / Worker 不可用回退）
 *    与 createWorkerEngine（postMessage 到子线程，主线程仅收 {atoms, bonds}）；
 *  - spawn 可注入：单测用假 Worker 在微任务里跑同一 computeGeometry，
 *    验证协议编解码与异步语义，不依赖浏览器环境；
 *  - 取消语义不在引擎内：调用方（RendererService）按组件 id 持 token，
 *    丢弃过期响应（滑块连续拖动只采纳最后一次）。
 */
import {
  buildHalloysiteTube,
  buildKaoliniteSheet,
  buildMolecule,
  buildParticle,
} from './builders';
import type { GeometryData } from './geometry';
import type { MoleculeParams, ParticleParams, SheetParams, TubeParams } from './types';

export type GeometryKind = 'kaolinite_sheet' | 'halloysite_tube' | 'nanoparticle' | 'molecule';

export type GeometryParams = SheetParams | TubeParams | ParticleParams | MoleculeParams;

export interface GeometryRequest {
  kind: GeometryKind;
  /** 片层/管必需；其余类型忽略 */
  cifText: string;
  params: GeometryParams;
}

export type GeometryResult = GeometryData;

/* ---------- Worker 消息协议 ---------- */

export interface WorkerRequest {
  id: number;
  req: GeometryRequest;
}

export type WorkerResponse =
  | { id: number; ok: true; result: GeometryResult }
  | { id: number; ok: false; error: string };

/** 统一计算入口（主线程同步引擎与 Worker 脚本共用） */
export function computeGeometry(req: GeometryRequest): GeometryResult {
  if ((req.kind === 'kaolinite_sheet' || req.kind === 'halloysite_tube') && !req.cifText) {
    throw new Error('CIF 数据未设置');
  }
  switch (req.kind) {
    case 'kaolinite_sheet':
      return buildKaoliniteSheet(req.cifText, req.params as SheetParams);
    case 'halloysite_tube':
      return buildHalloysiteTube(req.cifText, req.params as TubeParams);
    case 'nanoparticle':
      return buildParticle(req.params as ParticleParams);
    case 'molecule':
      return buildMolecule((req.params as MoleculeParams).kind);
  }
}

/* ---------- 引擎接口与实现 ---------- */

export interface GeometryEngine {
  build(req: GeometryRequest): Promise<GeometryResult>;
  dispose(): void;
}

/** 主线程同步引擎：Node 单测 / Worker 不可用时的回退 */
export function createSyncEngine(): GeometryEngine {
  return {
    build: (req) => Promise.resolve(computeGeometry(req)),
    dispose: () => undefined,
  };
}

/** 最小 Worker 结构面（浏览器 Worker 与测试假 Worker 都能满足） */
export interface WorkerLike {
  postMessage(msg: WorkerRequest): void;
  addEventListener(type: 'message', cb: (ev: { data: WorkerResponse }) => void): void;
  addEventListener(type: 'error', cb: (ev: unknown) => void): void;
  terminate(): void;
}

export type SpawnWorker = () => WorkerLike;

const defaultSpawn: SpawnWorker = () => {
  // Vite 的模块 Worker：geometryWorker.ts 是独立入口，import.meta.url 保证路径正确
  return new Worker(new URL('./geometryWorker.ts', import.meta.url), { type: 'module' });
};

/** Worker 引擎：主线程只做 postMessage/收结果，几何计算在子线程 */
export function createWorkerEngine(spawn: SpawnWorker = defaultSpawn): GeometryEngine {
  let seq = 0;
  let disposed = false;
  const pending = new Map<number, { resolve: (r: GeometryResult) => void; reject: (e: Error) => void }>();
  const worker = spawn();

  worker.addEventListener('message', (ev) => {
    const res = ev.data;
    const p = pending.get(res.id);
    if (!p) return; // 过期/未知响应（如已 dispose）静默丢弃
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(new Error(res.error));
  });
  worker.addEventListener('error', (ev) => {
    const err = new Error(`几何 Worker 异常：${String((ev as { message?: string })?.message ?? ev)}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });

  return {
    build: (req) =>
      new Promise<GeometryResult>((resolve, reject) => {
        if (disposed) {
          reject(new Error('几何引擎已释放'));
          return;
        }
        const id = ++seq;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, req });
      }),
    dispose: () => {
      disposed = true;
      const err = new Error('几何引擎已释放');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker.terminate();
    },
  };
}

/** 引擎工厂：浏览器用 Worker（子线程计算），Node/测试环境回退同步 */
export function createGeometryEngine(): GeometryEngine {
  return typeof Worker !== 'undefined' ? createWorkerEngine() : createSyncEngine();
}
