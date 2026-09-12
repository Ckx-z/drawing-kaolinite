import { beforeEach, describe, expect, it } from 'vitest';
import { sceneDocumentSchema } from '../core/schema';
import type { Transform } from '../core/types';
import { attachHistory } from './history';
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
    expect(sheet.params).toMatchObject({ Lx: 70, Ly: 60, layers: 1, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false, strictCell: false });
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

describe('旋转交互（2026-09-12：无限连续旋转 + 组同步最短角差）', () => {
  const T = (over: Partial<Transform>): Transform => ({
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    ...over,
  });

  it('组同步最短角差：leader 179°→−179°（等价 +2°），成员增量 +2 而非 −358', () => {
    const store = createSceneStore();
    const a = store.getState().addComponent('molecule');
    const b = store.getState().addComponent('molecule');
    store.getState().groupComponents([a, b]);
    // 摆好初始：两成员 Y 均 179°
    store.getState().setTransform(a, T({ rotation: [0, 179, 0] }));
    store.getState().setTransform(b, T({ rotation: [0, 179, 0] }));
    // 解除合并影响：直接构造两成员同组不同初始角会互相污染——用同组同角基线后 leader 拖到 −179
    const gb = store.getState().components.find((c) => c.id === b)!.transform.rotation[1];
    store.getState().setTransform(a, T({ rotation: [0, -179, 0] }));
    const b2 = store.getState().components.find((c) => c.id === b)!.transform.rotation[1];
    // −179 ≡ 181 ≡ 179+2：成员应从 179 → 181（最短角差 +2），而不是 179−358=−179
    expect(Math.abs(b2 - (gb + 2))).toBeLessThan(0.01);
  });

  it('组同步跨整圈：leader Y 0→−361（裸差 −361），成员净转 −1 而非 −361', () => {
    const store = createSceneStore();
    const a = store.getState().addComponent('molecule');
    const b = store.getState().addComponent('molecule');
    store.getState().groupComponents([a, b]);
    store.getState().setTransform(a, T({ rotation: [0, -361, 0] }));
    const b2 = store.getState().components.find((c) => c.id === b)!.transform.rotation[1];
    expect(b2).toBeCloseTo(-1, 6);
  });

  it('单组件旋转角无范围截断（多圈 720° 直写合法，供累积表示）', () => {
    const store = createSceneStore();
    const id = store.getState().addComponent('molecule');
    store.getState().setTransform(id, T({ rotation: [0, 720, 0] }));
    expect(store.getState().components[0]!.transform.rotation[1]).toBe(720);
    store.getState().setTransform(id, T({ rotation: [0, -1080, 0] }));
    expect(store.getState().components[0]!.transform.rotation[1]).toBe(-1080);
  });
});

