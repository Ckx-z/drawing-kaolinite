import { describe, expect, it } from 'vitest';
import { statusHint } from './statusHints';

/** 状态栏上下文提示（2026-09-16）：选择态优先于工具态；2D 模式附加画布操作 */
describe('statusHint', () => {
  it('选择工具无选中：基础操作提示', () => {
    const h = statusHint({ tool: 'select', mode: 'mixed', hasSelection: false, multiCount: 0 });
    expect(h).toContain('点击选中');
    expect(h).toContain('键长');
  });

  it('绘制工具：各自专属提示', () => {
    expect(statusHint({ tool: 'arrow', mode: 'mixed', hasSelection: false, multiCount: 0 })).toContain('拖拽绘制箭头');
    expect(statusHint({ tool: 'text', mode: 'mixed', hasSelection: false, multiCount: 0 })).toContain('放置文本');
    expect(statusHint({ tool: 'rect', mode: 'diagram', hasSelection: false, multiCount: 0 })).toContain('Esc');
  });

  it('有选中/多选优先于工具提示', () => {
    expect(statusHint({ tool: 'rect', mode: 'mixed', hasSelection: true, multiCount: 0 })).toContain('Delete 删除');
    const m = statusHint({ tool: 'select', mode: 'mixed', hasSelection: true, multiCount: 3 });
    expect(m).toContain('已选 3 个组件');
    expect(m).toContain('批量');
  });

  it('2D 模式附加平移/缩放提示；3D 模式不带', () => {
    expect(statusHint({ tool: 'select', mode: 'diagram', hasSelection: false, multiCount: 0 })).toContain('平移');
    expect(statusHint({ tool: 'select', mode: 'mixed', hasSelection: false, multiCount: 0 })).not.toContain('空格');
  });

});
