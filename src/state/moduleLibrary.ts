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
import { mineralOf } from '../core/minerals';
import type { SceneEntry } from './sceneStore';
import type { TemplateEntry } from './templateLibrary';

export const MODULES_FORMAT = 'kaolin-modules/v1' as const;
const MIGRATED_FLAG = 'kaolin_modules_migrated_v1';
const LEGACY_KEY = 'kaolin_modules_v1';
/** 旧 templateLibrary（kaolin-templates 库）→ 统一模板条目的一次性迁移标记 */
const TEMPLATE_MIGRATED_FLAG = 'kaolin_templates_migrated_v1';

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

/** 面板打开（内存缓存，首次走两段迁移 + DB 读取） */
export async function listModules(): Promise<ModuleEntry[]> {
  if (cache) return cache;
  await migrateFromLocalStorage();
  await migrateTemplatesToModules();
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
    // 2026-09-12：矿物组件自动带中文名/英文名/化学式标签 → 模块库搜索框中文可检索
    tags: mineralTagsOf(comp),
    createdAt: new Date().toISOString(),
    moduleVersion: 1,
  }) as ModuleEntry;
}

/** 矿物片层/管组件 → [中文名, 英文名, 化学式] 检索标签；非矿物组件无标签 */
function mineralTagsOf(comp: SceneEntry): string[] | undefined {
  if (comp.type !== 'kaolinite_sheet' && comp.type !== 'halloysite_tube') return undefined;
  const m = mineralOf((comp.params as { mineral?: string }).mineral);
  return [...m.zh, m.en, m.formula];
}

/**
 * 从整景（或选区）构造组合模块条目 —— T-3.1。
 * 各组件的 params/transform/visible 原样入库（实例化时逐个 addComponent，
 * 变换保持入库时的绝对值 → 组件间相对位置天然一致）。
 */
export function moduleEntryFromScene(
  components: SceneEntry[],
  thumb: string,
  name: string,
): ModuleEntry {
  return moduleSchema.parse({
    id: `m${Date.now()}`,
    name,
    type: 'combined',
    components: components.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      params: c.params,
      transform: c.transform,
      visible: c.visible,
      locked: c.locked ?? false,
    })),
    thumb,
    createdAt: new Date().toISOString(),
    moduleVersion: 1,
  }) as ModuleEntry;
}

/* ---------- 统一模板（2026-09-17：moduleLibrary 吸收 templateLibrary 快照能力） ---------- */

/** 完整可复现画面快照（保存入口采集；相机/2D 视图缺省 = 渲染服务不可用的兜底） */
export interface TemplateSnapshotInput {
  components: SceneEntry[];
  shapes: unknown[];
  annotations?: unknown[];
  mode?: 'mixed' | 'diagram';
  camera?: { position: [number, number, number]; target: [number, number, number] };
  view?: { zoom: number; panX: number; panY: number };
}

/**
 * 当前完整画面 → 统一模板条目（type:'template'）。一次性构造（先采集齐
 * 相机/图元/缩略图再落库，杜绝"先写 entry 再异步补快照"的半成品模板）。
 */
export function templateEntryFromScene(snap: TemplateSnapshotInput, thumb: string, name: string): ModuleEntry {
  return moduleSchema.parse({
    id: `tpl-${Date.now()}`,
    name,
    type: 'template',
    components: snap.components.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      params: c.params,
      transform: c.transform,
      visible: c.visible,
      locked: c.locked ?? false,
    })),
    shapes: structuredClone(snap.shapes),
    annotations: snap.annotations?.length ? structuredClone(snap.annotations) : undefined,
    mode: snap.mode,
    camera: snap.camera,
    view: snap.view,
    thumb,
    createdAt: new Date().toISOString(),
    moduleVersion: 1,
  }) as ModuleEntry;
}

/** 统一模板条目 → templateLibrary 载入视图（复用 applyTemplate：追加合并 + 快照恢复 + 禁 frameAll） */
export function moduleToTemplate(m: Extract<ModuleEntry, { type: 'template' }>): TemplateEntry {
  return {
    id: m.id,
    name: m.name,
    components: m.components as TemplateEntry['components'],
    shapes: (m.shapes ?? []) as SceneShapeLike[],
    annotations: m.annotations as TemplateEntry['annotations'],
    camera: m.camera,
    mode: m.mode,
    view: m.view,
  };
}
type SceneShapeLike = TemplateEntry['shapes'][number];

