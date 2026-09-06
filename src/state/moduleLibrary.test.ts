import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, moduleSchema } from '../core/schema';
import {
  bulkPutModules,
  clearModuleLibrary,
  deleteModule,
  exportModules,
  importModules,
  listModules,
  migrateFromLocalStorage,
  moduleEntryFromComponent,
  saveModule,
} from './moduleLibrary';
import type { SceneEntry } from './sceneStore';

/**
 * T-2.3 验收：200 模块入库 <2s；面板打开 <100ms（内存缓存）；
 * demo localStorage 数据迁移不丢失；导入导出往返无损。
 * 环境：fake-indexeddb + localStorage shim（Node 无 DOM）。
 */

// localStorage shim（置于全局，moduleLibrary 惰性访问）
const storeMap = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => storeMap.get(k) ?? null,
  setItem: (k: string, v: string) => void storeMap.set(k, v),
  removeItem: (k: string) => void storeMap.delete(k),
  clear: () => storeMap.clear(),
  key: (i: number) => [...storeMap.keys()][i] ?? null,
  get length() {
    return storeMap.size;
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageShim, configurable: true });

const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';

function fakeEntry(i: number) {
  return moduleSchema.parse({
    id: `m${1000 + i}`,
    name: `模块 ${i}`,
    type: 'nanoparticle',
    params: { ...DEFAULT_PARAMS.nanoparticle, seed: (i % 99) + 1 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    thumb: THUMB,
    createdAt: new Date().toISOString(),
    moduleVersion: 1,
  }) as SceneEntry & { thumb: string };
}

beforeEach(async () => {
  storeMap.clear();
  await clearModuleLibrary();
});

describe('CRUD 与缓存', () => {
  it('200 个模块（含缩略图）入库 <2s（T-2.3 验收）', async () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) await saveModule(fakeEntry(i));
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(2000);
    expect((await listModules()).length).toBe(200);
  });

  it('面板打开 <100ms（内存缓存命中；计 200 模块规模）', async () => {
    await bulkPutModules(Array.from({ length: 200 }, (_, i) => fakeEntry(i)));
    const first = performance.now();
    await listModules();
    expect(performance.now() - first).toBeLessThan(100);
    const cached = performance.now();
    await listModules();
    expect(performance.now() - cached).toBeLessThan(100);
  });

  it('覆盖同 id（模块再编辑语义）与删除', async () => {
    await saveModule(fakeEntry(1));
    await saveModule({ ...fakeEntry(1), name: '改名' });
    let all = await listModules();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('改名');
    await deleteModule('m1001');
    all = await listModules();
    expect(all).toHaveLength(0);
  });

  it('非法条目被 schema 拒绝（thumb 非 data:image）', async () => {
    await expect(
      saveModule({ ...fakeEntry(1), thumb: 'https://x/a.jpg' } as never),
    ).rejects.toThrow();
    expect(await listModules()).toHaveLength(0);
  });
});

describe('demo localStorage 迁移（不丢失，原 key 保留）', () => {
  it('legacy 条目迁移进 IndexedDB，重复调用幂等', async () => {
    const legacy = [fakeEntry(1), fakeEntry(2)];
    localStorage.setItem('kaolin_modules_v1', JSON.stringify(legacy));
    const n1 = await migrateFromLocalStorage();
    expect(n1).toBe(2);
    expect((await listModules()).length).toBe(2);
    // 迁移标记生效：重复调用不再写入
    const n2 = await migrateFromLocalStorage();
    expect(n2).toBe(0);
    // 原数据保留（不丢）
    expect(JSON.parse(localStorage.getItem('kaolin_modules_v1')!)).toHaveLength(2);
  });

  it('legacy 中混入非法条目：合法项迁入、非法跳过不中断', async () => {
    localStorage.setItem(
      'kaolin_modules_v1',
      JSON.stringify([fakeEntry(1), { bad: true }]),
    );
    expect(await migrateFromLocalStorage()).toBe(1);
  });
});

describe('导入/导出批量备份', () => {
  it('导出→清库→导入 往返无损', async () => {
    await saveModule(fakeEntry(1));
    await saveModule(fakeEntry(2));
    const text = await exportModules();
    await clearModuleLibrary();
    const { imported, skipped } = await importModules(text);
    expect(imported).toBe(2);
    expect(skipped).toBe(0);
    const all = await listModules();
    expect(all.map((m) => m.id).sort()).toEqual(['m1001', 'm1002']);
  });

  it('格式错误 / 非法条目处理', async () => {
    await expect(importModules('{"format":"other"}')).rejects.toThrow();
    const text = JSON.stringify({
      format: 'kaolin-modules/v1',
      exportedAt: '2026-09-06T00:00:00Z',
      modules: [fakeEntry(1), { nope: 1 }],
    });
    const { imported, skipped } = await importModules(text);
    expect(imported).toBe(1);
    expect(skipped).toBe(1);
  });
});

describe('moduleEntryFromComponent', () => {
  it('从场景组件构造合法条目（含默认字段）', () => {
    const storeEntry = {
      id: 'c1',
      name: '埃洛石管（双层壁）',
      type: 'halloysite_tube',
      params: { ...DEFAULT_PARAMS.halloysite_tube, walls: 2, d001: 10 },
      transform: { position: [0, 0, 0], rotation: [0, 0, 90], scale: 1 },
      visible: true,
      locked: false,
    } as unknown as SceneEntry;
    const entry = moduleEntryFromComponent(storeEntry, THUMB);
    expect(entry.name).toBe('埃洛石管（双层壁）');
    expect(entry.thumb).toBe(THUMB);
    expect(entry.moduleVersion).toBe(1);
    expect(typeof entry.createdAt).toBe('string');
  });
});
