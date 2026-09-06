/**
 * 应用壳（T-1.4 版）
 * 三栏布局与 demo/index.html 对齐：左素材库 / 中画布 / 右参数+图层。
 * ?preview=1 时挂载 RendererService 并载入 demo 预设场景（T-1.4 渲染验收入口）。
 * 各面板由 T-1.5（状态）/ T-1.6（面板迁移）逐一点亮。
 */
import { useEffect, useRef } from 'react';
import kaoliniteCif from '../../data/kaolinite.cif?raw';
import { RendererService } from '../render/RendererService';
import { createPreviewComponents } from './preview';

const IS_PREVIEW = new URLSearchParams(window.location.search).has('preview');

const ROADMAP: Array<{ id: string; name: string; status: 'done' | 'next' | 'todo' }> = [
  { id: 'T-1.1', name: '工程脚手架', status: 'done' },
  { id: 'T-1.2', name: '数据模型与 Schema', status: 'done' },
  { id: 'T-1.3', name: '几何内核 TS 移植', status: 'done' },
  { id: 'T-1.4', name: '渲染服务', status: 'done' },
  { id: 'T-1.5', name: '场景图状态管理', status: 'next' },
  { id: 'T-1.6', name: '面板与画布迁移', status: 'todo' },
];

const statusLabel: Record<(typeof ROADMAP)[number]['status'], string> = {
  done: '✅',
  next: '▶ 下一任务',
  todo: '待开发',
};

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!IS_PREVIEW || !hostRef.current) return;
    const svc = new RendererService(hostRef.current);
    svc.setCifText(kaoliniteCif);
    createPreviewComponents().forEach((c) => svc.addComponent(c));
    svc.frameAll();
    (window as unknown as { __KPREVIEW: unknown }).__KPREVIEW = svc.stats();
    return () => svc.dispose();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span> Kaolin-Assets
          <em>高岭土机理图绘制软件 · 生产工程 v0.1.0</em>
        </div>
        <div className="badge">
          {IS_PREVIEW ? 'T-1.4 渲染预览（?preview=1）' : 'T-1.4 渲染服务就绪'}
        </div>
      </header>

      <main className="layout">
        <aside className="panel left">
          <h3>素材库</h3>
          <p className="hint">T-1.6 迁移点亮（基线：demo/index.html）</p>
        </aside>

        <section className="canvas">
          <div ref={hostRef} className="canvas-host" />
          {!IS_PREVIEW && (
            <div className="canvas-empty">
              <div className="mark">◈</div>
              <h2>三维画布位</h2>
              <p>
                渲染服务已就绪（T-1.4）—— 访问 <code>?preview=1</code> 查看真实渲染
              </p>
              <p className="sub">可运行基线：双击打开 <code>demo/index.html</code></p>
            </div>
          )}
        </section>

        <aside className="panel right">
          <h3>阶段 1 · 工程基座（P0）</h3>
          <ul className="roadmap">
            {ROADMAP.map((t) => (
              <li key={t.id} className={t.status}>
                <span className="tid">{t.id}</span> {t.name}
                <span className="st">{statusLabel[t.status]}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      <footer className="statusbar">
        <span>node 工程：npm run dev / build / test / lint</span>
        <span>记忆系统：AGENTS.md 会话协议已生效</span>
      </footer>
    </div>
  );
}
