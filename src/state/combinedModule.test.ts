/**
 * 组合模块验收测试 —— T-3.1
 *
 * 核心验收（TODO）：保存"管+颗粒+分子"三组件组合模块 → 清空画布 → 重新实例化，
 * 相对位置一致（逐对位置差断言）；缩略图完整；schema 往返无损；导入导出兼容。
 * 环境：fake-indexeddb + localStorage shim（Node 无 DOM，与 moduleLibrary.test.ts 同款）。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { moduleSchema } from '../core/schema';
import { deserializeModule } from '../core/schema';
import {
  clearModuleLibrary,
  deleteModule,
  exportModules,
  importModules,
  listModules,
  moduleEntryFromScene,
  saveModule,
} from './moduleLibrary';
import { createSceneStore, type SceneStore } from './sceneStore';

// localStorage shim（moduleLibrary 迁移路径惰性访问）
const storeMap = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => storeMap.get(k) ?? null,
    setItem: (k: string, v: string) => void storeMap.set(k, v),
    removeItem: (k: string) => void storeMap.delete(k),
    clear: () => storeMap.clear(),
    key: (i: number) => [...storeMap.keys()][i] ?? null,
    get length() {
      return storeMap.size;
    },
  },
  configurable: true,
});

const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';

/** 搭建"管+颗粒+分子"三组件场景（互不重叠的错位变换） */
function buildScene(store: SceneStore): string[] {
  const tube = store.getState().addComponent('halloysite_tube', {
    name: '埃洛石管（双层壁）',
    params: { innerR: 14, length: 100, walls: 2, d001: 10, progress: 1, taperDeg: 5, style: '空间填充' },
    transform: { position: [10, -6, 0], rotation: [0, 0, 90], scale: 1 },
  });
  const part = store.getState().addComponent('nanoparticle', {
    name: 'CeO₂ 颗粒 A',
    params: { radius: 9, grains: 170, seed: 11, mode: '簇装' },
    transform: { position: [58, 6, 2], rotation: [0, 10, 0], scale: 1 },
  });
  const mol = store.getState().addComponent('molecule', {
    name: 'H₂O ×1',
    transform: { position: [-8, 26, 10], rotation: [0, 0, 25], scale: 4 },
  });
  return [tube, part, mol];
}

/** 逐对组件的相对位姿：位置差向量 + 距离（组合模块实例化一致性的硬指标） */
function pairwiseRelatives(positions: Array<[number, number, number]>, store: SceneStore): string {
  const comps = store.getState().components;
  const parts: string[] = [];
  for (let i = 0; i < comps.length; i++)
    for (let j = i + 1; j < comps.length; j++) {
      const a = positions[i], b = positions[j];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      parts.push(`${i}-${j}:${d.map((x) => x.toFixed(4)).join(',')}|${dist.toFixed(6)}`);
    }
  return parts.join(';');
}

beforeEach(async () => {
  storeMap.clear();
  await clearModuleLibrary();
});

describe('schema：combined 变体', () => {
  it('组合条目通过校验，JSON 往返无损（deserializeModule）', () => {
    const store = createSceneStore();
    buildScene(store);
    const entry = moduleEntryFromScene(store.getState().components, THUMB, '组合测试');
    expect(entry.type).toBe('combined');

    const roundtrip = deserializeModule(JSON.stringify(entry));
    expect(roundtrip).toEqual(entry);
  });

  it('非法组合条目拒绝：空 components / thumb 前缀错 / 未知字段', () => {
    const base = {
      type: 'combined',
      id: 'm1',
      name: '坏条目',
      thumb: THUMB,
    };
    expect(moduleSchema.safeParse({ ...base, components: [] }).success).toBe(false);
    expect(
      moduleSchema.safeParse({
        ...base,
        thumb: 'https://example.com/a.jpg',
        components: [{ type: 'molecule', name: 'x', params: { kind: 'H₂O' }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 4 } }],
      }).success,
    ).toBe(false);
    expect(
      moduleSchema.safeParse({
        ...base,
        extraTypo: 1,
        components: [{ type: 'molecule', name: 'x', params: { kind: 'H₂O' }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 4 } }],
      }).success,
    ).toBe(false);
  });
});

