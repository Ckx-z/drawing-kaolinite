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
import { moduleSchema, SCENE_FORMAT } from '../core/schema';
import type { ModuleEntry } from '../core/types';
import { mineralOf } from '../core/minerals';
import type { SceneShape } from '../core/shapes/schema';
import { shapesToSVG, viewTransformedShape } from '../export/svg';
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

/**
 * 统一打开归一化（2026-09-17 模板=独立场景）：四类条目 → SceneDocument 形状，
 * 交给 sceneStore.loadScene 一次性替换当前场景（OPEN/REPLACE，非追加）。
 * 归一化输出"完整替换语义"：模板没有的 scene-owned 内容显式为空（shapes=[]
 * 而非 undefined），杜绝旧场景残留。saved 由 deserializeScene 前的 schema 要求提供。
 */
export function moduleToSceneDocument(m: ModuleEntry): {
  format: typeof SCENE_FORMAT;
  saved: string;
  components: unknown[];
  shapes?: unknown[];
  annotations?: unknown[];
  mode?: 'mixed' | 'diagram';
  camera?: { position: [number, number, number]; target: [number, number, number] };
  view?: { zoom: number; panX: number; panY: number };
} {
  const base = { format: SCENE_FORMAT, saved: new Date().toISOString() };
  if (m.type === 'template') {
    // 新 Full Template / 旧模板迁移条目：完整快照原样（不重排、不重取景）
    return {
      ...base,
      components: m.components,
      shapes: (m.shapes ?? []).length ? (m.shapes as unknown[]) : [],
      ...(m.annotations?.length ? { annotations: m.annotations as unknown[] } : {}),
      ...(m.mode ? { mode: m.mode } : {}),
      ...(m.camera ? { camera: m.camera } : {}),
      ...(m.view ? { view: m.view } : {}),
    };
  }
  if (m.type === 'combined') {
    // 旧组合模块：components 完整替换；无图元/视角（loadScene 回空 + frameAll fallback）
    return { ...base, components: m.components, shapes: [] };
  }
  // 旧单组件模块 → 单组件独立场景
  return {
    ...base,
    components: [{ id: m.id, name: m.name, type: m.type, params: m.params, transform: m.transform, visible: true }],
    shapes: [],
  };
}

/**
 * 占位缩略图（仅 fallback：渲染服务不可用 / 含 3D 组件的旧模板无法离屏渲染 /
 * 图片解析失败）。SVG 内嵌 data-ph 标记供 isPlaceholderThumb 识别——
 * 正常新保存模板永不走此路径（任务书 2026-09-17b：卡片必须是真实场景预览）。
 */
export function placeholderTemplateThumb(builtin = false): string {
  const icon = builtin ? '🧩' : '⭐';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='150' height='110' data-ph='1'><rect width='150' height='110' fill='#EEF1F5'/><text x='75' y='66' font-size='40' text-anchor='middle'>${icon}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 是否占位缩略图（data-ph 标记；encodeURIComponent 后 data-ph%3D%221%22） */
export function isPlaceholderThumb(thumb: string): boolean {
  return thumb.includes('data-ph');
}

/**
 * 纯 2D 模板真实缩略图（无 3D 组件：种子版式 / 纯图元模板）：
 * 图元包围盒自适应缩放到卡片尺寸（150×110，与组合模块卡片同规格）→
 * shapesToSVG 矢量序列化（复用导出管线，非第二套截图系统）→ SVG dataURL。
 * 确定性：同 shapes 输入恒得同输出（viewTransformedShape 做缩放平移）。
 */
export function shapeSceneThumb(shapes: SceneShape[], width = 150, height = 110): string {
  if (!shapes.length) return placeholderTemplateThumb();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of shapes) {
    x0 = Math.min(x0, Math.min(s.x, s.x + s.w));
    y0 = Math.min(y0, Math.min(s.y, s.y + s.h));
    x1 = Math.max(x1, Math.max(s.x, s.x + s.w));
    y1 = Math.max(y1, Math.max(s.y, s.y + s.h));
  }
  const pad = 8;
  const availW = width - pad * 2;
  const availH = height - pad * 2;
  const bw = Math.max(x1 - x0, 1);
  const bh = Math.max(y1 - y0, 1);
  const z = Math.min(availW / bw, availH / bh);
  const px = pad + (availW - bw * z) / 2 - x0 * z;
  const py = pad + (availH - bh * z) / 2 - y0 * z;
  // 种子/历史 JSON 的箭头连线可能缺 anchors（store 内由 schema 默认值补齐，
  // 裸数据没有）——补 free 端点按几何 (x,y)→(x+w,y+h) 解析，与 store 语义一致
  const normalized = shapes.map((s) =>
    (s.type === 'arrow' || s.type === 'line') && !s.anchors
      ? ({ ...s, anchors: { start: { kind: 'free' }, end: { kind: 'free' } } } as SceneShape)
      : s,
  );
  const fitted = normalized.map((s) => viewTransformedShape(s, z, px, py));
  // project 仅 component 锚定用到；纯 2D 无组件（components: []）恒走 free 几何端点
  const body = shapesToSVG({
    width,
    height,
    scale: 1,
    shapes: fitted,
    components: [],
    project: () => ({ x: 0, y: 0, visible: false }),
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#F4F5F7"/>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 模板条目的真实缩略图：纯 2D → 矢量渲染；含 3D 组件 → 占位（无法离屏渲染 3D，仅此场景 fallback） */
function templateThumbFor(t: { components?: unknown[]; shapes: SceneShape[]; builtin?: boolean }): string {
  return t.components?.length ? placeholderTemplateThumb(t.builtin ?? false) : shapeSceneThumb(t.shapes);
}

/**
 * 历史模板缩略图回填（任务书第九节）：统一库中"占位缩略图的纯 2D 模板"
 * 重新生成真实矢量缩略图并写回（只换 thumb，其余字段逐位保留）。
 * 含 3D 组件的模板跳过（离屏 3D 渲染成本高，不阻塞——保留 fallback）。
 * 幂等：非占位缩略图即跳过，重复执行无副作用。
 */
export async function generateMissingThumbnails(): Promise<number> {
  const all = await listModules();
  let n = 0;
  for (const m of all) {
    if (m.type !== 'template') continue;
    if (m.components.length) continue; // 含 3D 组件：无法离屏渲染
    if (!m.shapes?.length) continue;
    if (!isPlaceholderThumb(m.thumb)) continue;
    const thumb = shapeSceneThumb(m.shapes as SceneShape[]);
    await getDB().modules.put({ ...m, thumb });
    n++;
  }
  if (n) {
    cache = null;
    notifyModulesChanged();
  }
  return n;
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
        thumb: templateThumbFor(t as { components?: unknown[]; shapes: SceneShape[]; builtin?: boolean }),
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
        thumb: templateThumbFor(t as { components?: unknown[]; shapes: SceneShape[]; builtin?: boolean }),
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
