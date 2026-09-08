/**
 * 几何生成 Worker 入口 —— T-2.2
 *
 * 独立模块 Worker：收到 GeometryRequest → computeGeometry（与主线程同步引擎
 * 共用同一份 builders 逻辑，协议一致性有单测）→ 回传 {atoms, bonds} 纯数据。
 * 主线程不做任何几何计算，15k+ 原子的大场景参数拖动不再阻塞 UI。
 */
import { computeGeometry, type WorkerRequest, type WorkerResponse } from './worker';

// 脚本加载成功即自报 ready：主线程 4s 握手超时会判定加载失败并回退主线程
// （Tauri tauri:// 自定义协议下 Worker 可能静默加载失败，无 error 事件）
self.postMessage({ ready: true } satisfies WorkerResponse);

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