describe('核心验收：保存 → 清空 → 实例化，相对位置一致', () => {
  it('三组件组合模块实例化后逐对位置差/距离/旋转/缩放/参数完全一致', () => {
    const store = createSceneStore();
    const beforeIds = buildScene(store);
    const beforePositions = store
      .getState()
      .components.map((c) => c.transform.position) as Array<[number, number, number]>;
    const beforeRelative = pairwiseRelatives(beforePositions, store);

    // 入库 → 清空画布
    const entry = moduleEntryFromScene(store.getState().components, THUMB, '管+颗粒+分子');
    expect(entry.type === 'combined' && entry.components).toHaveLength(3);
    store.getState().clear();
    expect(store.getState().components).toHaveLength(0);

    // 实例化（与 ModulePanel 同一逻辑路径）
    if (entry.type !== 'combined') throw new Error('条目应为 combined');
    const afterIds: string[] = [];
    for (const c of entry.components) {
      afterIds.push(
        store.getState().addComponent(c.type, {
          name: c.name,
          params: c.params,
          transform: c.transform,
          visible: c.visible,
        }),
      );
    }
    expect(afterIds.every((id, i) => id !== beforeIds[i])).toBe(true); // id 全新生成

    // 相对位置一致性：逐对位置差与距离逐一相等
    const afterRelative = pairwiseRelatives(
      store.getState().components.map((c) => c.transform.position) as Array<[number, number, number]>,
      store,
    );
    expect(afterRelative).toBe(beforeRelative);

    // 其余字段逐组件一致（类型/名称/参数/旋转/缩放/显隐）
    for (let i = 0; i < 3; i++) {
      const src = entry.components[i];
      const dst = store.getState().components[i];
      expect(dst.type).toBe(src.type);
      expect(dst.name).toBe(src.name);
      expect(dst.params).toEqual(src.params);
      expect(dst.transform.rotation).toEqual(src.transform.rotation);
      expect(dst.transform.scale).toBe(src.transform.scale);
      expect(dst.visible).toBe(src.visible);
    }
  });

  it('实例化后各组件仍独立可调（改一个不影响其余）', () => {
    const store = createSceneStore();
    buildScene(store);
    const entry = moduleEntryFromScene(store.getState().components, THUMB, '组合');
    store.getState().clear();
    if (entry.type !== 'combined') throw new Error('条目应为 combined');
    for (const c of entry.components) {
      store.getState().addComponent(c.type, {
        name: c.name, params: c.params, transform: c.transform, visible: c.visible,
      });
    }
    const particle = store.getState().components.find((c) => c.type === 'nanoparticle');
    if (!particle) throw new Error('缺少颗粒组件');
    store
      .getState()
      .updateParams(particle.id, { ...(particle.params as object), seed: 66 } as never);
    const after = store.getState().components;
    expect(after).toHaveLength(3);
    // 管的参数未被牵连；颗粒 seed 已改
    expect(after.filter((c) => c.type === 'halloysite_tube')[0].params).toEqual(
      entry.components.filter((c) => c.type === 'halloysite_tube')[0].params,
    );
    expect((after.find((c) => c.type === 'nanoparticle')?.params as { seed: number }).seed).toBe(66);
    expect(after[0].name).toBe(entry.components[0].name);
  });
});

describe('模块库持久层：组合条目入库/列表/删除/导入导出', () => {
  it('saveModule → listModules → deleteModule 全链路', async () => {
    const store = createSceneStore();
    buildScene(store);
    const entry = moduleEntryFromScene(store.getState().components, THUMB, '组合入库');
    await saveModule(entry);

    const listed = await listModules();
    expect(listed).toHaveLength(1);
    expect(listed[0].type).toBe('combined');

    await deleteModule(entry.id);
    expect(await listModules()).toHaveLength(0);
  });

  it('导出/导入往返保留组合条目', async () => {
    const store = createSceneStore();
    buildScene(store);
    await saveModule(moduleEntryFromScene(store.getState().components, THUMB, '组合备份'));
    const text = await exportModules();
    await clearModuleLibrary();

    const res = await importModules(text);
    expect(res).toEqual({ imported: 1, skipped: 0 });
    const back = await listModules();
    expect(back[0].type).toBe('combined');
    expect(back[0].type === 'combined' && back[0].components).toHaveLength(3);
  });
});
