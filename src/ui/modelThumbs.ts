/**
 * 模型素材真实缩略图（UI 重构 2026-10-22，任务书四.4）
 *
 * 方案：复用 RendererService 做一次性「离屏缩略图工作室」——隐藏 132px 画布 +
 * 组件同款几何引擎（Worker + 内容寻址缓存），逐个 addComponent → 等几何落地 →
 * frameComponent 取景 → snapshotComponent 出图 → removeComponent。
 * 队列串行（一卡一渲染，无每卡常驻 3D 循环）；队列排空即 dispose 渲染器。
 * 结果持久化 localStorage（132×132 jpeg ≈ 每张数 KB），二次打开零成本。
 * 失败/不支持 WebGL 环境：卡片走明确降级图标（不静默遗漏素材）。
 */
import { DEFAULT_PARAMS, defaultTransformFor } from '../core/schema';
import type { ComponentType } from '../core/types';
import { RendererService, type RenderComponent } from '../render/RendererService';

export interface ThumbSpec {
  componentType: ComponentType;
  params: Record<string, unknown>;
}

const STORE_KEY = 'kaolin_model_thumbs_v1';
const THUMB_SIZE = 132;

/* ---------- 缓存层（localStorage + 内存 + 订阅） ---------- */

let cache: Record<string, string> = {};
let failed: Record<string, true> = {};
let version = 0;
const listeners = new Set<() => void>();

function loadCache(): void {
  try {
    cache = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, string>;
  } catch {
    cache = {};
  }
}
loadCache();

function emit(): void {
  version += 1;
  listeners.forEach((l) => l());
}

/** useSyncExternalStore 友好订阅 */
export function subscribeThumbs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getThumbVersion(): number {
  return version;
}

/** 取缩略图：缓存命中 / 未生成返回空串（卡片显示占位） / 失败返回 '!'（卡片显示降级图标） */
export function getCachedThumb(key: string): string {
  if (failed[key]) return '!';
  return cache[key] ?? '';
}

function putThumb(key: string, dataUrl: string): void {
  cache[key] = dataUrl;
  delete failed[key];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    /* 配额满：保留内存态 */
  }
  emit();
}

function putFailed(key: string): void {
  failed[key] = true;
  emit();
}

/** 测试辅助：清空缓存与失败标记 */
export function resetThumbs(): void {
  cache = {};
  failed = {};
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/* ---------- 离屏工作室（懒创建 / 串行队列 / 排空自毁） ---------- */

interface QueueItem {
  key: string;
  spec: ThumbSpec;
}

let studio: RendererService | null = null;
let studioHost: HTMLDivElement | null = null;
let queue: QueueItem[] = [];
let running = false;
let disposeTimer: ReturnType<typeof setTimeout> | null = null;

function createStudio(): RendererService {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;pointer-events:none;opacity:0;`;
  document.body.appendChild(host);
  studioHost = host;
  return new RendererService(host); // 组件同款引擎：Worker + IndexedDB 内容寻址缓存
}

function disposeStudio(): void {
  try {
    studio?.dispose();
  } catch {
    /* ignore */
  }
  studio = null;
  studioHost?.remove();
  studioHost = null;
}

/** 等组件几何落地（studio 与主画布共用 window 事件名，id 会撞车 → 轮询 getComponentGeometry） */
async function waitGeometry(svc: RendererService, id: string, isSubstrate: boolean): Promise<boolean> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (isSubstrate) {
      // 橡胶基底走主线程挤出几何（rec.data 恒 null）：给同步构建留一帧
      await new Promise((r) => setTimeout(r, 60));
      return true;
    }
    if (svc.getComponentGeometry(id)) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

let studioSeq = 0;

async function renderOne(item: QueueItem): Promise<void> {
  const svc = studio;
  if (!svc) return;
  // 与 sceneStore.addComponent 同款组装（默认参数合并 + schema 校验），
  // 再交渲染服务装载（其 addComponent 接收完整组件对象）
  const comp = {
    id: `thumb${++studioSeq}`,
    type: item.spec.componentType,
    name: 'thumb',
    params: { ...DEFAULT_PARAMS[item.spec.componentType], ...item.spec.params },
    transform: defaultTransformFor(item.spec.componentType),
    visible: true,
    locked: false,
  } as RenderComponent;
  const id = comp.id;
  svc.addComponent(comp);
  try {
    const ok = await waitGeometry(svc, id, item.spec.componentType === 'rubber_substrate');
    if (!ok) throw new Error('几何构建超时');
    svc.frameComponent(id);
    // 隐藏 gizmo 出干净图（snapshotComponent 内部已隐藏其他组件与 tc，双保险）
    const dataUrl = svc.snapshotComponent(id, THUMB_SIZE, THUMB_SIZE);
    if (!dataUrl || !dataUrl.startsWith('data:image')) throw new Error('快照为空');
    putThumb(item.key, dataUrl);
  } catch {
    putFailed(item.key);
  } finally {
    svc.removeComponent(id);
  }
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      if (!studio) studio = createStudio();
      const item = queue.shift()!;
      await renderOne(item);
    }
  } catch (err) {
    // 渲染器级失败（WebGL 不可用等）：余量全部标记降级，不再重试
    for (const rest of queue) putFailed(rest.key);
    queue = [];
    try {
      console.warn('模型缩略图工作室不可用：', err);
    } catch {
      /* ignore */
    }
  } finally {
    running = false;
    if (!queue.length) {
      // 排空后延迟自毁（期间的 enqueue 会取消 dispose，复用同一工作室）
      if (disposeTimer) clearTimeout(disposeTimer);
      disposeTimer = setTimeout(() => {
        if (!queue.length && !running) disposeStudio();
      }, 3000);
    }
  }
}

/** 批量入队（已缓存/已失败的 key 自动跳过）；fire-and-forget，不阻塞面板渲染 */
export function ensureThumbs(defs: Array<{ key: string; spec: ThumbSpec }>): void {
  const todo = defs.filter((d) => !cache[d.key] && !failed[d.key]);
  if (!todo.length) return;
  if (disposeTimer) {
    clearTimeout(disposeTimer);
    disposeTimer = null;
  }
  queue.push(...todo);
  void drain();
}
