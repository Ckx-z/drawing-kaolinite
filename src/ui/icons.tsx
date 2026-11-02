/**
 * 线性图标集（UI 重构 2026-10-22）：统一 24 viewBox / 1.8 描边 / currentColor，
 * 风格对齐参考截图（简洁线性、圆角端点）。零外部依赖（不引入图标库）。
 * 尺寸经 size prop 控制（默认 20），颜色继承父级 color。
 */
interface IconProps {
  size?: number;
}

const base = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** 导入：文件 + 入箭头（参考截图②） */
export function IconImport({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M12 11v6" />
      <path d="M9.2 14.2 12 17l2.8-2.8" />
    </svg>
  );
}

/** 保存：软盘（参考截图③） */
export function IconSave({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M4.5 4.5h11L20.5 9.5v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z" transform="translate(1.5 0) scale(0.9)" />
      <path d="M8 4.5v5h7v-5" />
      <path d="M8 20.5v-6h8v6" />
    </svg>
  );
}

/** 后退：左弯箭头（参考截图④） */
export function IconUndo({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M8.5 5.5 4 10l4.5 4.5" />
      <path d="M4 10h10a6 6 0 0 1 6 6v2.5" />
    </svg>
  );
}

/** 前进：右弯箭头（参考截图④） */
export function IconRedo({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M15.5 5.5 20 10l-4.5 4.5" />
      <path d="M20 10H10a6 6 0 0 0-6 6v2.5" />
    </svg>
  );
}

/** 清空：画笔（参考截图⑤） */
export function IconClear({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M19.5 4.5a2.1 2.1 0 0 0-3 0L6 15l-1.5 4.5L9 18 19.5 7.5a2.1 2.1 0 0 0 0-3z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** 全屏：四角外扩（参考截图⑥） */
export function IconFullscreen({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M9 4H4v5" />
      <path d="M15 4h5v5" />
      <path d="M9 20H4v-5" />
      <path d="M15 20h5v-5" />
    </svg>
  );
}

/** 退出全屏：四角内收 */
export function IconExitFullscreen({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M4 9h5V4" />
      <path d="M20 9h-5V4" />
      <path d="M4 15h5v5" />
      <path d="M20 15h-5v5" />
    </svg>
  );
}

/** 模型：立方体（左栏导航） */
export function IconModel({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <path d="M12 2.8 20.2 7v10L12 21.2 3.8 17V7z" />
      <path d="M3.8 7 12 11.3 20.2 7" />
      <path d="M12 11.3v9.9" />
    </svg>
  );
}

/** 收藏：星形（左栏导航 / 卡片角标） */
export function IconStar({ size = 20, filled = false }: IconProps & { filled?: boolean }): React.ReactElement {
  return (
    <svg {...base(size)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z" />
    </svg>
  );
}

/** 模板：网格（左栏导航，保留入口） */
export function IconTemplate({ size = 20 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" />
    </svg>
  );
}

/** 搜索：放大镜 */
export function IconSearch({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg {...base(size)}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15.2 15.2 20 20" />
    </svg>
  );
}
