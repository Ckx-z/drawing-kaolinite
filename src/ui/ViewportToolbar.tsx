/**
 * 画布悬浮工具栏（V2 交互升级 P1）
 *
 * 直接操作入口：gizmo 三模式（G 移动 / E 旋转 / S 等比缩放）+ 测量开关 + 聚焦/适配。
 * 状态单一事实源 = sceneStore 会话态（gizmoMode / measureMode），渲染层同步由
 * SceneCanvas 订阅完成；ParamPanel 的移动/旋转/缩放按钮同源（互不抢状态）。
 * 定位：不替代右侧参数面板——画布管直观摆放，面板管科研精确设置（任务书 3.4）。
 * 纯 2D 示意图模式隐藏（3D 场景不可见，工具不适用）。
 */
import { useStore } from 'zustand';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

export default function ViewportToolbar(): React.ReactElement | null {
  const mode = useStore(sceneStore, (s) => s.mode);
  const gizmoMode = useStore(sceneStore, (s) => s.gizmoMode);
  const measureMode = useStore(sceneStore, (s) => s.measureMode);
  const hasSel = useStore(sceneStore, (s) => Boolean(s.selectionId));
  if (mode !== 'mixed') return null;

  const setG = (m: 'translate' | 'rotate' | 'scale'): void => sceneStore.getState().setGizmoMode(m);
  return (
    <div
      className="vptoolbar"
      role="toolbar"
      title="画布直接操作：G 移动 · E 旋转 · S 等比缩放 · F 聚焦选中 · Shift+F 适配全场景"
    >
      <button className={gizmoMode === 'translate' ? 'on' : ''} disabled={!hasSel} onClick={() => setG('translate')} title="移动 gizmo（G）——拖坐标轴手柄，松手一次提交">
        ✥ 移动
      </button>
      <button className={gizmoMode === 'rotate' ? 'on' : ''} disabled={!hasSel} onClick={() => setG('rotate')} title="旋转 gizmo（E）——步进吸附见参数面板「吸附」区">
        ↻ 旋转
      </button>
      <button className={gizmoMode === 'scale' ? 'on' : ''} disabled={!hasSel} onClick={() => setG('scale')} title="等比缩放 gizmo（S）——仅中央手柄；科学几何尺寸在参数面板调">
        ⤢ 缩放
      </button>
      <span className="vpt-sep" />
      <button
        className={measureMode ? 'on' : ''}
        onClick={() => sceneStore.getState().setMeasureMode(!measureMode)}
        title="测量模式：开启后点击原子即拾取（等效 Alt+点击；两原子 = 键长，第三原子 = 键角，Esc 清空）"
      >
        📏 测量
      </button>
      <button
        disabled={!hasSel}
        onClick={() => {
          const id = sceneStore.getState().selectionId;
          if (id) rendererRef.current?.frameComponent(id);
        }}
        title="聚焦选中组件（F）"
      >
        🎯 聚焦
      </button>
      <button onClick={() => rendererRef.current?.frameAll()} title="适配全场景（Shift+F）">
        ⛶ 适配
      </button>
    </div>
  );
}
