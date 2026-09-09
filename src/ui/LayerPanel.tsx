/**
 * 图层面板 —— T-1.6（对齐 demo：选择 / 显隐 / 删除 / 原子数）
 * 渲染同步由 bindRenderer 承担，本面板只操作 store。
 * 原子数：几何为异步构建（T-2.2），监听 kaolin-geometry-updated 触发刷新。
 * T-11.4：新增图元分区（顶层在上 = 数组倒序；选择/显隐/锁定/删除/Z 序）。
 */
import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { hoverStore } from '../render/highlight';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

/** 悬停 id 的极简外部源（画布 pointermove 与面板行悬停双向写入） */
function subscribeHover(onChange: () => void): () => void {
  return hoverStore.subscribe(onChange);
}

/** 几何构建完成 → 原子数变化的极简外部通知源（RendererService 派发 window 事件） */
function subscribeGeometryUpdated(onChange: () => void): () => void {
  window.addEventListener('kaolin-geometry-updated', onChange);
  return () => window.removeEventListener('kaolin-geometry-updated', onChange);
}

const SHAPE_ICON: Record<string, string> = {
  rect: '▭',
  ellipse: '◯',
  arrow: '→',
  line: '—',
  text: 'T',
};

function ShapesLayer() {
  const shapes = useStore(sceneStore, (s) => s.shapes);
  const selIds = useStore(sceneStore, (s) => s.shapeSelectionIds);
  if (!shapes.length) return null;

  return (
    <>
      <h3 style={{ marginTop: 14 }}>
        图元<span className="tip">（{shapes.length}）</span>
      </h3>
      <div className="layer-list">
        {[...shapes].reverse().map((s) => {
          const label = s.type === 'text' ? s.text.split('\n')[0]!.slice(0, 14) : SHAPE_ICON[s.type] ?? s.type;
          return (
            <div
              key={s.id}
              className={`layer-row${selIds.includes(s.id) ? ' sel' : ''}${s.visible ? '' : ' hid'}${s.locked ? ' lock' : ''}`}
              onClick={(e) => {
                if (e.shiftKey || e.metaKey || e.ctrlKey) sceneStore.getState().toggleShapeSelection(s.id);
                else sceneStore.getState().selectShape(s.id);
              }}
            >
              <span className="nm">
                {s.group ? '⛓ ' : ''}
                {s.type !== 'text' ? `${SHAPE_ICON[s.type]} ` : ''}
                {label}
              </span>
              <button
                className="op"
                title="前移一层（画在更上层）"
                onClick={(e) => {
                  e.stopPropagation();
                  sceneStore.getState().moveShapeOrder(s.id, 'forward');
                }}
              >
                ↑
              </button>
              <button
                className="op"
                title="后移一层"
                onClick={(e) => {
                  e.stopPropagation();
                  sceneStore.getState().moveShapeOrder(s.id, 'backward');
                }}
              >
                ↓
              </button>
              <button
                className="op"
                title={s.locked ? '解锁' : '锁定（点击不选中）'}
                onClick={(e) => {
                  e.stopPropagation();
                  sceneStore.getState().updateShape(s.id, { locked: !s.locked });
                }}
              >
                {s.locked ? '🔒' : '🔓'}
              </button>
              <button
                className="eye"
                title="显示/隐藏"
                onClick={(e) => {
                  e.stopPropagation();
                  sceneStore.getState().updateShape(s.id, { visible: !s.visible });
                }}
              >
                {s.visible ? '👁' : '—'}
              </button>
              <button
                className="del"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  sceneStore.getState().removeShape(s.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function LayerPanel() {
  const components = useStore(sceneStore, (s) => s.components);
  const selectionId = useStore(sceneStore, (s) => s.selectionId);
  const hoverId = useSyncExternalStore(subscribeHover, () => hoverStore.getState().id);
  // 异步构建完成时让面板重渲染（读取最新 atomCountOf）
  useSyncExternalStore(subscribeGeometryUpdated, () => rendererRef.current?.stats().atoms ?? 0);

  return (
    <>
      {components.length > 0 && (
        <div className="layer-list">
          {components.map((c) => {
            const locked = c.locked ?? false;
            return (
              <div
                key={c.id}
                className={`layer-row${c.id === selectionId ? ' sel' : ''}${c.visible ? '' : ' hid'}${locked ? ' lock' : ''}${c.id === hoverId ? ' hov' : ''}`}
                onClick={() => sceneStore.getState().select(c.id)}
                onMouseEnter={() => hoverStore.getState().setHover(c.id)}
                onMouseLeave={() => hoverStore.getState().setHover(null)}
              >
                <span className="nm">
                  {c.group ? '⛓ ' : ''}
                  {c.name}
                </span>
                <span className="cnt">{rendererRef.current?.atomCountOf(c.id) ?? 0} 原子</span>
                <button
                  className="op"
                  title={locked ? '解锁（允许选中与变换）' : '锁定（点击不选中、gizmo 不吸附）'}
                  onClick={(e) => {
                    e.stopPropagation();
                    sceneStore.getState().toggleLock(c.id);
                  }}
                >
                  {locked ? '🔒' : '🔓'}
                </button>
                <button
                  className="op"
                  title={
                    c.group
                      ? '移出分组'
                      : selectionId && selectionId !== c.id
                        ? '加入选中组件所在的组（成组后整体变换）'
                        : '与当前选中组件成组'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    const s = sceneStore.getState();
                    if (c.group) s.ungroupComponents([c.id]);
                    else if (selectionId && selectionId !== c.id) s.groupComponents([selectionId, c.id]);
                    else s.groupComponents([c.id]);
                  }}
                >
                  {c.group ? '⛓' : '⛓‍⊕'}
                </button>
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
            );
          })}
        </div>
      )}
      <ShapesLayer />
    </>
  );
}
