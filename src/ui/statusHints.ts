/**
 * 状态栏上下文提示（2026-09-16）：按当前工具/模式/选择态给出最相关的操作提示。
 * 完整快捷键仍由 ? 速查浮层承载（SHORTCUTS 注册表单一事实源，本文件不重复维护键位）。
 */
import type { ShapeTool } from '../core/shapes/schema';

export interface StatusInput {
  tool: ShapeTool;
  mode: 'mixed' | 'diagram';
  /** 专注画布模式（2026-09-17）：附加 Esc 返回提示 */
  focus?: boolean;
  /** 组件或图元是否有选中 */
  hasSelection: boolean;
  /** 组件多选数（≥2 时） */
  multiCount: number;
}

const TOOL_HINT: Record<ShapeTool, string> = {
  select: '点击选中 · Shift 多选组件 · Alt+点击原子测键长/键角 · 拖动移动',
  rect: '拖拽绘制矩形 · Esc 取消回选择工具',
  ellipse: '拖拽绘制椭圆 · Esc 取消',
  arrow: '拖拽绘制箭头（端点靠近组件自动锚定跟随）· Esc 取消',
  line: '拖拽绘制连线 · Esc 取消',
  text: '点击画布放置文本 · 双击文本编辑内容',
};

/** 上下文提示（选择态优先于工具态；2D 模式附加画布操作） */
export function statusHint(i: StatusInput): string {
  const parts: string[] = [];
  if (i.multiCount >= 2) parts.push(`已选 ${i.multiCount} 个组件 · 右侧批量区对齐/等距/统一参数 · Esc 取消`);
  else if (i.hasSelection) parts.push('拖动移动 · Delete 删除 · H 显隐 · Ctrl+D 原地副本');
  else parts.push(TOOL_HINT[i.tool]);
  if (i.mode === 'diagram') parts.push('空格/中键拖拽平移 · 滚轮缩放');
  if (i.focus) parts.push('Esc 返回工作区');
  return parts.join(' · ');
}
