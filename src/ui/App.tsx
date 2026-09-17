/**
 * 应用壳 —— T-1.6 版：真实交互界面（素材库 / 画布 / 参数+图层）
 * 键盘：Delete/Backspace 删除选中、Esc 取消选中、Ctrl/Cmd+Z 撤销、
 *       Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做（T-2.1；输入框聚焦时跳过）。
 * 首次进入自动载入示例场景（对齐 demo 启动行为）。
 */
import { useRef, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { trace } from '../crashTrace';
import { rendererRef } from '../state/rendererRef';
import { sceneHistory, sceneStore } from '../state/sceneStore';
import { deleteSelectedShapes, nudgeSelectedShapes } from './shapes/interaction';
import LayerPanel from './LayerPanel';
import LibraryPanel from './LibraryPanel';
import ParamPanel from './ParamPanel';
import { clearAutosave, installAutosave, readAutosave } from '../state/autosave';
import type { SceneDocument } from '../core/types';
import { loadPresetScene } from './preset';
import { statusHint } from './statusHints';
import { enterFocus, exitFocus, type SidebarState } from './focusMode';
import SceneCanvas from './SceneCanvas';
import { SHORTCUTS, cheatsheetEntries, handleShortcut, type ShortcutHost } from './shortcuts';
import TopBar from './TopBar';

/** 上下文状态提示（2026-09-16）：订阅 tool/mode/选择态，复用 statusHint 纯函数；
 * focusProps = 专注态时由 App 注入 Esc 提示（2026-09-17） */
function StatusHint(props: { focus?: boolean }) {
  const tool = useStore(sceneStore, (s) => s.tool);
  const mode = useStore(sceneStore, (s) => s.mode);
  const hasSel = useStore(
    sceneStore,
    (s) => Boolean(s.selectionId) || s.shapeSelectionIds.length > 0,
  );
  const multiN = useStore(sceneStore, (s) => s.componentSelectionIds.length);
  return <span>{statusHint({ tool, mode, hasSelection: hasSel, multiCount: multiN, focus: props.focus })}</span>;
}

export default function App() {
  const [cheat, setCheat] = useState(false);
  const [recover, setRecover] = useState<{ doc: SceneDocument; savedAt: number } | null>(null);
  // 侧栏折叠 + 专注画布（2026-09-16）：UI 态本地，不影响场景/相机
  const mode = useStore(sceneStore, (s) => s.mode);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  // 专注画布快照（2026-09-17 修复被困 bug）：进入前侧栏开合，退出原样恢复；
  // useRef 规避连续进出的 stale closure（enterFocus 幂等：重复进入不覆盖首次快照）
  const focusSnap = useRef<SidebarState | null>(null);
  const focus = !leftOpen && !rightOpen; // isFocus 派生态（含手动双折叠，同样给返回入口）
  const enterFocusMode = (): void => {
    const r = enterFocus(focusSnap.current, { left: leftOpen, right: rightOpen });
    focusSnap.current = r.snapshot;
    setLeftOpen(r.next.left);
    setRightOpen(r.next.right);
  };
  const exitFocusMode = (): void => {
    const r = exitFocus(focusSnap.current);
    focusSnap.current = null;
    setLeftOpen(r.left);
    setRightOpen(r.right);
  };

  useEffect(() => {
    trace('app-mount');
    if (sceneStore.getState().components.length === 0) {
      loadPresetScene();
      trace('preset-loaded');
    }
    // 调试/二次开发入口
    (window as unknown as Record<string, unknown>).__KAOLIN = { store: sceneStore, renderer: rendererRef };
    // 自动保存 + 崩溃恢复（2026-09-13）：编辑防抖快照；启动查上次未保存会话。
    // 顺序关键：先读后装——install 的初始快照会覆盖 key='current'，读必须在其前
    const bootAt = Date.now();
    void readAutosave(bootAt).then((row) => {
      if (row) setRecover({ doc: row.doc, savedAt: row.savedAt });
    });
    const uninstall = installAutosave(sceneStore);
    // 正常退出（关窗/退出）清掉快照：只有异常退出（崩溃/被杀）才留档提示恢复
    const onLeave = (): void => void clearAutosave();
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      uninstall();
    };
  }, []);

  useEffect(() => {
    // T-7.2：统一快捷键分发（注册表单一事实源，速查浮层同源渲染）
    const host: ShortcutHost = {
      getState: () => sceneStore.getState(),
      history: sceneHistory,
      toggleCheatSheet: () => setCheat((v) => !v),
      setShapeTool: (tool) => sceneStore.getState().setTool(tool),
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
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return; // 输入框内方向键正常编辑
      // 专注画布（2026-09-16）：Tab 进入/退出（输入框聚焦时不劫持）
      if (e.key === 'Tab') {
        e.preventDefault();
        if (focus) exitFocusMode();
        else enterFocusMode();
        return;
      }
      // Esc 退出专注（2026-09-17）：优先级 = 输入框守卫之后、快捷键分发之前——
      // 浮层（速查表/下拉菜单）开着时让位给浮层关闭，否则退出专注而非取消选中
      if (e.key === 'Escape' && focus && !cheat && !document.querySelector('.dd-menu')) {
        e.preventDefault();
        exitFocusMode();
        return;
      }
      // T-11.2：图元选中时方向键 = 微调图元（Shift 大步 10px）；否则平移视角
      if (e.key.startsWith('Arrow')) {
        e.preventDefault(); // 阻止页面滚动，不进入快捷键分发
        if (nudgeSelectedShapes(
          (e.key === 'ArrowLeft' ? -1 : 0) + (e.key === 'ArrowRight' ? 1 : 0),
          (e.key === 'ArrowUp' ? -1 : 0) + (e.key === 'ArrowDown' ? 1 : 0),
          e.shiftKey ? 10 : 1,
        )) {
          return; // 已消费（图元微调）
        }
        arrows.add(e.key.toLowerCase());
        if (!panRaf) panRaf = requestAnimationFrame(panLoop);
        return;
      }
      // T-11.2：图元选中时 Delete 优先删图元
      if ((e.key === 'Delete' || e.key === 'Backspace') && sceneStore.getState().shapeSelectionIds.length) {
        e.preventDefault();
        deleteSelectedShapes();
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

  const onRecover = (): void => {
    const ok = sceneStore.getState().loadScene(recover!.doc);
    if (!ok) rendererRef.current?.frameAll();
    setRecover(null);
  };
  const onDiscardRecover = (): void => {
    void clearAutosave();
    setRecover(null);
  };

  return (
    <div className="app">
      {recover && (
        <div
          role="status"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
            background: '#1f2937', color: '#e5e7eb', fontSize: 13,
            borderBottom: '1px solid #374151',
          }}
        >
          <span>📦 检测到上次未保存的场景（{new Date(recover.savedAt).toLocaleString()}）——软件退出前自动快照</span>
          <button className="mini" onClick={onRecover} style={{ padding: '2px 12px' }}>恢复</button>
          <button className="mini" onClick={onDiscardRecover} style={{ padding: '2px 12px' }}>忽略</button>
        </div>
      )}
      <TopBar />
      <main
        className="layout"
        style={{ gridTemplateColumns: `${leftOpen ? '216px' : '0px'} 1fr ${rightOpen ? '300px' : '0px'}` }}
      >
        {leftOpen ? <LibraryPanel /> : null}
        <section className="canvas">
          <SceneCanvas />
          <div className="canvas-badge">
            {focus
              ? '专注画布 · Esc 或「返回工作区」退出'
              : mode === 'diagram'
                ? '✏️ 2D 示意图'
                : '🧊 3D 混合'}
          </div>
          {/* 专注返回入口（2026-09-17）：左上角常驻可见，仅按钮自身接收点击 */}
          {focus && (
            <button className="focus-exit" title="恢复三栏工作区（Esc）" onClick={exitFocusMode}>
              ← 返回工作区
            </button>
          )}
          {/* 侧缘双向钮：开=折叠 ‹ / 关=展开 ›（替换原 0 宽列内不可见的恢复按钮） */}
          <button
            className={`side-fold left${leftOpen ? '' : ' closed'}`}
            title={leftOpen ? '收起素材库' : '展开素材库'}
            onClick={() => setLeftOpen((v) => !v)}
          >
            {leftOpen ? '‹' : '›'}
          </button>
          <button
            className={`side-fold right${rightOpen ? '' : ' closed'}`}
            title={rightOpen ? '收起参数面板' : '展开参数面板'}
            onClick={() => setRightOpen((v) => !v)}
          >
            {rightOpen ? '›' : '‹'}
          </button>
        </section>
        {rightOpen ? (
          <aside className="panel right">
            <ParamPanel />
            <LayerPanel />
          </aside>
        ) : null}
      </main>
      <footer className="statusbar">
        <StatusHint focus={focus} />
        <span className="status-right">
          {import.meta.env.DEV && <span>DEV · AGENTS 协议生效</span>}
          <span>Kaolin-Assets v0.2.0</span>
        </span>
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
