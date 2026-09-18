import 'fake-indexeddb/auto';
/**
 * 统一模板库验收 —— 2026-09-17（moduleLibrary 吸收 templateLibrary 快照能力）
 *
 * 覆盖任务书 Test 3-14：完整画面快照保存（组件+图元+视角+缩略图）→ 清空 →
 * 逐位恢复（组件/图元/相机/2D 视图/形态）；旧单组件/组合模块 fixture 加载；
 * 旧 templateLibrary 条目迁移与加载；favorite/thumb 保持；导入导出 roundtrip；
 * 迁移幂等。环境：fake-indexeddb + localStorage shim（同 moduleLibrary.test）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { moduleSchema } from '../core/schema';
import type { ModuleEntry } from '../core/types';
import { createSceneStore } from './sceneStore';
import { applyTemplate, saveTemplate, type TemplateEntry } from './templateLibrary';
import {
  clearModuleLibrary,
  exportModules,
  importModules,
  listModules,
  migrateTemplatesToModules,
  moduleToTemplate,
  saveModule,
  templateEntryFromScene,
  MODULES_FORMAT,
} from './moduleLibrary';

// localStorage shim（Node 无 DOM；moduleLibrary 惰性访问）
const storeMap = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => storeMap.get(k) ?? null,
  setItem: (k: string, v: string) => void storeMap.set(k, v),
  removeItem: (k: string) => void storeMap.delete(k),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageShim, configurable: true });

const SEED_MODULES = JSON.parse(
  readFileSync(new URL('../../data/seed-modules.json', import.meta.url), 'utf8'),
) as { modules: ModuleEntry[] };
const SEED_TEMPLATES = JSON.parse(
  readFileSync(new URL('../../data/seed-templates.json', import.meta.url), 'utf8'),
) as TemplateEntry[];

const THUMB = 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E';

/** 构造含 2 组件 + 2 图元的场景（Test 3 前置） */
function buildRichScene() {
  const store = createSceneStore();
  store.getState().addComponent('nanoparticle', {
    name: '颗粒A',
    transform: { position: [-10, 4, 0], rotation: [0, 30, 0], scale: 1.5 },
  });
  store.getState().addComponent('molecule', {
    name: '水B',
    params: { kind: 'H₂O' },
    transform: { position: [8, -6, 2], rotation: [0, 0, 0], scale: 4 },
  });
  store.getState().addShape({ type: 'rect', x: 10, y: 10, w: 30, h: 20 } as never);
  store.getState().addShape({ type: 'text', x: 0, y: 60, w: 50, h: 24, text: '机理标注' } as never);
  return store;
}

