/**
 * 图层面板 —— T-1.6（对齐 demo：选择 / 显隐 / 删除 / 原子数）
 * 渲染同步由 bindRenderer 承担，本面板只操作 store。
 * 原子数：几何为异步构建（T-2.2），监听 kaolin-geometry-updated 触发刷新。
 */
import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

/** 几何构建完成 → 原子数变化的极简外部通知源（RendererService 派发 window 事件） */
function subscribeGeometryUpdated(onChange: () => void): () => void {
  window.addEventListener('kaolin-geometry-updated', onChange);
  return () => window.removeEventListener('kaolin-geometry-updated', onChange);
}

export default function LayerPanel() {
  const components = useStore(sceneStore, (s) => s.components);
  const selectionId = useStore(sceneStore, (s) => s.selectionId);
  // 异步构建完成时让面板重渲染（读取最新 atomCountOf）
  useSyncExternalStore(subscribeGeometryUpdated, () => rendererRef.current?.stats().atoms ?? 0);

  if (!components.length) return null;

  return (
    <div className="layer-list">
      {components.map((c) => (
        <div
          key={c.id}
          className={`layer-row${c.id === selectionId ? ' sel' : ''}${c.visible ? '' : ' hid'}`}
          onClick={() => sceneStore.getState().select(c.id)}
        >
          <span className="nm">{c.name}</span>
          <span className="cnt">{rendererRef.current?.atomCountOf(c.id) ?? 0} 原子</span>
          <button
            className="eye"
            title="显示/隐藏"
            onClick={(e) => {
              e.stopPropagation();
              sceneStore.getState().setVisibility(c.id, !c.visible);
            }}
          >
            {c.visible ? '👁' : '—'}
          </button>
          <button
            className="del"
            title="删除"
            onClick={(e) => {
              e.stopPropagation();
              sceneStore.getState().removeComponent(c.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
