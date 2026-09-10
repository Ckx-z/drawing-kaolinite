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
  buildPackedLayers,
  buildParticle,
} from './builders';
import GeometryWorker from './geometryWorker?worker&inline';
import type { GeometryData } from './geometry';
import { formulaTo3D } from './molecules/formula';
import { smilesTo3D } from './molecules/smiles';
import type { MoleculeParams, PackedLayerParams, ParticleParams, SheetParams, TubeParams } from './types';

export type GeometryKind =
  | 'kaolinite_sheet'
  | 'halloysite_tube'
  | 'nanoparticle'
  | 'molecule'
  | 'packed_layers';

export type GeometryParams =
  | SheetParams
  | TubeParams
  | ParticleParams
  | MoleculeParams
  | PackedLayerParams;

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
  | { id: number; ok: false; error: string }
  /** Worker 脚本加载成功后自报（握手用；id 字段缺省不影响 pending 匹配） */
  | { ready: true };

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
    case 'molecule': {
      const mp = req.params as MoleculeParams;
      if (mp.smiles) {
        const mol = smilesTo3D(mp.smiles); // T-2.8：SMILES 分子在 Worker 内确定性构建
        return { atoms: mol.atoms, bonds: mol.bonds.map(([i, j]) => [i, j]) };
      }
      if (mp.formula) {
        const mol = formulaTo3D(mp.formula); // 2026-09-08：化学式团簇（大小写不敏感输入的规范串）
        return { atoms: mol.atoms, bonds: mol.bonds };
      }
      return buildMolecule(mp.kind);
    }
    case 'packed_layers':
      return buildPackedLayers(req.params as PackedLayerParams);
  }
}

/* ---------- 引擎接口与实现 ---------- */

export interface GeometryEngine {
  build(req: GeometryRequest): Promise<GeometryResult>;
  dispose(): void;
  /** Worker 引擎专有：false = Worker 加载失败已回退主线程（同步引擎无此字段） */
  ready?: Promise<boolean>;
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
  // 内联 Worker（?worker&inline）：worker 代码以 base64 内联进主包，运行时由
  // blob URL 实例化，不发起二次 fetch —— Tauri 打包后以 tauri:// 自定义协议
  // 运行，module Worker 的独立 chunk 会静默加载失败（不触发 error 事件）
  return new GeometryWorker() as unknown as WorkerLike;
};

/** Worker 就绪握手超时：超时判定加载失败，永久回退主线程计算 */
const READY_TIMEOUT_MS = 4000;

/** Worker 引擎：主线程只做 postMessage/收结果，几何计算在子线程 */
export function createWorkerEngine(spawn: SpawnWorker = defaultSpawn): GeometryEngine {
  let seq = 0;
  let disposed = false;
  let dead = false; // Worker 已不可用（加载失败/运行中崩溃）→ 后续构建回退主线程
  const pending = new Map<number, { resolve: (r: GeometryResult) => void; reject: (e: Error) => void }>();
  const worker = spawn();

  // 握手：geometryWorker 入口自报 ready；任何消息到达即视为就绪。超时则永久
  // 回退主线程（computeGeometry 与 Worker 脚本共用同一份逻辑，结果逐位一致）。
  let settleReady!: (ok: boolean) => void;
  const ready = new Promise<boolean>((resolve) => {
    settleReady = (ok) => resolve(ok);
  });
  const readyTimer = setTimeout(() => {
    dead = true;
    settleReady(false);
    console.warn('几何 Worker 4s 未就绪，已回退主线程计算（大场景参数拖动可能掉帧）');
    try {
      worker.terminate();
    } catch {
      /* 假 Worker 可能没有 terminate 实现 */
    }
  }, READY_TIMEOUT_MS);

  worker.addEventListener('message', (ev) => {
    clearTimeout(readyTimer);
    settleReady(true);
    const res = ev.data;
    if (!('id' in res)) return; // ready 自报（握手），无对应在途请求
    const p = pending.get(res.id);
    if (!p) return; // 过期/未知响应（如已 dispose）静默丢弃
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(new Error(res.error));
  });
  worker.addEventListener('error', (ev) => {
    dead = true; // Worker 已挂：后续 postMessage 不会有人应答，必须回退
    clearTimeout(readyTimer);
    settleReady(false);
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
        if (dead) {
          try {
            resolve(computeGeometry(req));
          } catch (err) {
            reject(err as Error);
          }
          return;
        }
        const id = ++seq;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, req });
      }),
    dispose: () => {
      disposed = true;
      clearTimeout(readyTimer);
      settleReady(false);
      const err = new Error('几何引擎已释放');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker.terminate();
    },
    ready,
  };
}

/** 引擎工厂：浏览器用 Worker（子线程计算），Node/测试环境回退同步 */
export function createGeometryEngine(): GeometryEngine {
  return typeof Worker !== 'undefined' ? createWorkerEngine() : createSyncEngine();
}
