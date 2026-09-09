/**
 * 撤销/重做命令基础 —— T-2.1（Command Pattern；T-11.4 扩展 shapes/annotations/palette）
 *
 * 实现取舍：命令 = 执行前后的**全量状态快照**（components + selectionId +
 * shapes + annotations + palette），而不是逐字段的正向/逆向 delta。
 * 理由：
 *  - store 状态只有参数与变换（存参数不存网格，D02），单次快照 ~几 KB，成本可忽略；
 *  - 快照天然满足验收标准"撤销到底再重做到顶，场景状态与操作前逐字段一致"；
 *  - loadScene / clear 这类整体替换型操作无需为它们单独推导逆操作。
 * 快照一律深拷贝，与栈外任何引用隔离（store 的写操作本身均为不可变更新）。
 */
import type { SceneShape } from '../core/shapes/schema';
import type { Annotation, PaletteSetting } from '../core/types';
import type { SceneEntry, SceneState } from './sceneStore';

/** 场景状态快照（深拷贝，独立于 store 内的引用） */
export interface Snapshot {
  components: SceneEntry[];
  selectionId: string | null;
  /** T-11.4：图元层（此前标注/图元不入快照 → 不可撤销的欠债，本次一并偿还） */
  shapes: SceneShape[];
  annotations: Annotation[];
  palette: PaletteSetting;
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

export function takeSnapshot(
  state: Pick<SceneState, 'components' | 'selectionId' | 'shapes' | 'annotations' | 'palette'>,
): Snapshot {
  return {
    components: structuredClone(state.components),
    selectionId: state.selectionId,
    shapes: structuredClone(state.shapes),
    annotations: structuredClone(state.annotations),
    palette: structuredClone(state.palette),
  };
}

/** 快照回放：整体替换场景数据（触发 rendererBinding 差异同步；overlay 直读 store 同步） */
export function applySnapshot(store: { setState: (partial: Partial<SceneState>) => void }, snap: Snapshot): void {
  // 图元选中指向快照后已不存在的 id → 过滤悬空（选择是视图状态，不入栈）
  const alive = new Set(snap.shapes.map((s) => s.id));
  const live = store as unknown as { getState: () => SceneState };
  const kept = live.getState().shapeSelectionIds.filter((id) => alive.has(id));
  store.setState({
    components: structuredClone(snap.components),
    selectionId: snap.selectionId,
    shapes: structuredClone(snap.shapes),
    annotations: structuredClone(snap.annotations),
    palette: structuredClone(snap.palette),
    shapeSelectionIds: kept,
  });
}

export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    a.selectionId === b.selectionId &&
    JSON.stringify(a.components) === JSON.stringify(b.components) &&
    JSON.stringify(a.shapes) === JSON.stringify(b.shapes) &&
    JSON.stringify(a.annotations) === JSON.stringify(b.annotations) &&
    JSON.stringify(a.palette) === JSON.stringify(b.palette)
  );
}
