import { beforeEach, describe, expect, it } from 'vitest';
import { sceneDocumentSchema } from '../core/schema';
import { createSceneStore, type SceneState } from './sceneStore';

/**
 * T-1.5 验收：面板操作通过 store 直接驱动（不依赖 UI / three）。
 * 每个用例用独立 store 实例（工厂化），互不污染。
 */
let store: ReturnType<typeof createSceneStore>;

beforeEach(() => {
  store = createSceneStore();
});

const types = [
  'kaolinite_sheet',
  'halloysite_tube',
  'nanoparticle',
  'molecule',
  'rubber_substrate',
] as const;

describe('addComponent：默认值与命名（对齐 demo DEFAULTS / DATA_DICT）', () => {
  it('五类组件默认参数正确，molecule 默认 scale=4', () => {
    for (const t of types) store.getState().addComponent(t);
    const comps = store.getState().components;
    expect(comps).toHaveLength(5);

    const sheet = comps[0];
    expect(sheet.type).toBe('kaolinite_sheet');
    expect(sheet.params).toMatchObject({ Lx: 70, Ly: 60, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false });
    expect(comps[3].transform.scale).toBe(4);
    expect(comps[3].type).toBe('molecule');
    expect(comps.every((c) => c.visible && c.locked === false)).toBe(true);
  });

  it('同类命名自增（高岭土片层 1 / 2 …），id 唯一', () => {
    const a = store.getState().addComponent('kaolinite_sheet');
    const b = store.getState().addComponent('kaolinite_sheet');
    const names = store.getState().components.map((c) => c.name);
    expect(names).toEqual(['高岭土片层 1', '高岭土片层 2']);
    expect(a).not.toBe(b);
  });

  it('opts 覆盖默认参数（非法值被 schema 拦截）', () => {
    store.getState().addComponent('halloysite_tube', { params: { innerR: 20, progress: 0.45 }, name: '半卷管' });
    const tube = store.getState().components[0];
    expect(tube.params).toMatchObject({ innerR: 20, progress: 0.45, length: 90 }); // 未覆盖项保留默认
    expect(tube.name).toBe('半卷管');

    expect(() => store.getState().addComponent('nanoparticle', { params: { radius: 999 } })).toThrow();
    expect(store.getState().components).toHaveLength(1); // 失败不产生半成品组件
  });
});

describe('updateParams / setTransform：校验失败抛错且状态不变（T-1.2 schema 复用）', () => {
  beforeEach(() => {
    store.getState().addComponent('kaolinite_sheet');
  });

  it('合法合并更新', () => {
    const id = store.getState().components[0].id;
    store.getState().updateParams(id, { layers: 3, d001: 10 });
    expect(store.getState().components[0].params).toMatchObject({ layers: 3, d001: 10, Lx: 70 });
  });

  it.each([
    ['Lx 超上限', { Lx: 999 }],
    ['layers 非整数范围', { layers: 5 }],
    ['未知字段（strictObject）', { typo: 1 } as unknown as Record<string, number>],
  ])('%s → 抛错且状态不变', (_label, patch) => {
    const id = store.getState().components[0].id;
    const before = JSON.stringify(store.getState().components);
    expect(() => store.getState().updateParams(id, patch)).toThrow();
    expect(JSON.stringify(store.getState().components)).toBe(before);
  });

  it('setTransform 校验 scale 下限', () => {
    const id = store.getState().components[0].id;
    store.getState().setTransform(id, { position: [10, 20, 30], rotation: [0, 45, 0], scale: 2 });
    expect(store.getState().components[0].transform).toEqual({ position: [10, 20, 30], rotation: [0, 45, 0], scale: 2 });
    expect(() => store.getState().setTransform(id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 0.001 })).toThrow();
  });

  it('不存在的 id 静默忽略', () => {
    store.getState().updateParams('ghost', { Lx: 100 });
    expect(store.getState().components).toHaveLength(1);
  });
});

describe('select / removeComponent / setVisibility / toggleLock', () => {
  it('删除选中组件时清除选择；删除不存在 id 无操作', () => {
    const s = store.getState() as SceneState;
    const a = s.addComponent('molecule');
    s.addComponent('molecule');
    s.select(a);
    expect(store.getState().selectionId).toBe(a);
    s.removeComponent(a);
    expect(store.getState().selectionId).toBeNull();
    expect(store.getState().components).toHaveLength(1);

    const before = JSON.stringify(store.getState().components);
    s.removeComponent('ghost');
    expect(JSON.stringify(store.getState().components)).toBe(before);
  });

  it('select 不存在的 id 被拒绝', () => {
    store.getState().select('ghost');
    expect(store.getState().selectionId).toBeNull();
  });

  it('显隐与锁定翻转', () => {
    const s = store.getState();
    const id = s.addComponent('nanoparticle');
    s.setVisibility(id, false);
    expect(store.getState().components[0].visible).toBe(false);
    s.toggleLock(id);
    expect(store.getState().components[0].locked).toBe(true);
    s.toggleLock(id);
    expect(store.getState().components[0].locked).toBe(false);
  });
});

describe('序列化往返：toSceneDocument / loadScene', () => {
  it('导出的场景文档通过 kaolin-scene/v1 校验，重载后逐字段一致', () => {
    const s = store.getState();
    s.addComponent('halloysite_tube', { params: { walls: 2, d001: 10 } });
    const id2 = s.addComponent('molecule');
    s.select(id2);
    s.setVisibility(id2, false);

    const doc = store.getState().toSceneDocument();
    expect(() => sceneDocumentSchema.parse(doc)).not.toThrow();

    const store2 = createSceneStore();
    store2.getState().loadScene(doc);
    const reloaded = store2.getState().components;
    expect(reloaded).toHaveLength(2);
    expect(reloaded[0].params).toMatchObject({ walls: 2, d001: 10 });
    expect(reloaded[1].visible).toBe(false);
    expect(store2.getState().selectionId).toBeNull(); // 载入清空选择
    // id 缺失场景文件（demo 兼容）→ loadScene 内部 normalizeScene 已补
    expect(reloaded.every((c) => typeof c.id === 'string')).toBe(true);
  });

  it('loadScene 接受 JSON 文本（与对象双入口一致）', () => {
    const s = store.getState();
    s.addComponent('nanoparticle');
    const text = JSON.stringify(store.getState().toSceneDocument());
    const store2 = createSceneStore();
    store2.getState().loadScene(text);
    expect(store2.getState().components[0].type).toBe('nanoparticle');
  });

  it('clear 清空组件与选择', () => {
    const s = store.getState();
    const id = s.addComponent('molecule');
    s.select(id);
    s.clear();
    expect(store.getState().components).toHaveLength(0);
    expect(store.getState().selectionId).toBeNull();
  });
});
