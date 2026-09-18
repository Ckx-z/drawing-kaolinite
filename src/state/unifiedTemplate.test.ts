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
import type { SceneShape } from '../core/shapes/schema';
import { createSceneStore } from './sceneStore';
import { saveTemplate, type TemplateEntry } from './templateLibrary';
import {
  clearModuleLibrary,
  ensureSeededTemplates,
  exportModules,
  generateMissingThumbnails,
  importModules,
  isPlaceholderThumb,
  listModules,
  migrateTemplatesToModules,
  moduleToSceneDocument,
  placeholderTemplateThumb,
  saveModule,
  shapeSceneThumb,
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

describe('统一模板：作为独立场景打开（Test 4/5/6，loadScene 替换链路）', () => {
  it('组件/图元/相机/2D 视图/形态全部一致（复用 loadScene，禁 frameAll）', async () => {
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

    // 打开（ModulePanel openTemplate 的核心路径：normalize → loadScene 一次性替换）
    const dst = createSceneStore();
    const { rendererRef } = await import('./rendererRef');
    const { shapeViewStore } = await import('../ui/shapes/view');
    const posArgs: number[][] = [];
    const tgtArgs: number[][] = [];
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
      camera: { position: camPos, lookAt: () => {}, updateProjectionMatrix: () => {} },
      orbit: { target: tgt, update: () => {} },
    } as never;
    try {
      const restored = dst.getState().loadScene(moduleToSceneDocument(entry));
      expect(restored).toBe(true); // 有视角快照 → 不需要 frameAll fallback
      const st = dst.getState();
      // Test 4：组件全部一致（类型/参数/变换；id 原样 → 锚定天然成立）
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

describe('统一打开 = REPLACE 不叠加（2026-09-17 模板独立场景）', () => {
  it('A(2组件+2图元) → B(1组件+0图元)：全量替换而非追加', () => {
    const a = templateEntryFromScene(
      { components: buildRichScene().getState().components, shapes: buildRichScene().getState().shapes, mode: 'mixed' },
      THUMB,
      'A',
    );
    const bSrc = createSceneStore();
    bSrc.getState().addComponent('molecule', { name: 'CO₂', params: { kind: 'CO₂' } });
    const b = templateEntryFromScene({ components: bSrc.getState().components, shapes: [], annotations: [], mode: 'mixed' }, THUMB, 'B');

    const store = createSceneStore();
    store.getState().loadScene(moduleToSceneDocument(a));
    expect(store.getState().components).toHaveLength(2);
    expect(store.getState().shapes).toHaveLength(2);
    store.getState().loadScene(moduleToSceneDocument(b));
    expect(store.getState().components).toHaveLength(1); // 不是 3
    expect(store.getState().shapes).toHaveLength(0); // 不是 2
    expect(store.getState().components[0]!.type).toBe('molecule');
  });

  it('连续打开：对象数不累计（9 → 6 → 2）', () => {
    const mk = (n: number, tag: string): ModuleEntry => {
      const s = createSceneStore();
      for (let i = 0; i < n; i++) s.getState().addComponent('nanoparticle');
      return templateEntryFromScene({ components: s.getState().components, shapes: [], mode: 'mixed' }, THUMB, tag);
    };
    const store = createSceneStore();
    store.getState().loadScene(moduleToSceneDocument(mk(9, 'T9')));
    expect(store.getState().components).toHaveLength(9);
    store.getState().loadScene(moduleToSceneDocument(mk(6, 'T6')));
    expect(store.getState().components).toHaveLength(6); // 不是 15
    store.getState().loadScene(moduleToSceneDocument(mk(2, 'T2')));
    expect(store.getState().components).toHaveLength(2);
  });

  it('Annotations 全量替换：A 有标注 → B 无 → 空', () => {
    const aSrc = createSceneStore();
    aSrc.getState().addComponent('nanoparticle');
    const a = templateEntryFromScene(
      { components: aSrc.getState().components, shapes: [], annotations: [{ type: 'scalebar', worldLen: 10 } as never], mode: 'mixed' },
      THUMB,
      'A',
    );
    const bSrc = createSceneStore();
    bSrc.getState().addComponent('molecule', { params: { kind: 'H₂O' } });
    const b = templateEntryFromScene({ components: bSrc.getState().components, shapes: [], annotations: [], mode: 'mixed' }, THUMB, 'B');
    const store = createSceneStore();
    store.getState().loadScene(moduleToSceneDocument(a));
    store.getState().loadScene(moduleToSceneDocument(b));
    expect(store.getState().annotations).toHaveLength(0);
  });

  it('旧单组件模块：当前 2 组件 → 打开后只剩 1（独立场景）', () => {
    const m2 = SEED_MODULES.modules.find((m) => m.name.startsWith('M2'))!;
    if (m2.type === 'kaolinite_sheet') {
      const store = buildRichScene();
      store.getState().loadScene(moduleToSceneDocument(m2));
      expect(store.getState().components).toHaveLength(1);
      expect(store.getState().shapes).toHaveLength(0); // 字段缺失 = 模板没有图元（非保留旧图元）
    }
  });

  it('旧组合模块：当前 2 组件 → 打开后 = 组合自身组件数', () => {
    const m6 = SEED_MODULES.modules.find((m) => m.name.startsWith('M6'))!;
    if (m6.type === 'combined') {
      const store = buildRichScene();
      store.getState().loadScene(moduleToSceneDocument(m6));
      expect(store.getState().components).toHaveLength(m6.components.length); // 不是 2+N
    }
  });

  it('Selection / 测量拾取清理：旧场景的会话态不残留', () => {
    const store = buildRichScene();
    const first = store.getState().components[0]!;
    store.getState().select(first.id);
    store.setState({ measurements: [{ id: 'mm1' } as never], measurePick: [{ compId: first.id, index: 0 } as never] });
    const bSrc = createSceneStore();
    bSrc.getState().addComponent('molecule');
    const b = templateEntryFromScene({ components: bSrc.getState().components, shapes: [], mode: 'mixed' }, THUMB, 'B');
    store.getState().loadScene(moduleToSceneDocument(b));
    expect(store.getState().selectionId).toBeNull();
    expect(store.getState().shapeSelectionIds).toHaveLength(0);
    expect(store.getState().measurements).toHaveLength(0);
    expect(store.getState().measurePick).toHaveLength(0);
  });

  it('3D → 纯 2D 模板：组件清空、图元就位、形态切换；再回 3D：图元不残留', () => {
    const t3d = templateEntryFromScene({ components: buildRichScene().getState().components, shapes: [], mode: 'mixed' }, THUMB, '3D');
    const d2 = createSceneStore();
    d2.getState().addShape({ type: 'ellipse', x: 0, y: 0, w: 40, h: 30 } as never); // addShape 补默认 → shapeSchema 合法
    const t2d = templateEntryFromScene({ components: [], shapes: d2.getState().shapes, mode: 'diagram' }, THUMB, '2D');
    const store = createSceneStore();
    store.getState().loadScene(moduleToSceneDocument(t3d));
    store.getState().loadScene(moduleToSceneDocument(t2d));
    expect(store.getState().components).toHaveLength(0); // 3D 内容不残留
    expect(store.getState().shapes).toHaveLength(1);
    expect(store.getState().shapes[0]!.type).toBe('ellipse');
    expect(store.getState().mode).toBe('diagram');
    const t3dAgain = templateEntryFromScene({ components: buildRichScene().getState().components, shapes: [], mode: 'mixed' }, THUMB, '3D-2');
    store.getState().loadScene(moduleToSceneDocument(t3dAgain));
    expect(store.getState().shapes).toHaveLength(0); // 2D 图元不残留
    expect(store.getState().components).toHaveLength(2);
    expect(store.getState().mode).toBe('mixed');
  });

  it('非法模板：校验失败在替换前抛错，当前场景原样保留（原子性）', () => {
    const store = buildRichScene();
    expect(store.getState().components).toHaveLength(2);
    const bad = {
      type: 'template',
      id: 'bad',
      name: 'bad',
      components: [{ id: 'x', type: 'kaolinite_sheet', params: { Lx: 99999 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }],
      thumb: THUMB,
    } as unknown as ModuleEntry;
    expect(() => store.getState().loadScene(moduleToSceneDocument(bad))).toThrow();
    expect(store.getState().components).toHaveLength(2); // 没有被清空
    expect(store.getState().shapes).toHaveLength(2);
  });

  it('打开模板 = 一条完整事务：无碎片化，Ctrl+Z 整体回退到上一个模板', async () => {
    const { attachHistory } = await import('./history');
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const one = createSceneStore();
    one.getState().addComponent('nanoparticle');
    const a = templateEntryFromScene({ components: one.getState().components, shapes: [], mode: 'mixed' }, THUMB, 'A');
    const b = templateEntryFromScene({ components: buildRichScene().getState().components, shapes: buildRichScene().getState().shapes, mode: 'mixed' }, THUMB, 'B');
    store.getState().loadScene(moduleToSceneDocument(a));
    store.getState().loadScene(moduleToSceneDocument(b));
    expect(store.getState().components).toHaveLength(2);
    expect(history.depths().undo).toBe(2); // 空场景→A→B = 两条完整事务（非逐组件碎片）
    history.undo();
    expect(store.getState().components).toHaveLength(1); // 整体回退到 A（不是只删 B 最后一个组件）
    history.redo();
    expect(store.getState().components).toHaveLength(2);
    expect(store.getState().shapes).toHaveLength(2);
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
    if (!moved || moved.type !== 'template') throw new Error('迁移条目缺失或类型异常');
    // 迁移条目作为独立场景打开（loadScene 替换管线）
    const store = createSceneStore();
    store.getState().addComponent('nanoparticle'); // 预置旧内容，验证被替换
    store.getState().loadScene(moduleToSceneDocument(moved));
    expect(store.getState().shapes).toHaveLength(SEED_TEMPLATES[0]!.shapes.length);
    expect(store.getState().components).toHaveLength(0); // 预置组件被替换掉（模板无组件）
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

describe('真实缩略图（2026-09-17b：卡片必须是真实场景预览，占位仅 fallback）', () => {
  beforeEach(async () => {
    await clearModuleLibrary();
  });

  it('纯 2D 模板缩略图 = 真实矢量渲染（rect/text/箭头头可见，非 emoji 占位，确定性）', () => {
    const seed = SEED_TEMPLATES.find((t) => t.id === 'tpl-interfacial')!;
    const thumb = shapeSceneThumb(seed.shapes as SceneShape[]);
    expect(thumb).toMatch(/^data:image\/svg\+xml/);
    const svg = decodeURIComponent(thumb);
    expect(svg).toContain('<rect');
    expect(svg).toContain('<text');
    expect(svg.toLowerCase()).toContain('polygon'); // 箭头三角头
    expect(isPlaceholderThumb(thumb)).toBe(false);
    expect(svg).not.toContain('🧩');
    expect(svg).not.toContain('⭐');
    expect(shapeSceneThumb(seed.shapes as SceneShape[])).toBe(thumb); // 确定性
  });

  it('种子注入统一库：纯 2D 种子模板自带真实缩略图（非占位）', async () => {
    await ensureSeededTemplates(SEED_TEMPLATES);
    const seed = (await listModules()).find((m) => m.id === 'tpl-interfacial')!;
    expect(seed.type).toBe('template');
    expect(isPlaceholderThumb(seed.thumb)).toBe(false);
    expect(seed.thumb).toMatch(/^data:image\/svg\+xml/);
  });

  it('历史占位缩略图回填：纯 2D 模板换真实图且幂等；含 3D 组件的模板保留 fallback', async () => {
    // 模拟上一版迁移入库的占位种子（纯 2D）
    const seed = SEED_TEMPLATES[0]!;
    await saveModule(
      moduleSchema.parse({
        id: seed.id,
        name: seed.name,
        type: 'template',
        components: [],
        shapes: seed.shapes as never,
        thumb: placeholderTemplateThumb(true),
        createdAt: '2026-09-16T00:00:00Z',
        moduleVersion: 1,
      }) as ModuleEntry,
    );
    // 含 3D 组件的占位条目（无法离屏渲染 → 保留占位）
    const store = createSceneStore();
    store.getState().addComponent('nanoparticle');
    const with3d = templateEntryFromScene(
      { components: store.getState().components, shapes: [{ id: 's1', type: 'rect', x: 0, y: 0, w: 10, h: 10 } as never], mode: 'mixed' },
      placeholderTemplateThumb(),
      'T-3D',
    );
    await saveModule(with3d);

    const n = await generateMissingThumbnails();
    expect(n).toBe(1);
    const all = await listModules();
    const pure2d = all.find((m) => m.id === seed.id)!;
    expect(isPlaceholderThumb(pure2d.thumb)).toBe(false);
    expect(pure2d.thumb).toMatch(/^data:image\/svg\+xml/);
    expect(pure2d.name).toBe(seed.name); // 其余字段不动（只换 thumb）
    const still3d = all.find((m) => m.name === 'T-3D')!;
    expect(isPlaceholderThumb(still3d.thumb)).toBe(true); // 3D 模板离屏渲染复杂 → fallback
    // 幂等：再跑零回填
    expect(await generateMissingThumbnails()).toBe(0);
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
