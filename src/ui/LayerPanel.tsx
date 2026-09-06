/**
 * 图层面板 —— T-1.6（对齐 demo：选择 / 显隐 / 删除 / 原子数）
 * 渲染同步由 bindRenderer 承担，本面板只操作 store。
 */
import { useStore } from 'zustand';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

export default function LayerPanel() {
  const components = useStore(sceneStore, (s) => s.components);
  const selectionId = useStore(sceneStore, (s) => s.selectionId);

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
