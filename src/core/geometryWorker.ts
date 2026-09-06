/**
 * 几何生成 Worker 入口 —— T-2.2
 *
 * 独立模块 Worker：收到 GeometryRequest → computeGeometry（与主线程同步引擎
 * 共用同一份 builders 逻辑，协议一致性有单测）→ 回传 {atoms, bonds} 纯数据。
 * 主线程不做任何几何计算，15k+ 原子的大场景参数拖动不再阻塞 UI。
 */
import { computeGeometry, type WorkerRequest, type WorkerResponse } from './worker';

self.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  const { id, req } = e.data;
  let res: WorkerResponse;
  try {
    res = { id, ok: true, result: computeGeometry(req) };
  } catch (err) {
    res = { id, ok: false, error: (err as Error).message };
  }
  self.postMessage(res);
};
