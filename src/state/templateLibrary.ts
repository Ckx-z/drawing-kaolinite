/**
 * 机理图模板库 —— T-11.8（吸收 T-9.8 界面反应版式）
 *
 * 模板 = 场景子集（components? + shapes + annotations?），不含 id 语义：
 * 载入时组件经 addComponent 重新生成 id（component 锚定的箭头端点自动重映射），
 * 图元经 addShape 重新生成 id（模板内 group 关系按新 id 重建）。
 * 存储：Dexie（kaolin-templates 库，IndexedDB）；首次启动注入种子模板
 * （data/seed-templates.json，随安装包分发）。
 */
import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { componentSchema } from '../core/schema';
import type { SceneShape } from '../core/shapes/schema';
import type { Annotation } from '../core/types';
import { runInBatch } from './history';
import type { SceneState } from './sceneStore';

/* ---------- 数据模型 ---------- */

export const templateSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  desc: z.string().optional(),
  builtin: z.boolean().optional(),
  components: z.array(componentSchema).optional(),
  // 透传（z.object({}) 是 strip 模式会把字段剥空；shapes/annotations 的正确性由源头保证）
  shapes: z.array(z.unknown()),
  annotations: z.array(z.unknown()).optional(),
  createdAt: z.string().optional(),
});

/** 模板条目（annotations 手写类型避免 z.infer 交叉冲突） */
export interface TemplateEntry {
  id: string;
  name: string;
  desc?: string;
  builtin?: boolean;
  components?: Array<Parameters<SceneState['addComponent']>[1] extends never ? never : z.infer<typeof componentSchema>>;
  shapes: SceneShape[];
  annotations?: Annotation[];
  createdAt?: string;
}

class TemplateDB extends Dexie {
  templates!: Table<TemplateEntry, string>;
  constructor() {
    super('kaolin-templates');
    this.version(1).stores({ templates: 'id, name' });
  }
}

let db: TemplateDB | null = null;
const getDB = (): TemplateDB => {
  if (!db) db = new TemplateDB();
  return db;
};

/* ---------- 库操作 ---------- */

export async function saveTemplate(entry: TemplateEntry): Promise<void> {
  await getDB().templates.put(templateSchema.parse(entry) as unknown as TemplateEntry);
}

export async function listTemplates(): Promise<TemplateEntry[]> {
  return getDB().templates.orderBy('name').toArray();
}

export async function deleteTemplate(id: string): Promise<void> {
  await getDB().templates.delete(id);
}

/** 首次启动注入种子模板（库空时；失败静默——存储不可用时功能降级为不可用） */
export async function ensureSeeded(seed: TemplateEntry[]): Promise<void> {
  try {
    const n = await getDB().templates.count();
    if (n > 0) return;
    for (const t of seed) await saveTemplate(t);
  } catch {
    /* IndexedDB 不可用（极端环境）——模板功能静默降级 */
  }
}

/* ---------- 载入（合并到当前场景：追加组件与图元） ---------- */

/**
 * 应用模板：组件重新生成 id（返回新旧映射，箭头 component 锚定重映射）；
 * 图元重新生成 id；模板内 group 关系按新 id 重建。
 * 追加式合并（不清空现有内容），整个载入经 runInBatch 合并为一条 Ctrl+Z 可撤销命令。
 */
export function applyTemplate(store: { getState: () => SceneState }, tpl: TemplateEntry): void {
  runInBatch(store, () => {
    const idMap = new Map<string, string>();
    for (const c of tpl.components ?? []) {
      const newId = store.getState().addComponent(c.type, {
        name: c.name,
        params: c.params as never,
        transform: c.transform,
        visible: c.visible,
      });
      if (c.id) idMap.set(c.id, newId);
    }

    // 两遍：先全部入库拿新 id，再统一改锚定与编组（组内成员才能正确重建）。
    // group/anchors 用 delete 剔除（rect/text 的 strictObject 拒绝未声明键）
    const oldToNew = new Map<string, string>();
    for (const s of tpl.shapes) {
      const rest = { ...s } as Record<string, unknown>;
      delete rest.group;
      if (s.type === 'arrow' || s.type === 'line') delete rest.anchors;
      const newId = store.getState().addShape(rest as never);
      oldToNew.set(s.id, newId);
    }
    for (const s of tpl.shapes) {
      const newId = oldToNew.get(s.id)!;
      const patch: Record<string, unknown> = {};
      if ((s.type === 'arrow' || s.type === 'line') && s.anchors) {
        const remap = (a: { kind: string; id?: string }) =>
          a.kind === 'component' && a.id && idMap.has(a.id)
            ? { kind: 'component', id: idMap.get(a.id)! }
            : a.kind === 'shape' && a.id && oldToNew.has(a.id)
              ? { kind: 'shape', id: oldToNew.get(a.id)! }
              : { kind: 'free' };
        patch.anchors = { start: remap(s.anchors.start), end: remap(s.anchors.end) };
      }
      if (Object.keys(patch).length) store.getState().updateShape(newId, patch as Partial<SceneShape>);
    }
    // 模板内编组重建
    const groups = new Map<string, string[]>();
    for (const s of tpl.shapes) {
      if (!s.group) continue;
      const ids = groups.get(s.group) ?? [];
      const nid = oldToNew.get(s.id);
      if (nid) ids.push(nid);
      groups.set(s.group, ids);
    }
    for (const ids of groups.values()) {
      if (ids.length > 1) store.getState().groupShapes(ids);
    }
  });
}
