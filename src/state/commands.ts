/**
 * 撤销/重做命令基础 —— T-2.1（Command Pattern）
 *
 * 实现取舍：命令 = 执行前后的**全量状态快照**（components + selectionId），
 * 而不是逐字段的正向/逆向 delta。
 * 理由：
 *  - store 状态只有参数与变换（存参数不存网格，D02），单次快照 ~几 KB，成本可忽略；
 *  - 快照天然满足验收标准"撤销到底再重做到顶，场景状态与操作前逐字段一致"；
 *  - loadScene / clear 这类整体替换型操作无需为它们单独推导逆操作。
 * 快照一律深拷贝，与栈外任何引用隔离（store 的写操作本身均为不可变更新）。
 */
import type { SceneEntry, SceneState } from './sceneStore';

/** 场景状态快照（深拷贝，独立于 store 内的引用） */
export interface Snapshot {
  components: SceneEntry[];
  selectionId: string | null;
}

/** 一条已执行命令：记录执行前后的完整状态 */
export interface Command {
  /** 人类可读标签（调试 / 未来历史面板用） */
  label: string;
  /** 合并键：连续同类操作（滑块拖动）在窗口期内合并为一条命令；null = 不合并 */
  key: string | null;
  before: Snapshot;
  /** 命令执行后的状态；timestamp 仅用于合并窗口判定，回放时忽略 */
  after: Snapshot & { timestamp?: number };
}

export function takeSnapshot(state: Pick<SceneState, 'components' | 'selectionId'>): Snapshot {
  return {
    components: structuredClone(state.components),
    selectionId: state.selectionId,
  };
}

/** 快照回放：整体替换 components 与 selection（触发 rendererBinding 差异同步） */
export function applySnapshot(store: { setState: (partial: Partial<SceneState>) => void }, snap: Snapshot): void {
  store.setState({
    components: structuredClone(snap.components),
    selectionId: snap.selectionId,
  });
}

export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return a.selectionId === b.selectionId && JSON.stringify(a.components) === JSON.stringify(b.components);
}