describe('组件多选与批量操作（T-7.3）', () => {
  const T0 = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });

  it('Shift 语义：从单选起步叠加；0 → 全清 / 1 → 转单选 / ≥2 → 多选态', () => {
    const store = createSceneStore();
    const a = store.getState().addComponent('molecule');
    const b = store.getState().addComponent('molecule');
    const c = store.getState().addComponent('molecule');
    store.getState().select(a); // 单选起步
    store.getState().toggleComponentSelection(b); // +b → 2 个 → 多选态
    expect(store.getState().componentSelectionIds).toEqual([a, b]);
    expect(store.getState().selectionId).toBeNull(); // gizmo 收起
    store.getState().toggleComponentSelection(c); // +c → 3 个
    expect(store.getState().componentSelectionIds).toEqual([a, b, c]);
    store.getState().toggleComponentSelection(a); // -a → 2 个（仍多选）
    expect(store.getState().componentSelectionIds).toEqual([b, c]);
    store.getState().toggleComponentSelection(c); // -c → 1 个 → 转单选
    expect(store.getState().selectionId).toBe(b);
    expect(store.getState().componentSelectionIds).toEqual([]);
    store.getState().toggleComponentSelection(b); // -b → 0 → 全清
    expect(store.getState().selectionId).toBeNull();
  });

  it('互斥：图元选择清组件多选；普通点击清多选；锁定组件不可入选', () => {
    const store = createSceneStore();
    const a = store.getState().addComponent('molecule');
    const b = store.getState().addComponent('molecule');
    store.getState().selectComponentIds([a, b]);
    store.getState().addShape({ type: 'rect', x: 0, y: 0 });
    store.getState().toggleShapeSelection(store.getState().shapes[0]!.id);
    expect(store.getState().componentSelectionIds).toEqual([]); // 图元选择互斥
    store.getState().selectShape(null);
    store.getState().selectComponentIds([a, b]);
    store.getState().select(a); // 普通点击回单选
    expect(store.getState().componentSelectionIds).toEqual([]);
    // 锁定
    const locked = store.getState().addComponent('molecule');
    store.getState().updateParams(locked, {});
    store.getState().toggleLock(locked);
    store.getState().selectComponentIds([locked]);
    expect(store.getState().selectionId).toBeNull();
  });

  it('批量对齐：以末位主选为基准对齐 X；锁定成员跳过', () => {
    const store = createSceneStore();
    const a = store.getState().addComponent('molecule');
    const b = store.getState().addComponent('molecule');
    const locked = store.getState().addComponent('molecule');
    store.getState().setTransform(a, { ...T0(), position: [10, 1, 1] });
    store.getState().setTransform(b, { ...T0(), position: [20, 2, 2] });
    store.getState().setTransform(locked, { ...T0(), position: [30, 3, 3] });
    store.getState().toggleLock(locked);
    store.getState().selectComponentIds([a, b, locked]); // 主选 = locked？锁定不可入选 → 实际 [a,b]，主选 b
    store.getState().alignComponents(0);
    const cs = store.getState().components;
    expect(cs.find((c) => c.id === a)!.transform.position[0]).toBe(20); // 对齐主选 b 的 x
    expect(cs.find((c) => c.id === locked)!.transform.position[0]).toBe(30); // 锁定不动
  });

  it('批量等间距：3 个沿 X 排序（10,20,50）→ 中间成员移到 30（首尾不动）', () => {
    const store = createSceneStore();
    const a = store.getState().addComponent('molecule');
    const b = store.getState().addComponent('molecule');
    const c = store.getState().addComponent('molecule');
    store.getState().setTransform(a, { ...T0(), position: [10, 0, 0] });
    store.getState().setTransform(b, { ...T0(), position: [50, 0, 0] });
    store.getState().setTransform(c, { ...T0(), position: [20, 0, 0] });
    store.getState().selectComponentIds([a, b, c]);
    store.getState().distributeComponents(0);
    const xs = store.getState().components.map((x) => x.transform.position[0]).sort((p, q) => p - q);
    expect(xs).toEqual([10, 30, 50]);
  });

  it('批量参数：统一风格只作用适用类型（molecule 无 style 键自动跳过）', () => {
    const store = createSceneStore();
    const sheet = store.getState().addComponent('kaolinite_sheet');
    const mol = store.getState().addComponent('molecule');
    const sheet2 = store.getState().addComponent('kaolinite_sheet');
    store.getState().updateParams(sheet2, { style: '球棍' });
    store.getState().selectComponentIds([sheet, mol, sheet2]); // 主选 sheet2（球棍）
    store.getState().applyParamsToSelection({ style: '球棍' });
    const cs = store.getState().components;
    expect((cs.find((c) => c.id === sheet)!.params as { style: string }).style).toBe('球棍');
    expect(cs.find((c) => c.id === mol)!.params).not.toHaveProperty('style'); // molecule 未被污染
  });

  it('批量统一缩放 + 一条撤销', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const a = store.getState().addComponent('molecule');
    const b = store.getState().addComponent('molecule');
    store.getState().setTransform(a, { ...T0(), scale: 2 });
    store.getState().selectComponentIds([a, b]);
    store.getState().applyScaleToSelection(2);
    expect(store.getState().components.every((c) => c.transform.scale === 2)).toBe(true);
    const depth = history.depths().undo;
    history.undo();
    // molecule 出厂缩放为 4（defaultTransformFor）——一条撤销回退到 applyScale 前状态
    expect(store.getState().components.find((c) => c.id === b)!.transform.scale).toBe(4);
    expect(history.depths().undo).toBe(depth - 1);
  });
});
