import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, moduleSchema } from '../core/schema';
import {
  bulkPutModules,
  clearModuleLibrary,
  deleteModule,
  exportModules,
  filterModules,
  importModules,
  listModules,
  migrateFromLocalStorage,
  moduleEntryFromComponent,
  saveModule,
  toggleFavorite,
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

/* ============================================================
 * T-3.2 检索 / 分类 / 收藏排序
 * ============================================================ */

describe('T-3.2 filterModules：关键词 / 类型 / 收藏排序', () => {
  it('200 模块按关键词检索 < 100ms（验收标准）', async () => {
    for (let i = 0; i < 200; i++) await saveModule(fakeEntry(i));
    const all = await listModules();
    const t0 = performance.now();
    const hits = filterModules(all, { query: '块 19' });
    const ms = performance.now() - t0;
    expect(hits.length).toBeGreaterThan(0);      // 「模块 19x」系列
    expect(hits.every((m) => m.name.includes('块 19'))).toBe(true);
    expect(ms).toBeLessThan(100);
  });

  it('类型筛选：combined 与五类互不混入', () => {
    const a = fakeEntry(1);
    const combined = moduleSchema.parse({
      id: 'm-combined',
      name: '组合',
      type: 'combined',
      components: [{ type: 'molecule', name: 'x', params: { kind: 'H₂O' }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 4 } }],
      thumb: THUMB,
    }) as SceneEntry & { thumb: string };
    const all = [a, combined] as never[];
    expect(filterModules(all, { type: 'combined' }).map((m) => m.id)).toEqual(['m-combined']);
    expect(filterModules(all, { type: 'nanoparticle' }).map((m) => m.id)).toEqual(['m1001']);
    expect(filterModules(all, { type: 'all' })).toHaveLength(2);
  });

  it('收藏优先排序；同组内按 createdAt 倒序；旧条目（无版本/收藏/时间字段）兼容参与', () => {
    const old = moduleSchema.parse({
      id: 'm-old',
      name: '旧版模块',
      type: 'molecule',
      params: { kind: 'H₂O' },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 4 },
      thumb: THUMB,
      // 无 createdAt / moduleVersion / favorite / tags —— 模拟旧版本条目
    }) as SceneEntry & { thumb: string };
    const newer = fakeEntry(2);
    const older = { ...fakeEntry(3), createdAt: '2026-09-01T00:00:00.000Z' };
    const fav = { ...fakeEntry(4), createdAt: '2026-09-01T00:00:00.000Z', favorite: true };

    const sorted = filterModules([older, old, fav, newer], {});
    expect(sorted.map((m) => m.id)).toEqual(['m1004', 'm1002', 'm1003', 'm-old']); // 收藏 → 新 → 旧 → 无时间
    // 旧条目照常被检索命中
    expect(filterModules([old], { query: '旧版' })).toHaveLength(1);
  });

  it('toggleFavorite 持久化并在列表刷新后生效', async () => {
    const e = fakeEntry(7);
    await saveModule(e);
    expect(await toggleFavorite(e.id)).toBe(true);
    let listed = await listModules();
    expect(listed.find((m) => m.id === e.id)?.favorite).toBe(true);
    expect(await toggleFavorite(e.id)).toBe(false);
    listed = await listModules();
    expect(listed.find((m) => m.id === e.id)?.favorite).toBe(false);
  });

  it('收藏与标签随导入导出往返保留；标签参与检索', async () => {
    const e = { ...fakeEntry(9), tags: ['埃洛石', '复合'], favorite: true };
    await saveModule(e);
    const text = await exportModules();
    await clearModuleLibrary();
    await importModules(text);
    const listed = await listModules();
    expect(listed.find((m) => m.id === e.id)?.tags).toEqual(['埃洛石', '复合']);
    expect(listed.find((m) => m.id === e.id)?.favorite).toBe(true);
    expect(filterModules(listed, { query: '埃洛石' })).toHaveLength(1);
  });
});
