/**
 * 几何网格缓存 —— T-2.9（存参数不存网格 D02 的缓存面：仍是"参数指纹 → 网格"映射，
 * 不违背 D02——网格只是确定性的缓存副本，参数永远可重建）。
 *
 * 结构：createCachedEngine(inner) 包装任意 GeometryEngine——
 *   build(req) 先查 IndexedDB（key = kind + 参数指纹 + CIF 指纹），命中直接返回
 *   （验收：命中 <50ms，对比实时生成 200ms+）；未命中走 inner 并异步回填。
 *   失效 = 内容寻址指纹（D02 确定性保证同参数同结果，无需主动失效）；LRU 上限防膨胀。
 * prebake(requests)：后台预烘焙常用参数组合（TODO 原文 innerR 步进 × walls）。
 */
import Dexie, { type Table } from 'dexie';
import type { GeometryEngine, GeometryRequest, GeometryResult } from './worker';

/* ---------- 指纹：规范化 JSON（键排序递归）+ djb2 ---------- */

function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/** 内容指纹：djb2 hex + 规范化串长度（降低碰撞影响） */
export function fingerprint(v: unknown): string {
  const s = canonical(v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${s.length}`;
}

export function cacheKey(req: GeometryRequest): string {
  return `geo:${req.kind}:${fingerprint(req.params)}:${fingerprint(req.cifText)}`;
}

/* ---------- IndexedDB（独立库，避免动模块库的 schema 版本） ---------- */

interface GeoCacheRow {
  key: string;
  kind: string;
  atoms: GeometryResult['atoms'];
  bonds: GeometryResult['bonds'];
  createdAt: number;
}

class CacheDB extends Dexie {
  geometry!: Table<GeoCacheRow, string>;
  constructor() {
    super('kaolin-cache');
    this.version(1).stores({ geometry: 'key, kind, createdAt' });
  }
}

let dbInstance: CacheDB | null = null;
function getDB(): CacheDB {
  if (!dbInstance) dbInstance = new CacheDB();
  return dbInstance;
}

/** 测试/开发辅助：清空几何缓存 */
export async function clearGeometryCache(): Promise<void> {
  await getDB().geometry.clear();
}

/* ---------- 缓存引擎 ---------- */

export interface CachedEngineOptions {
  /** 缓存条目上限（LRU 淘汰最旧），默认 40（大分子约 1MB/条） */
  limit?: number;
  /** 超过该原子数的构建结果不入库（防止极端场景撑爆配额），默认 60000 */
  maxCacheAtoms?: number;
}

export function createCachedEngine(
  inner: GeometryEngine,
  opts?: CachedEngineOptions,
): GeometryEngine {
  const limit = opts?.limit ?? 40;
  const maxCacheAtoms = opts?.maxCacheAtoms ?? 60000;
  let tick = 0;
  const now = (): number => Date.now() + tick++ * 1e-3; // 单调，避免同毫秒 LRU 并列

  return {
    async build(req: GeometryRequest): Promise<GeometryResult> {
      const key = cacheKey(req);
      const hit = await getDB().geometry.get(key);
      if (hit) {
        // touch（LRU 新鲜度）不阻塞返回（15k 原子命中 <50ms 验收）
        void getDB()
          .geometry.update(key, { createdAt: now() })
          .catch(() => undefined);
        return { atoms: hit.atoms, bonds: hit.bonds };
      }
      const result = await inner.build(req);
      if (result.atoms.length <= maxCacheAtoms) {
        const row: GeoCacheRow = {
          key,
          kind: req.kind,
          atoms: result.atoms,
          bonds: result.bonds,
          createdAt: now(),
        };
        await getDB().geometry.put(row);
        // LRU：超限淘汰最旧
        const count = await getDB().geometry.count();
        if (count > limit) {
          const oldest = await getDB().geometry.orderBy('createdAt').limit(count - limit).primaryKeys();
          await getDB().geometry.bulkDelete(oldest);
        }
      }
      return result;
    },
    dispose: () => inner.dispose(),
  };
}

/* ---------- 预烘焙 ---------- */

/**
 * 后台预烘焙：按序构建请求列表并写入缓存（配合 Worker 引擎即为后台线程预生成）。
 * 返回成功入库的条数。失败的单项跳过不中断。
 */
export async function prebake(
  engine: GeometryEngine,
  requests: GeometryRequest[],
): Promise<number> {
  let done = 0;
  for (const req of requests) {
    try {
      await engine.build(req);
      done++;
    } catch {
      // 单项失败跳过（如缺 CIF）
    }
  }
  return done;
}

/** 常用埃洛石管参数组合（TODO 原文：innerR 10–30Å 步进 × walls 1–2；d001 取 10Å 水合间距） */
export function defaultTubePrebakeRequests(cifText: string): GeometryRequest[] {
  const requests: GeometryRequest[] = [];
  for (const innerR of [10, 15, 20, 25, 30]) {
    for (const walls of [1, 2]) {
      requests.push({
        kind: 'halloysite_tube',
        cifText,
        params: { innerR, length: 100, walls, d001: 10, progress: 1, taperDeg: 0, style: '空间填充' },
      });
    }
  }
  return requests;
}