describe('统一模板：保存完整画面（Test 3）', () => {
  it('2 组件 + 2 图元 + 相机 → entry 含 components=2 / shapes=2 / view / thumb', () => {
    const store = buildRichScene();
    const s = store.getState();
    const entry = templateEntryFromScene(
      {
        components: s.components,
        shapes: s.shapes,
        annotations: s.annotations,
        mode: 'diagram',
        camera: { position: [12, -34, 56], target: [1, 2, 3] },
        view: { zoom: 1.75, panX: 40, panY: -20 },
      },
      THUMB,
      'T-快照',
    );
    expect(entry.type).toBe('template');
    if (entry.type !== 'template') return;
    expect(entry.components).toHaveLength(2);
    expect(entry.shapes).toHaveLength(2);
    expect(entry.camera).toEqual({ position: [12, -34, 56], target: [1, 2, 3] });
    expect(entry.view).toEqual({ zoom: 1.75, panX: 40, panY: -20 });
    expect(entry.mode).toBe('diagram');
    expect(entry.thumb).toMatch(/^data:image\//);
    expect(moduleSchema.safeParse(entry).success).toBe(true);
  });
});

describe('统一模板：清空后逐位恢复（Test 4/5/6）', () => {
  it('组件/图元/相机/2D 视图/形态全部一致（复用 applyTemplate，禁 frameAll）', async () => {
    const src = buildRichScene();
    const s0 = src.getState();
    const entry = templateEntryFromScene(
      {
        components: s0.components,
        shapes: s0.shapes,
        annotations: s0.annotations,
        mode: 'diagram',
        camera: { position: [12, -34, 56], target: [1, 2, 3] },
        view: { zoom: 1.75, panX: 40, panY: -20 },
      },
      THUMB,
      'T-恢复',
    );
    if (entry.type !== 'template') throw new Error('unreachable');

    // 清空后载入（ModulePanel instantiate 的 template 分支路径）
    const dst = createSceneStore();
    const { rendererRef } = await import('./rendererRef');
    const { shapeViewStore } = await import('../ui/shapes/view');
    const posArgs: number[][] = [];
    const tgtArgs: number[][] = [];
    const camCalls: string[] = [];
    const camPos = { set: (...a: number[]) => { posArgs.push(a); } };
    const tgt = { set: (...a: number[]) => { tgtArgs.push(a); } };
    const prev = rendererRef.current;
    const origSetView = shapeViewStore.getState().setView;
    let viewSnap: { zoom: number; panX: number; panY: number } | null = null;
    (shapeViewStore as unknown as { setState: (p: unknown) => void }).setState({
      setView: (v: { zoom: number; panX: number; panY: number }) => {
        viewSnap = v;
        origSetView(v);
      },
    });
    rendererRef.current = {
      camera: { position: camPos, lookAt: () => camCalls.push('lookAt'), updateProjectionMatrix: () => {} },
      orbit: { target: tgt, update: () => {} },
    } as never;
    try {
      applyTemplate(dst, moduleToTemplate(entry));
      const st = dst.getState();
      // Test 4：组件全部一致（类型/参数/变换）
      expect(st.components).toHaveLength(2);
      expect(st.components.map((c) => c.type)).toEqual(s0.components.map((c) => c.type));
      for (const [i, c] of st.components.entries()) {
        expect(c.transform.position).toEqual(s0.components[i]!.transform.position);
        expect(c.transform.rotation).toEqual(s0.components[i]!.transform.rotation);
        expect(c.transform.scale).toBe(s0.components[i]!.transform.scale);
      }
      expect((st.components[1]!.params as { kind: string }).kind).toBe('H₂O');
      // Test 5：图元全部一致（类型/坐标/尺寸/文本）
      expect(st.shapes).toHaveLength(2);
      expect(st.shapes.map((x) => x.type)).toEqual(['rect', 'text']);
      expect(st.shapes[0]!.x).toBe(s0.shapes[0]!.x);
      expect(st.shapes[0]!.w).toBe(s0.shapes[0]!.w);
      expect((st.shapes[1] as { text: string }).text).toBe('机理标注');
      // Test 6：相机 / target / 2D 视图浮点一致
      expect(posArgs.at(-1)).toEqual([12, -34, 56]);
      expect(tgtArgs.at(-1)).toEqual([1, 2, 3]);
      expect(viewSnap).toEqual({ zoom: 1.75, panX: 40, panY: -20 });
      expect(st.mode).toBe('diagram');
    } finally {
      rendererRef.current = prev;
      (shapeViewStore as unknown as { setState: (p: unknown) => void }).setState({ setView: origSetView });
    }
  });
});

describe('旧数据兼容（Test 7/8/9/10/11）', () => {
  beforeEach(async () => {
    await clearModuleLibrary();
  });

  it('Test 7：旧单组件模块 fixture（M2）加载', () => {
    const m2 = SEED_MODULES.modules.find((m) => m.name.startsWith('M2'))!;
    expect(m2.type).toBe('kaolinite_sheet');
    if (m2.type !== 'kaolinite_sheet') return; // 类型收窄
    expect(moduleSchema.safeParse(m2).success).toBe(true);
    const store = createSceneStore();
    const id = store.getState().addComponent(m2.type, {
      name: m2.name,
      params: m2.params,
      transform: m2.transform,
    });
    expect(store.getState().components).toHaveLength(1);
    expect(store.getState().components[0]!.id).toBe(id);
  });

  it('Test 8：旧组合模块 fixture（M6/M8）逐组件加载', () => {
    for (const name of ['M6', 'M8']) {
      const m = SEED_MODULES.modules.find((x) => x.name.startsWith(name))!;
      expect(m.type).toBe('combined');
      if (m.type !== 'combined') continue; // 类型收窄
      const store = createSceneStore();
      for (const c of m.components) {
        store.getState().addComponent(c.type, { name: c.name, params: c.params, transform: c.transform, visible: c.visible });
      }
      expect(store.getState().components).toHaveLength(m.components.length);
    }
  });

  it('Test 9：旧 templateLibrary 条目迁移进统一库并可加载', async () => {
    // 旧库写入一条真实种子模板（模拟历史数据）
    await saveTemplate(SEED_TEMPLATES[0]!);
    storeMap.delete('kaolin_templates_migrated_v1');
    const n = await migrateTemplatesToModules();
    expect(n).toBeGreaterThanOrEqual(1);
    const all = await listModules();
    const moved = all.find((m) => m.id === SEED_TEMPLATES[0]!.id);
    expect(moved).toBeTruthy();
    expect(moved!.type).toBe('template');
    expect(moved!.thumb).toMatch(/^data:image\//); // 占位缩略图
    // 迁移条目可加载（applyTemplate 管线）
    const store = createSceneStore();
    applyTemplate(store, moduleToTemplate(moved as Extract<ModuleEntry, { type: 'template' }>));
    expect(store.getState().shapes).toHaveLength(SEED_TEMPLATES[0]!.shapes.length);
  });

  it('Test 10/11：favorite 与 thumb 保持（保存 → 读取一致）', async () => {
    const m2 = SEED_MODULES.modules.find((m) => m.name.startsWith('M2'))!;
    await saveModule({ ...m2, favorite: true } as ModuleEntry);
    const back = (await listModules()).find((m) => m.id === m2.id)!;
    expect(back.favorite).toBe(true);
    expect(back.thumb).toBe(m2.thumb);
  });
});

describe('导入导出兼容（Test 12/13）', () => {
  beforeEach(async () => {
    await clearModuleLibrary();
  });

  it('Test 12：旧 kaolin-modules/v1 备份 → 新 importer 全量可导', async () => {
    const text = JSON.stringify({ format: MODULES_FORMAT, exportedAt: new Date().toISOString(), modules: SEED_MODULES.modules });
    const { imported, skipped } = await importModules(text);
    expect(imported).toBe(SEED_MODULES.modules.length);
    expect(skipped).toBe(0);
  });

  it('Test 13：新模板 export → 删库 → import roundtrip 无损', async () => {
    const store = buildRichScene();
    const s = store.getState();
    const entry = templateEntryFromScene(
      {
        components: s.components,
        shapes: s.shapes,
        annotations: s.annotations,
        mode: 'diagram',
        camera: { position: [5, 6, 7], target: [0, 0, 0] },
        view: { zoom: 2, panX: -3, panY: 9 },
      },
      THUMB,
      'T-roundtrip',
    );
    await saveModule({ ...entry, favorite: true } as ModuleEntry);
    const text = await exportModules();
    await clearModuleLibrary();
    expect((await listModules())).toHaveLength(0);
    const { imported } = await importModules(text);
    expect(imported).toBeGreaterThanOrEqual(1);
    const back = (await listModules()).find((m) => m.name === 'T-roundtrip')!;
    expect(back.type).toBe('template');
    const tpl = back as Extract<ModuleEntry, { type: 'template' }>;
    expect(tpl.components).toHaveLength(2);
    expect(tpl.shapes).toHaveLength(2);
    expect(tpl.camera).toEqual({ position: [5, 6, 7], target: [0, 0, 0] });
    expect(tpl.view).toEqual({ zoom: 2, panX: -3, panY: 9 });
    expect(tpl.thumb).toBe(THUMB);
    expect(tpl.favorite).toBe(true);
    expect(tpl.mode).toBe('diagram');
  });
});

describe('迁移幂等（Test 14）', () => {
  it('重复执行不产生重复条目（同 id 覆盖 + 标记双保险）', async () => {
    await clearModuleLibrary();
    await saveTemplate(SEED_TEMPLATES[0]!);
    storeMap.delete('kaolin_templates_migrated_v1');
    await migrateTemplatesToModules();
    const after1 = (await listModules()).length;
    // 模拟无标记二次启动（极端：localStorage 被清）——同 id bulkPut 也不重复
    storeMap.delete('kaolin_templates_migrated_v1');
    await migrateTemplatesToModules();
    const after2 = (await listModules()).length;
    expect(after2).toBe(after1);
    // 同一模板 id 只出现一次
    const ids = (await listModules()).map((m) => m.id);
    expect(ids.filter((x) => x === SEED_TEMPLATES[0]!.id)).toHaveLength(1);
  });
});
