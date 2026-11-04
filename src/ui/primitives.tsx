/**
 * 轻量 UI primitives（2026-09-16 UI 信息架构重构）
 * 零第三方依赖：DropdownMenu / SegmentedControl / AccordionSection
 * 全部复用 index.css 变量（--acc/--panel2/--line 等）与现有暗色风格；
 * UI 状态（开合/选中段）均为组件本地，不写 store / 场景文档。
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const DDContext = createContext<() => void>(() => {});

/** 下拉菜单弹出定位（纯函数，可单测）：
 * 水平 = 优先 align，越出视口（含 margin 安全边距）自动换向，仍越界则夹紧；
 * 垂直 = 优先下方展开，下方不足且上方更宽裕时向上，两侧都不足时夹到下方并
 * 限高（内部滚动）。坐标为相对触发器（.dd-root）的偏移。
 */
export interface DropdownPosInput {
  trigger: { left: number; right: number; top: number; bottom: number };
  menuWidth: number;
  menuHeight: number;
  viewportW: number;
  viewportH: number;
  align: 'left' | 'right';
  margin?: number;
}

export interface DropdownPos {
  /** 相对触发器左缘的偏移（px；可为负 = 向左展开） */
  leftOffset: number;
  /** true = 向下展开（topOffset = 触发器高度+4）；false = 向上（bottomOffset 同理） */
  below: boolean;
  /** 两侧都不足时的最大高度（内部滚动）；undefined = 不限 */
  maxHeight?: number;
}

export const DD_MARGIN = 8;
export const DD_GAP = 4;

export function resolveDropdownPosition(input: DropdownPosInput): DropdownPos {
  const m = input.margin ?? DD_MARGIN;
  const width = Math.min(input.menuWidth, Math.max(input.viewportW - m * 2, 120));
  // 水平：align 给出初始锚点（right = 菜单右缘贴触发器右缘；left = 左缘贴左缘）
  let left = input.align === 'left' ? input.trigger.left : input.trigger.right - width;
  if (left < m) left = m; // 越出左界 → 夹紧（按钮靠左的第二行场景）
  if (left + width > input.viewportW - m) left = input.viewportW - m - width; // 越出右界 → 夹紧
  const leftOffset = left - input.trigger.left;

  // 垂直：下方优先
  const spaceBelow = input.viewportH - input.trigger.bottom - DD_GAP - m;
  const spaceAbove = input.trigger.top - DD_GAP - m;
  let below = true;
  let maxHeight: number | undefined;
  if (input.menuHeight > spaceBelow) {
    if (spaceAbove > spaceBelow) {
      below = false;
      if (input.menuHeight > spaceAbove) maxHeight = Math.max(spaceAbove, 120);
    } else {
      maxHeight = Math.max(spaceBelow, 120);
    }
  }
  return { leftOffset, below, maxHeight };
}

/** 下拉菜单：主按钮 + ▾；点击外部 / Esc 关闭；菜单体支持分隔线与内嵌控件。
 * onMainClick 提供时：主按钮执行主动作（如导出最近格式），▾ 独立开菜单；
 * 否则整个按钮开菜单。MenuItem 点击后自动关闭。
 * 定位：打开后测量触发器与菜单实际尺寸，经 resolveDropdownPosition 智能定位
 * （按钮在第二行/靠左时向右展开、靠右向左展开、上下翻转、限高滚动），
 * 并随窗口 resize 实时跟随——工具栏换行不再溢出窗口（Bug 修复 2026-11-04）。 */
export function DropdownMenu(props: {
  label: ReactNode;
  title?: string;
  /** 按钮附加类（primary/mini 等） */
  btnClass?: string;
  children: ReactNode;
  /** 主按钮主动作（可选；提供时 ▾ 区单独负责开菜单） */
  onMainClick?: () => void;
  /** 菜单对齐偏好：右对齐（默认）或左对齐——越出视口时仍有安全修正 */
  align?: 'left' | 'right';
  /** 菜单最小宽度（px） */
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // null = 待测量（先隐藏渲染），测量后写入定位样式
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const lastSizeRef = useRef<{ w: number; h: number }>({ w: props.width ?? 250, h: 200 });
  const align = props.align ?? 'right';

  const measure = useCallback((): void => {
    const root = rootRef.current;
    const menu = menuRef.current;
    if (!root || !menu) return;
    const t = root.getBoundingClientRect();
    lastSizeRef.current = { w: menu.offsetWidth, h: menu.offsetHeight };
    setPos(
      resolveDropdownPosition({
        trigger: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
        menuWidth: menu.offsetWidth,
        menuHeight: menu.offsetHeight,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        align,
      }),
    );
  }, [align]);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, props.children, measure]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    // 菜单跟随（不依赖 resize 事件——换行/缩放/字体加载一律覆盖）：
    // 打开期间每帧比对触发器矩形与视口，变化即重测（单次 rect 读取，代价可忽略）
    let lastKey = '';
    let followRaf = 0;
    const follow = (): void => {
      followRaf = requestAnimationFrame(follow);
      const root = rootRef.current;
      if (!root) return;
      const t = root.getBoundingClientRect();
      const key = `${t.left.toFixed(1)}|${t.top.toFixed(1)}|${t.right.toFixed(1)}|${innerWidth}x${innerHeight}`;
      if (key !== lastKey) {
        lastKey = key;
        measure();
      }
    };
    followRaf = requestAnimationFrame(follow);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(followRaf);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      setPos(null);
    };
  }, [open, measure]);

  const main = props.onMainClick;
  const menuStyle: React.CSSProperties = {
    minWidth: props.width,
    visibility: pos ? 'visible' : 'hidden',
    ...(pos
      ? {
          left: pos.leftOffset,
          right: 'auto',
          top: pos.below ? 'calc(100% + 4px)' : 'auto',
          bottom: pos.below ? 'auto' : 'calc(100% + 4px)',
          ...(pos.maxHeight ? { maxHeight: pos.maxHeight, overflowY: 'auto' as const } : {}),
        }
      : ({} as React.CSSProperties)),
  };
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
          <div className="dd-menu" ref={menuRef} style={menuStyle}>
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

