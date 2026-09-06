/**
 * 应用壳 —— T-1.6 版：真实交互界面（素材库 / 画布 / 参数+图层）
 * 键盘：Delete/Backspace 删除选中、Esc 取消选中（输入框聚焦时跳过）。
 * 首次进入自动载入示例场景（对齐 demo 启动行为）。
 */
import { useEffect } from 'react';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import LayerPanel from './LayerPanel';
import LibraryPanel from './LibraryPanel';
import ParamPanel from './ParamPanel';
import { loadPresetScene } from './preset';
import SceneCanvas from './SceneCanvas';
import TopBar from './TopBar';

export default function App() {
  useEffect(() => {
    if (sceneStore.getState().components.length === 0) loadPresetScene();
    // 调试/二次开发入口
    (window as unknown as Record<string, unknown>).__KAOLIN = { store: sceneStore, renderer: rendererRef };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const s = sceneStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectionId) s.removeComponent(s.selectionId);
      }
      if (e.key === 'Escape') s.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="layout">
        <LibraryPanel />
        <section className="canvas">
          <SceneCanvas />
        </section>
        <aside className="panel right">
          <ParamPanel />
          <LayerPanel />
        </aside>
      </main>
      <footer className="statusbar">
        <span>左键旋转 · 右键平移 · 滚轮缩放 · 点击选中 · Delete 删除 · Esc 取消</span>
        <span>记忆系统：AGENTS.md 会话协议已生效</span>
      </footer>
    </div>
  );
}
