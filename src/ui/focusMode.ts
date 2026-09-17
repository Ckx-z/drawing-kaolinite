/**
 * 专注画布模式（2026-09-17 可用性修复）：纯状态逻辑。
 * 进入时快照侧栏开合，退出恢复原状（不强制全开——用户进入前可能手动
 * 折叠过一侧）；重复进入不覆盖首次快照（幂等，连续进出状态不漂移）。
 * UI 视图态：不进场景文档、不进 undo 栈。
 */
export interface SidebarState {
  left: boolean;
  right: boolean;
}

export const SIDEBARS_OPEN: SidebarState = { left: true, right: true };

/** 进入专注：返回 { 应保存的快照, 下一侧栏态 }。已有快照保持不变（幂等）。 */
export function enterFocus(snapshot: SidebarState | null, cur: SidebarState): {
  snapshot: SidebarState;
  next: SidebarState;
} {
  return {
    snapshot: snapshot ?? { ...cur },
    next: { left: false, right: false },
  };
}

/** 退出专注：恢复快照（无快照回全开）。 */
export function exitFocus(snapshot: SidebarState | null): SidebarState {
  return snapshot ? { ...snapshot } : { ...SIDEBARS_OPEN };
}

/** 专注态判定：两侧皆关（含手动分别折叠至全关——同样显示返回入口，D 场景）。 */
export function isFocus(s: SidebarState): boolean {
  return !s.left && !s.right;
}
