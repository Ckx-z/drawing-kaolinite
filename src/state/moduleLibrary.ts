/**
 * 模块库持久层 —— T-2.3（IndexedDB / Dexie）
 *
 * 设计：
 *  - 模块条目 = ModuleEntry（moduleSchema 校验，单一事实源），含缩略图 dataURL；
 *  - 内存缓存：面板打开走缓存（验收：<100ms），写操作同步刷新缓存；
 *  - 迁移：demo 时代 localStorage（kaolin_modules_v1）→ IndexedDB，原 key 保留不删
 *    （验收：迁移不丢失），打标记防重复迁移；
 *  - 批量备份：.kaolin-modules.json 导入/导出（课题组网盘分发的载体）；
 *  - 变更通知：window 'kaolin-modules-changed' 事件，UI 面板监听刷新。
 */
import Dexie, { type Table } from 'dexie';
import { moduleSchema } from '../core/schema';
import type { ModuleEntry } from '../core/types';
import type { SceneEntry } from './sceneStore';

export const MODULES_FORMAT = 'kaolin-modules/v1' as const;
const MIGRATED_FLAG = 'kaolin_modules_migrated_v1';
const LEGACY_KEY = 'kaolin_modules_v1';

/** 派发变更事件（ModulePanel 监听刷新） */
export function notifyModulesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kaolin-modules-changed'));
  }
}

class KaolinDB extends Dexie {
  modules!: Table<ModuleEntry, string>;
  constructor() {
    super('kaolin-assets');
    this.version(1).stores({ modules: 'id, name, type, createdAt' });
  }
}

let dbInstance: KaolinDB | null = null;
function getDB(): KaolinDB {
  if (!dbInstance) dbInstance = new KaolinDB();
  return dbInstance;
}

let cache: ModuleEntry[] | null = null;

/** 面板打开（内存缓存，首次走迁移 + DB 读取） */
export async function listModules(): Promise<ModuleEntry[]> {
  if (cache) return cache;
  await migrateFromLocalStorage();
  cache = await getDB().modules.toArray();
  return cache;
}

/** 保存/覆盖单个模块（schema 校验非法抛错），返回 id */
export async function saveModule(entry: ModuleEntry): Promise<string> {
  const valid = moduleSchema.parse(entry) as ModuleEntry;
  await getDB().modules.put(valid);
  cache = null;
  notifyModulesChanged();
  return valid.id;
}

/** 从场景组件构造模块条目（缩略图由渲染层 snapshotComponent 生成） */
export function moduleEntryFromComponent(
  comp: SceneEntry,
  thumb: string,
  nameSuffix = '',
): ModuleEntry {
  return moduleSchema.parse({
    id: `m${Date.now()}`,
    name: comp.name + nameSuffix,
    type: comp.type,
    params: comp.params,
    transform: comp.transform,
    thumb,
    createdAt: new Date().toISOString(),
    moduleVersion: 1,
  }) as ModuleEntry;
}

export async function deleteModule(id: string): Promise<void> {
  await getDB().modules.delete(id);
  cache = null;
  notifyModulesChanged();
}

/** 导出 .kaolin-modules.json 批量备份文本 */
export async function exportModules(): Promise<string> {
  const modules = await listModules();
  return JSON.stringify(
    { format: MODULES_FORMAT, exportedAt: new Date().toISOString(), modules },
    null,
    2,
  );
}

/**
 * 从备份文本批量导入（schema 校验，非法条目跳过并计数）。
 * 同 id 覆盖（模块再编辑后重新导入的语义）。返回 { imported, skipped }。
 */
export async function importModules(
  text: string,
): Promise<{ imported: number; skipped: number }> {
  const raw = JSON.parse(text) as { format?: string; modules?: unknown[] };
  if (raw.format !== MODULES_FORMAT || !Array.isArray(raw.modules)) {
    throw new Error('不是有效的模块备份文件（缺少 kaolin-modules/v1 格式标记）');
  }
  const valid: ModuleEntry[] = [];
  let skipped = 0;
  for (const m of raw.modules) {
    const res = moduleSchema.safeParse(m);
    if (res.success) valid.push(res.data as ModuleEntry);
    else skipped++;
  }
  if (valid.length) await bulkPutModules(valid);
  cache = null;
  notifyModulesChanged();
  return { imported: valid.length, skipped };
}

/** 批量写入（导入路径复用；校验由调用方负责） */
export async function bulkPutModules(entries: ModuleEntry[]): Promise<void> {
  if (!entries.length) return;
  await getDB().modules.bulkPut(entries);
  cache = null;
}

/**
 * demo 时代 localStorage（kaolin_modules_v1）→ IndexedDB。
 * 逐条 schema 校验（非法跳过不中断）；原 key 保留不删，打 migrated 标记防重复。
 */
export async function migrateFromLocalStorage(): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  if (localStorage.getItem(MIGRATED_FLAG)) return 0;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATED_FLAG, '1');
    return 0;
  }
  let legacy: unknown[];
  try {
    legacy = JSON.parse(raw) as unknown[];
  } catch {
    localStorage.setItem(MIGRATED_FLAG, '1');
    return 0;
  }
  const valid: ModuleEntry[] = [];
  for (const m of legacy) {
    const res = moduleSchema.safeParse(m);
    if (res.success) valid.push(res.data as ModuleEntry);
  }
  if (valid.length) await getDB().modules.bulkPut(valid);
  localStorage.setItem(MIGRATED_FLAG, '1'); // 原 LEGACY_KEY 数据保留不动
  cache = null;
  return valid.length;
}

/** 测试/开发辅助：清空模块库与缓存 */
export async function clearModuleLibrary(): Promise<void> {
  await getDB().modules.clear();
  cache = null;
  notifyModulesChanged();
}
