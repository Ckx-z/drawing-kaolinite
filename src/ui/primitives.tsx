/**
 * 轻量 UI primitives（2026-09-16 UI 信息架构重构）
 * 零第三方依赖：DropdownMenu / SegmentedControl / AccordionSection / SidebarTabs
 * 全部复用 index.css 变量（--acc/--panel2/--line 等）与现有暗色风格；
 * UI 状态（开合/选中段）均为组件本地，不写 store / 场景文档。
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const DDContext = createContext<() => void>(() => {});

/** 下拉菜单：主按钮 + ▾；点击外部 / Esc 关闭；菜单体支持分隔线与内嵌控件。
 * onMainClick 提供时：主按钮执行主动作（如导出最近格式），▾ 独立开菜单；
 * 否则整个按钮开菜单。MenuItem 点击后自动关闭。 */
export function DropdownMenu(props: {
  label: ReactNode;
  title?: string;
  /** 按钮附加类（primary/mini 等） */
  btnClass?: string;
  children: ReactNode;
  /** 主按钮主动作（可选；提供时 ▾ 区单独负责开菜单） */
  onMainClick?: () => void;
  /** 菜单对齐：右对齐（默认，靠右缘防溢出）或左对齐 */
  align?: 'left' | 'right';
  /** 菜单最小宽度（px） */
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const main = props.onMainClick;
  return (
    <DDContext.Provider value={() => setOpen(false)}>
      <div className={`dd-root${main ? ' split' : ''}`} ref={rootRef}>
        <button
          type="button"
          className={props.btnClass ?? 'mini'}
          title={props.title}
          onClick={main ?? (() => setOpen((v) => !v))}
        >
          {props.label}
          {!main && ' '}
          {!main && <span className="dd-caret">▾</span>}
        </button>
        {main && (
          <button type="button" className="dd-caret-btn" title="更多选项" onClick={() => setOpen((v) => !v)}>
            ▾
          </button>
        )}
        {open && (
          <div className="dd-menu" style={{ minWidth: props.width, [props.align ?? 'right']: 0 } as React.CSSProperties}>
            {props.children}
          </div>
        )}
      </div>
    </DDContext.Provider>
  );
}

/** 菜单项：点击后自动关闭菜单（内嵌设置区用 MenuBlock） */
export function MenuItem(props: { onClick?: () => void; title?: string; children: ReactNode; danger?: boolean }) {
  const close = useContext(DDContext);
  return (
    <button
      type="button"
      className={`dd-item${props.danger ? ' danger' : ''}`}
      title={props.title}
      onClick={() => {
        close();
        props.onClick?.();
      }}
    >
      {props.children}
    </button>
  );
}

/** 菜单分隔线 */
export function MenuSep(): ReactNode {
  return <div className="dd-sep" />;
}

/** 菜单内嵌区块（不放 onClick，用于设置项容器） */
export function MenuBlock(props: { children: ReactNode }) {
  return <div className="dd-block">{props.children}</div>;
}

/** 分段切换（工作模式等）：激活段橙色高亮，视觉权重高于普通工具按钮 */
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div className="seg" title={props.title} role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={props.value === o.value}
          className={`seg-btn${props.value === o.value ? ' on' : ''}`}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 折叠区（参数分组等）：open 受控由调用方持有（本地 useState，不进 store） */
export function AccordionSection(props: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`acc${props.open ? ' open' : ''}`}>
      <button type="button" className="acc-head" onClick={props.onToggle}>
        <span className="acc-caret">{props.open ? '▾' : '▸'}</span>
        {props.title}
      </button>
      {props.open && <div className="acc-body">{props.children}</div>}
    </div>
  );
}

/** 侧栏 Tabs（基础素材/我的模块/模板） */
export function SidebarTabs<T extends string>(props: {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="side-tabs">
      {props.tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          className={`side-tab${props.value === t.value ? ' on' : ''}`}
          onClick={() => props.onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
