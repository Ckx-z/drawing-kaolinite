/**
 * 应用壳（T-1.1 脚手架占位版）
 * 三栏布局与 demo/index.html 对齐：左素材库 / 中画布 / 右参数+图层。
 * 各面板由后续任务逐一点亮：T-1.4 渲染服务 → T-1.5 状态 → T-1.6 面板迁移。
 */

const ROADMAP: Array<{ id: string; name: string; status: 'done' | 'next' | 'todo' }> = [
  { id: 'T-1.1', name: '工程脚手架', status: 'done' },
  { id: 'T-1.2', name: '数据模型与 Schema', status: 'next' },
  { id: 'T-1.3', name: '几何内核 TS 移植', status: 'todo' },
  { id: 'T-1.4', name: '渲染服务', status: 'todo' },
  { id: 'T-1.5', name: '场景图状态管理', status: 'todo' },
  { id: 'T-1.6', name: '面板与画布迁移', status: 'todo' },
];

const statusLabel: Record<typeof ROADMAP[number]['status'], string> = {
  done: '✅',
  next: '▶ 下一任务',
  todo: '待开发',
};

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span> Kaolin-Assets
          <em>高岭土机理图绘制软件 · 生产工程 v0.1.0</em>
        </div>
        <div className="badge">T-1.1 脚手架就绪</div>
      </header>

      <main className="layout">
        <aside className="panel left">
          <h3>素材库</h3>
          <p className="hint">T-1.6 迁移点亮（基线：demo/index.html）</p>
        </aside>

        <section className="canvas">
          <div className="canvas-empty">
            <div className="mark">◈</div>
            <h2>三维画布位</h2>
            <p>渲染服务（T-1.4）就位后，此处将呈现 Three.js 视口</p>
            <p className="sub">当前可运行基线：双击打开 <code>demo/index.html</code></p>
          </div>
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
