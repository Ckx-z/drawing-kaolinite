import { describe, expect, it } from 'vitest';
import { enterFocus, exitFocus, isFocus, SIDEBARS_OPEN, type SidebarState } from './focusMode';

/** 专注画布状态机（2026-09-17 修复被困 bug）：四场景矩阵 + 幂等 + 无快照兜底 */
describe('focusMode', () => {
  const cases: Array<[string, SidebarState]> = [
    ['左右都开', { left: true, right: true }],
    ['左开右关', { left: true, right: false }],
    ['左关右开', { left: false, right: true }],
    ['左右都关', { left: false, right: false }],
  ];

  for (const [name, before] of cases) {
    it(`${name} → 进入(两侧全关) → 退出(原样恢复)`, () => {
      const { snapshot, next } = enterFocus(null, before);
      expect(next).toEqual({ left: false, right: false });
      expect(isFocus(next)).toBe(true);
      expect(exitFocus(snapshot)).toEqual(before); // 场景 A/B/C/D 全部原样恢复
    });
  }

  it('幂等：重复进入不覆盖首次快照；连续进出状态不漂移', () => {
    // 左开右关 → 进入 → （中途手动全开）→ 再进入 → 退出应回到首次快照
    const first = enterFocus(null, { left: true, right: false });
    const second = enterFocus(first.snapshot, { left: true, right: true }); // 已有快照
    expect(second.snapshot).toEqual({ left: true, right: false }); // 首次快照保留
    expect(exitFocus(second.snapshot)).toEqual({ left: true, right: false });
    // 连续 3 轮进出
    let snap: SidebarState | null = null;
    for (let i = 0; i < 3; i++) {
      const r = enterFocus(snap, { left: true, right: false });
      snap = r.snapshot;
      expect(exitFocus(snap)).toEqual({ left: true, right: false });
    }
  });

  it('无快照退出回全开（兜底）', () => {
    expect(exitFocus(null)).toEqual(SIDEBARS_OPEN);
  });

  it('isFocus：仅两侧皆关为专注态（单侧折叠不算）', () => {
    expect(isFocus({ left: false, right: false })).toBe(true);
    expect(isFocus({ left: true, right: false })).toBe(false);
    expect(isFocus({ left: false, right: true })).toBe(false);
  });
});
