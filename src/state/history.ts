/**
 * 撤销/重做历史栈 —— T-2.1
 *
 * 用法：attachHistory(store) 把 store 的全部**场景写操作**（加删组件、参数、变换、
 * 显隐、锁定、重命名、载入、清空）包装为可逆命令；方法签名不变，UI 调用点零改动。
 *
 * 设计要点：
 *  - select() 不入栈：选中是视图状态而非场景状态；
 *  - 连续同类参数/变换更新（滑块拖动、gizmo 拖拽）在 mergeWindowMs 内合并为一条，
 *    一次 Ctrl+Z 撤销整个拖动过程，而不是每个 tick 一步；
 *  - 执行失败的操作（zod 校验抛错、目标不存在）不产生历史记录；
 *  - 栈深上限可配（默认 100），超出丢弃最旧命令；
 *  - 录制期间（undo/redo 回放）不再入栈，避免自吞尾巴；
 *  - rendererBinding 订阅的是同一 store，undo/redo 自动触发渲染差异同步。
 */
import { applySnapshot, sameSnapshot, takeSnapshot, type Command, type Snapshot } from './commands';
import type { SceneState, SceneStore } from './sceneStore';

export interface HistoryOptions {
  /** 栈深上限（每方向），默认 100 */
  limit?: number;
  /** 连续同类操作合并窗口（ms），默认 800；单测注入 0 关闭合并 */
  mergeWindowMs?: number;
  /** 时钟注入（单测确定性） */
  now?: () => number;
}

export interface History {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** 丢弃全部历史（载入新工程等场景可调用；不改变当前状态） */
  clearHistory: () => void;
  /** 当前栈深（调试/测试用） */
  depths: () => { undo: number; redo: number };
}

/** 需要 track 的写操作名（与 SceneState 方法签名逐一对应） */
const TRACKED = [
  'addComponent',
  'removeComponent',
  'setVisibility',
  'toggleLock',
  'groupComponents',
  'ungroupComponents',
  'updateParams',
  'setTransform',
  'renameComponent',
  'loadScene',
  'clear',
  // T-11.4：图元层写操作 + 标注/色板（偿还"标注不可撤销"欠债）
  'addShape',
  'updateShape',
  'removeShape',
  'moveShapeOrder',
  'addAnnotation',
  'updateAnnotation',
  'removeAnnotation',
  'setPalette',
] as const;

type TrackedName = (typeof TRACKED)[number];

/** 参数/变换/图元的连续编辑合并键；其余操作返回 null（每条独立成命令） */
function coalesceKey(name: TrackedName, args: unknown[]): string | null {
  if (name === 'updateParams') return `updateParams:${String(args[0])}`;
  if (name === 'setTransform') return `setTransform:${String(args[0])}`;
  if (name === 'updateShape') return `updateShape:${String(args[0])}`; // 拖拽/手柄/微调整段合并
  if (name === 'updateAnnotation') return `updateAnnotation:${String(args[0])}`;
  if (name === 'setPalette') return 'setPalette';
  return null;
}

export function attachHistory(store: SceneStore, opts?: HistoryOptions): History {
  const limit = opts?.limit ?? 100;
  const mergeWindowMs = opts?.mergeWindowMs ?? 800;
  const now = opts?.now ?? (() => Date.now());

  let undoStack: Command[] = [];
  let redoStack: Command[] = [];
  let recording = false; // undo/redo 回放期间暂停录制

  const push = (cmd: Command): void => {
    // 与栈顶同 key 且在窗口内 → 合并（保留最早的 before，采用最新 after）
    const top = undoStack[undoStack.length - 1];
    if (cmd.key !== null && top && top.key === cmd.key && now() - (top.after.timestamp ?? 0) <= mergeWindowMs) {
      top.after = cmd.after;
    } else {
      undoStack.push(cmd);
      if (undoStack.length > limit) undoStack.shift();
    }
    redoStack = []; // 新命令使重做分支失效
  };

  // 包装实例方法：快照 before → 原逻辑 → 快照 after → 入栈。
  // zustand 状态即对象，方法可整体替换；原方法闭包引用 get/set，与包装无关。
  for (const name of TRACKED) {
    const orig = store.getState()[name] as (...args: unknown[]) => unknown;
    const wrapped = (...args: unknown[]): unknown => {
      if (recording) return orig(...args);
      const before: Snapshot = takeSnapshot(store.getState());
      const result = orig(...args); // 失败操作（zod 抛错/目标不存在）状态未变，自然不入栈
      const after: Snapshot = takeSnapshot(store.getState());
      if (!sameSnapshot(before, after)) {
        push({
          label: name,
          key: coalesceKey(name, args),
          before,
          after: { ...after, timestamp: now() },
        });
      }
      return result;
    };
    store.setState({ [name]: wrapped } as unknown as Partial<SceneState>);
  }

  return {
    undo: () => {
      const cmd = undoStack[undoStack.length - 1];
      if (!cmd) return false;
      recording = true;
      try {
        applySnapshot(store, cmd.before);
      } finally {
        recording = false;
      }
      undoStack.pop();
      redoStack.push(cmd);
      return true;
    },
    redo: () => {
      const cmd = redoStack[redoStack.length - 1];
      if (!cmd) return false;
      recording = true;
      try {
        applySnapshot(store, cmd.after);
      } finally {
        recording = false;
      }
      redoStack.pop();
      undoStack.push(cmd);
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clearHistory: () => {
      undoStack = [];
      redoStack = [];
    },
    depths: () => ({ undo: undoStack.length, redo: redoStack.length }),
  };
}
