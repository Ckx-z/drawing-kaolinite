/**
 * 下拉菜单智能定位回归（Bug 修复 2026-11-04：第二行靠左的导出菜单溢出窗口左界）
 *
 * resolveDropdownPosition 纯函数：
 * - 水平：align 偏好 + 越界自动换向 + margin 夹紧（按钮靠左/靠右/居中/超窄视口）
 * - 垂直：下方优先 → 上方翻转 → 双侧不足限高滚动
 */
import { describe, expect, it } from 'vitest';
import { DD_MARGIN, DD_GAP, resolveDropdownPosition } from './primitives';

const base = {
  menuWidth: 250,
  menuHeight: 300,
  viewportW: 1280,
  viewportH: 800,
  align: 'right' as const,
};

/** 视口内水平完全可见 */
const withinHorizontally = (leftOffset: number, triggerLeft: number, menuWidth: number, vw: number): boolean => {
  const left = triggerLeft + leftOffset;
  return left >= DD_MARGIN - 0.01 && left + menuWidth <= vw - DD_MARGIN + 0.01;
};

describe('水平定位（Bug 回归：第二行靠左不再溢出左界）', () => {
  it('Bug 场景：第二行靠左按钮（root left=8, right≈98）→ 菜单向右展开，左缘 ≈ 8px', () => {
    const pos = resolveDropdownPosition({
      ...base,
      trigger: { left: 8, right: 98, top: 90, bottom: 122 },
    });
    const left = 8 + pos.leftOffset;
    expect(left).toBeGreaterThanOrEqual(DD_MARGIN - 0.01); // 不再越出左界
    expect(left + base.menuWidth).toBeLessThanOrEqual(1280 - DD_MARGIN + 0.01);
  });

  it('按钮靠右（第一行常规位置）→ 保持右对齐贴按钮', () => {
    const trigger = { left: 1120, right: 1272, top: 10, bottom: 42 };
    const pos = resolveDropdownPosition({ ...base, trigger });
    const left = trigger.left + pos.leftOffset;
    expect(left + base.menuWidth).toBeCloseTo(1272, 0); // 右对齐原语义
    expect(withinHorizontally(pos.leftOffset, trigger.left, base.menuWidth, 1280)).toBe(true);
  });

  it('align=left 偏好靠右按钮越出右界 → 自动换向右对齐', () => {
    const trigger = { left: 1120, right: 1272, top: 10, bottom: 42 };
    const pos = resolveDropdownPosition({ ...base, align: 'left', trigger });
    const left = trigger.left + pos.leftOffset;
    expect(left).toBeGreaterThanOrEqual(DD_MARGIN - 0.01);
    expect(left + base.menuWidth).toBeLessThanOrEqual(1280 - DD_MARGIN + 0.01);
  });

  it('中间位置正常对齐（右对齐不溢出时不干预）', () => {
    const trigger = { left: 600, right: 752, top: 10, bottom: 42 };
    const pos = resolveDropdownPosition({ ...base, trigger });
    const left = trigger.left + pos.leftOffset;
    expect(left + base.menuWidth).toBeCloseTo(752, 0); // 右缘贴触发器右缘
  });

  it('超窄视口（400px）：菜单宽度夹紧 + 左右都留 margin', () => {
    const pos = resolveDropdownPosition({
      ...base,
      menuWidth: 250,
      viewportW: 400,
      trigger: { left: 8, right: 98, top: 90, bottom: 122 },
    });
    const left = 8 + pos.leftOffset;
    expect(left).toBeGreaterThanOrEqual(DD_MARGIN - 0.01);
    expect(left + Math.min(base.menuWidth, 400 - DD_MARGIN * 2)).toBeLessThanOrEqual(400 - DD_MARGIN + 0.01);
  });
});

describe('垂直定位（下方优先 / 上方翻转 / 限高滚动）', () => {
  it('下方空间充足 → 向下展开不限高', () => {
    const pos = resolveDropdownPosition({
      ...base,
      trigger: { left: 600, right: 752, top: 60, bottom: 92 },
      viewportH: 800,
    });
    expect(pos.below).toBe(true);
    expect(pos.maxHeight).toBeUndefined();
  });

  it('下方不足、上方宽裕 → 向上翻转', () => {
    const pos = resolveDropdownPosition({
      ...base,
      menuHeight: 300,
      trigger: { left: 600, right: 752, top: 700, bottom: 732 }, // 底部只剩 ~60px
      viewportH: 800,
    });
    expect(pos.below).toBe(false);
  });

  it('上下都不足 → 限高（≥120，内部滚动，菜单项仍可及）', () => {
    // trigger top=390 bottom=400：spaceBelow=800-400-12=388，spaceAbove=390-12=378
    // 菜单 500 高于双侧 → 向下展开并限高 388（不翻转：上方并不更宽裕）
    const pos = resolveDropdownPosition({
      ...base,
      menuHeight: 500,
      trigger: { left: 600, right: 752, top: 390, bottom: 400 },
      viewportH: 800,
    });
    expect(pos.below).toBe(true);
    expect(pos.maxHeight).toBeGreaterThanOrEqual(120);
    expect(pos.maxHeight!).toBeLessThanOrEqual(800 - 400 - DD_GAP - DD_MARGIN + 1);
  });
});

describe('窗口连续变化（打开态 resize 跟随的定位输入）', () => {
  it('1280 → 1024 → 800：按钮位置随换行变化，每次计算结果都在视口内', () => {
    // 顶栏换行模拟：宽度越窄，第二行的导出按钮越靠左
    const scenarios: Array<[number, { left: number; right: number; top: number; bottom: number }]> = [
      [1280, { left: 900, right: 1052, top: 10, bottom: 42 }],
      [1024, { left: 8, right: 98, top: 90, bottom: 122 }], // 换到第二行靠左
      [800, { left: 8, right: 98, top: 90, bottom: 122 }],
    ];
    for (const [vw, trigger] of scenarios) {
      const pos = resolveDropdownPosition({ ...base, viewportW: vw, viewportH: 700, trigger });
      const left = trigger.left + pos.leftOffset;
      expect(left).toBeGreaterThanOrEqual(DD_MARGIN - 0.01);
      expect(left + Math.min(base.menuWidth, vw - DD_MARGIN * 2)).toBeLessThanOrEqual(vw - DD_MARGIN + 0.01);
    }
  });
});