/** 占位缩略图（旧 templateLibrary 条目无 thumb / 渲染服务不可用兜底）：SVG dataURL——不建第二套缩略图管线 */
export function placeholderTemplateThumb(builtin = false): string {
  const icon = builtin ? '🧩' : '⭐';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='150' height='110'><rect width='150' height='110' fill='#EEF1F5'/><text x='75' y='66' font-size='40' text-anchor='middle'>${icon}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * 旧 templateLibrary（独立 Dexie 库 kaolin-templates）→ 统一模板条目惰性迁移。
 * 非破坏：旧表数据保留不删；稳定 id（tpl-* 原样，与 m* 不冲突）+ localStorage
 * 标记双保险幂等——重复执行不产生重复条目。旧库不可用（极端环境）静默跳过。
 */
export async function migrateTemplatesToModules(): Promise<number> {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(TEMPLATE_MIGRATED_FLAG)) return 0;
  let migrated = 0;
  try {
    const { listTemplates } = await import('./templateLibrary');
    const legacy = await listTemplates();
    const valid: ModuleEntry[] = [];
    for (const t of legacy) {
      const res = moduleSchema.safeParse({
        id: t.id,
        name: t.name,
        type: 'template',
        components: (t.components ?? []) as never,
        shapes: t.shapes as never,
        annotations: t.annotations,
        camera: t.camera,
        mode: t.mode,
        view: t.view,
        thumb: placeholderTemplateThumb(t.builtin ?? false),
        createdAt: t.createdAt,
        tags: ['模板'],
        moduleVersion: 1,
      });
      if (res.success) valid.push(res.data as ModuleEntry);
    }
    if (valid.length) await getDB().modules.bulkPut(valid);
    migrated = valid.length;
  } catch {
    /* 旧库打开失败——保持零迁移（下次启动重试） */
  }
  if (typeof localStorage !== 'undefined') localStorage.setItem(TEMPLATE_MIGRATED_FLAG, '1');
  if (migrated) {
    cache = null;
    notifyModulesChanged();
  }
  return migrated;
}

/**
 * 种子模板注入统一库（modules 表无 tpl-* 条目时；稳定 id 幂等）。
 * 在 UI 层（ModulePanel）调用——listModules 保持纯净供测试使用。
 */
export async function ensureSeededTemplates(seed: TemplateEntry[]): Promise<void> {
  try {
    const all = await getDB().modules.toArray();
    if (all.some((m) => m.id.startsWith('tpl-'))) return;
    const valid: ModuleEntry[] = [];
    for (const t of seed) {
      const res = moduleSchema.safeParse({
        id: t.id,
        name: t.name,
        type: 'template',
        components: (t.components ?? []) as never,
        shapes: t.shapes as never,
        annotations: t.annotations,
        camera: t.camera,
        mode: t.mode,
        view: t.view,
        thumb: placeholderTemplateThumb(t.builtin ?? false),
        createdAt: t.createdAt,
        tags: ['模板'],
        moduleVersion: 1,
      });
      if (res.success) valid.push(res.data as ModuleEntry);
    }
    if (valid.length) {
      await getDB().modules.bulkPut(valid);
      cache = null;
      notifyModulesChanged();
    }
  } catch {
    /* IndexedDB 不可用（极端环境）——模板功能静默降级 */
  }
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

/* ---------- 检索 / 分类 / 收藏排序（T-3.2） ---------- */

export type ModuleFilterType = 'all' | 'kaolinite_sheet' | 'halloysite_tube' | 'nanoparticle' | 'molecule' | 'rubber_substrate' | 'packed_layers' | 'combined' | 'template';

export interface ModuleFilter {
  /** 关键词：命中名称或标签（不区分大小写）；空串 = 不过滤 */
  query?: string;
  /** 类型筛选；'all' = 不过滤 */
  type?: ModuleFilterType;
}

/**
 * 纯函数检索/排序（内存中执行，200 条 <100ms 验收）：
 * 关键词过滤 → 类型过滤 → 收藏优先，同组内按创建时间倒序（旧条目无 createdAt 排最后组）。
 */
export function filterModules(modules: ModuleEntry[], filter: ModuleFilter): ModuleEntry[] {
  const query = (filter.query ?? '').trim().toLowerCase();
  const type = filter.type ?? 'all';
  const hit = modules.filter((m) => {
    if (type !== 'all' && m.type !== type) return false;
    if (!query) return true;
    const haystack = (m.name + ' ' + (m.tags ?? []).join(' ')).toLowerCase();
    return haystack.includes(query);
  });
  return hit.slice().sort((a, b) => {
    const fav = Number(b.favorite ?? false) - Number(a.favorite ?? false);
    if (fav !== 0) return fav;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });
}

/** 切换收藏标记（持久化 + 缓存刷新 + 通知面板） */
export async function toggleFavorite(id: string): Promise<boolean> {
  const entry = (await listModules()).find((m) => m.id === id);
  if (!entry) throw new Error(`模块不存在：${id}`);
  const favorite = !(entry.favorite ?? false);
  await getDB().modules.put({ ...entry, favorite });
  cache = null;
  notifyModulesChanged();
  return favorite;
}
