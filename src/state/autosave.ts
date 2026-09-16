/**
 * 自动保存 + 崩溃恢复（2026-09-13）：
 * 场景编辑后防抖 2s 快照到 IndexedDB（单条 key='current'，内容 = toSceneDocument
 * 含视角快照）；空场景不写。App 启动时若有上次快照 → 非阻塞提示条"恢复上次会话"，
 * 一键 loadScene（含相机/形态/2D 视图原样回来）。写失败静默（存储不可用降级）。
 */
import Dexie, { type Table } from 'dexie';
import type { SceneDocument } from '../core/types';
import { trace } from '../crashTrace';
import type { SceneState } from './sceneStore';

interface AutosaveRow {
  key: string;
  doc: SceneDocument;
  savedAt: number;
}

class AutosaveDB extends Dexie {
  autosave!: Table<AutosaveRow, string>;
  constructor() {
    super('kaolin-autosave');
    this.version(1).stores({ autosave: 'key' });
  }
}

let db: AutosaveDB | null = null;
const getDB = (): AutosaveDB => {
  if (!db) db = new AutosaveDB();
  return db;
};

const DEBOUNCE_MS = 2000;

/**
 * 安装自动保存订阅（App 挂载时调用；返回卸载函数）。
 * 触发面：components/shapes/annotations/palette 任一变化（mode/tool/选择不触发）。
 */
export function installAutosave(store: { getState: () => SceneState; subscribe: (fn: (s: SceneState, prev: SceneState) => void) => () => void }): () => void {
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  // 安装即补一次初始快照：启动预载（loadPresetScene）发生在订阅安装之前，
  // 其写入会被订阅错过——若用户预载后未再编辑就退出，上次会话将无快照可恢复
  void saveSnapshot(store);
  const unsub = store.subscribe((s, prev) => {
    if (
      s.components === prev.components &&
      s.shapes === prev.shapes &&
      s.annotations === prev.annotations &&
      s.palette === prev.palette
    ) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      void saveSnapshot(store);
    }, DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}

/** 空场景跳过；写失败静默降级 */
export async function saveSnapshot(store: { getState: () => SceneState }): Promise<void> {
  const s = store.getState();
  if (!s.components.length && !s.shapes.length && !s.annotations.length) return;
  try {
    const doc = s.toSceneDocument();
    await getDB().autosave.put({ key: 'current', doc, savedAt: Date.now() });
    trace(`autosave-saved comps=${doc.components.length}`);
  } catch (err) {
    trace(`autosave-error ${String(err).slice(0, 200)}`);
    /* IndexedDB 不可用——自动保存静默降级（trace 落盘便于诊断） */
  }
}

/** 读上次快照（无/读失败返回 null；传 since=只取早于该时间戳的，避免本会话覆盖后误报） */
export async function readAutosave(since?: number): Promise<AutosaveRow | null> {
  try {
    const row = await getDB().autosave.get('current');
    if (!row) return null;
    if (since !== undefined && row.savedAt >= since) return null;
    return row;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await getDB().autosave.delete('current');
  } catch {
    /* 静默 */
  }
}
