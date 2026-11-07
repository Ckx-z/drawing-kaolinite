/**
 * gizmo 松手提交入口（D15 重构，2026-11-05）
 *
 * 自动拖拽吸附删除后，这是拖动结束的唯一提交路径（SceneCanvas.onTransformChange
 * 调用）：渲染器读回用户实际操作得到的 transform，经 schema 校验原样写 store
 * （一次提交 = 一条撤销）。不做任何重叠检测、贴面、法向推出或重新定位——
 * 分子靠近/进入其他组件时保持用户摆放。提取为独立函数以便回归测试锁定
 * 「松手 = 用户变换逐位一致」语义（原自动吸附触发场景作为测试用例）。
 */
import type { SceneStore } from '../state/sceneStore';
import type { RendererService } from '../render/RendererService';

/** 读回组件当前变换并提交（渲染器无该组件/无变换时静默跳过）。返回是否已提交 */
export function commitGizmoTransform(
  svc: RendererService,
  id: string,
  store: SceneStore,
): boolean {
  const t = svc.getComponentTransform(id);
  if (!t) return false;
  store.getState().setTransform(id, t);
  return true;
}
