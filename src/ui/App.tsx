/**
 * 应用壳 —— T-1.6 版：真实交互界面（素材库 / 画布 / 参数+图层）
 * 键盘：Delete/Backspace 删除选中、Esc 取消选中、Ctrl/Cmd+Z 撤销、
 *       Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做（T-2.1；输入框聚焦时跳过）。
 * 首次进入自动载入示例场景（对齐 demo 启动行为）。
 */
import { useEffect, useState } from 'react';
import { rendererRef } from '../state/rendererRef';
import { sceneHistory, sceneStore } from '../state/sceneStore';
import LayerPanel from './LayerPanel';
import LibraryPanel from './LibraryPanel';
import ParamPanel from './ParamPanel';
import { loadPresetScene } from './preset';
import SceneCanvas from './SceneCanvas';
import { SHORTCUTS, cheatsheetEntries, handleShortcut, type ShortcutHost } from './shortcuts';
import TopBar from './TopBar';

export default function App() {
  const [cheat, setCheat] = useState(false);

  useEffect(() => {
    if (sceneStore.getState().components.length === 0) loadPresetScene();
    // 调试/二次开发入口
    (window as unknown as Record<string, unknown>).__KAOLIN = { store: sceneStore, renderer: rendererRef };
  }, []);

  useEffect(() => {
    // T-7.2：统一快捷键分发（注册表单一事实源，速查浮层同源渲染）
    const host: ShortcutHost = {
      getState: () => sceneStore.getState(),
      history: sceneHistory,
      toggleCheatSheet: () => setCheat((v) => !v),
    };

    // 方向键平移视角：按住连续、松开停止（rAF 帧循环，帧率无关的速度感）
    const PAN_PX_PER_FRAME = 6; // ≈360 逻辑像素/秒 @60fps，适中
    const arrows = new Set<string>();
    let panRaf = 0;
    const panLoop = (): void => {
      if (!arrows.size) {
        panRaf = 0;
        return;
      }
      // 按键方向 = 画板内容移动方向（按 ← 内容左移），速度分解允许斜向
      const dx = (arrows.has('arrowleft') ? 1 : 0) - (arrows.has('arrowright') ? 1 : 0);
      const dy = (arrows.has('arrowdown') ? 1 : 0) - (arrows.has('arrowup') ? 1 : 0);
      if (dx || dy) rendererRef.current?.panView(dx * PAN_PX_PER_FRAME, dy * PAN_PX_PER_FRAME);
      panRaf = requestAnimationFrame(panLoop);
    };

    const onKey = (e: KeyboardEvent): void => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return; // 输入框内方向键正常编辑文本
      if (e.key.startsWith('Arrow')) {
        e.preventDefault(); // 阻止页面滚动，不进入快捷键分发
        arrows.add(e.key.toLowerCase());
        if (!panRaf) panRaf = requestAnimationFrame(panLoop);
        return;
      }
      handleShortcut(e, host);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      arrows.delete(e.key.toLowerCase()); // 集合清空后循环自行停止
    };
    const onBlur = (): void => {
      arrows.clear(); // 切走窗口时停住，避免回来后"卡键"持续平移
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (panRaf) cancelAnimationFrame(panRaf);
    };
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
        <span>左键旋转 · 右键平移 · 滚轮缩放 · 点击选中 · Delete 删除 · Esc 取消 · Ctrl+Z 撤销 / Ctrl+Shift+Z 重做</span>
        <span>记忆系统：AGENTS.md 会话协议已生效</span>
      </footer>
      {cheat && (
        <div className="cheatsheet" onClick={() => setCheat(false)}>
          <div className="cheatsheet-card">
            <h3>快捷键速查</h3>
            <table>
              <tbody>
                {cheatsheetEntries().map((e) => (
                  <tr key={e.keys + e.label}>
                    <td>
                      <kbd>{e.keys}</kbd>
                    </td>
                    <td>{e.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">按 ? 或点击空白处关闭 · {SHORTCUTS.length} 个快捷键已注册</p>
          </div>
        </div>
      )}
    </div>
  );
}
