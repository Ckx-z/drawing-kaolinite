import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAutosave, installAutosave, readAutosave, saveSnapshot } from './autosave';
import { createSceneStore } from './sceneStore';

/** 自动保存 + 崩溃恢复（2026-09-13）：防抖快照 / 空场景跳过 / 启动读取（since 过滤） */
describe('自动保存', () => {
  beforeEach(async () => {
    await clearAutosave();
  });

  it('编辑后防抖落盘（真实 2s 防抖等待；fake-timers 会卡 fake-indexeddb 内部定时器）', async () => {
    const store = createSceneStore();
    const uninstall = installAutosave(store);
    store.getState().addShape({ type: 'rect', x: 1, y: 2, w: 30, h: 20 });
    await new Promise((r) => setTimeout(r, 2600));
    const row = await readAutosave();
    expect(row).not.toBeNull();
    expect(row!.doc.shapes).toHaveLength(1);
    uninstall();
  }, 8000);

  it('空场景不写快照（清空后自动保存不应残留空档）', async () => {
    const store = createSceneStore();
    await saveSnapshot(store);
    expect(await readAutosave()).toBeNull();
  });

  it('since 过滤：早于启动时刻 = 上次会话（提示）；晚于 = 本会话已覆盖（不提示）', async () => {
    const store = createSceneStore();
    store.getState().addShape({ type: 'text', x: 5, y: 5, w: 60, h: 20, text: 'hi' });
    await saveSnapshot(store);
    // 刚写的快照晚于任何过去时刻的 since → 本会话，不提示
    expect(await readAutosave(Date.now() - 60_000)).toBeNull();
    // 注入"上次会话"时间戳（早于启动时刻）→ 要提示
    const { readAutosave: _r } = await import('./autosave');
    const dbRow = { key: 'current', doc: store.getState().toSceneDocument(), savedAt: Date.now() - 120_000 };
    const db = new (await import('dexie')).default('kaolin-autosave');
    db.version(1).stores({ autosave: 'key' });
    await db.table('autosave').put(dbRow);
    await db.close();
    expect(await _r(Date.now() - 60_000)).not.toBeNull();
  });
});
