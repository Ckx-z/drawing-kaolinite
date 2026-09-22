/**
 * 应用壳 —— T-1.6 版：真实交互界面（素材库 / 画布 / 参数+图层）
 * 键盘：Delete/Backspace 删除选中、Esc 取消选中、Ctrl/Cmd+Z 撤销、
 *       Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做（T-2.1；输入框聚焦时跳过）。
 * 首次进入自动载入示例场景（对齐 demo 启动行为）。
 */
import { useEffect, useState } from 'react';
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
import { getPendingSnap } from '../state/dragSnap';
import SceneCanvas from './SceneCanvas';
import { SHORTCUTS, cheatsheetEntries, handleShortcut, type ShortcutHost } from './shortcuts';
import TopBar from './TopBar';

/** 上下文状态提示（2026-09-16）：订阅 tool/mode/选择态，复用 statusHint 纯函数 */
function StatusHint() {
  // 拖拽吸附提示（2026-09-22b）：pending 为模块态非 zustand——500ms 轮询低干扰提示
  const [snapHint, setSnapHint] = useState('');
  useEffect(() => {
    const t = setInterval(() => setSnapHint(getPendingSnap()?.substrateName ?? ''), 500);
    return () => clearInterval(t);
  }, []);
  const tool = useStore(sceneStore, (s) => s.tool);
  const mode = useStore(sceneStore, (s) => s.mode);
  const hasSel = useStore(
    sceneStore,
    (s) => Boolean(s.selectionId) || s.shapeSelectionIds.length > 0,
  );
  const multiN = useStore(sceneStore, (s) => s.componentSelectionIds.length);
  return (
    <span>
      {snapHint
        ? `松手自动贴合「${snapHint}」表面 · 按住 Alt/Shift 自由放置（Ctrl+Z 可撤销）`
        : statusHint({ tool, mode, hasSelection: hasSel, multiCount: multiN })}
    </span>
  );
}

export default function App() {
  const [cheat, setCheat] = useState(false);
  const [recover, setRecover] = useState<{ doc: SceneDocument; savedAt: number } | null>(null);
  // 右侧参数面板折叠（2026-09-16）：UI 态本地，不影响场景/相机
  const mode = useStore(sceneStore, (s) => s.mode);
  // 右侧参数面板折叠（2026-09-16，保留功能）；左侧素材库恒显（2026-09-17 按用户要求删除收起功能）
  const [rightOpen, setRightOpen] = useState(true);

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
        style={{ gridTemplateColumns: `216px 1fr ${rightOpen ? '300px' : '0px'}` }}
      >
        <LibraryPanel />
        <section className="canvas">
          <SceneCanvas />
          <div className="canvas-badge">{mode === 'diagram' ? '✏️ 2D 示意图' : '🧊 3D 混合'}</div>
          {/* 右侧参数面板折叠/展开（保留功能） */}
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
        <StatusHint />
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
