/**
 * 组件锁定与分组验收测试 —— T-3.3
 *
 * 验收标准（TODO）：
 *  - 锁定组件点击不选中、gizmo 不吸附（store.select 屏蔽 + 选择不变 → 绑定层不会
 *    把锁定 id 交给渲染服务 setSelection）；
 *  - 成组后拖动/旋转整体一致（setTransform 组感知：位置/旋转取增量、缩放取比值）；
 *  - 解组恢复独立；
 *  - locked/group 字段随场景 JSON 往返保留；组操作可撤销重做。
 */
import { describe, expect, it } from 'vitest';
import { attachHistory } from './history';
import { createSceneStore, type SceneStore } from './sceneStore';

function buildTwo(store: SceneStore): [string, string] {
  const a = store.getState().addComponent('halloysite_tube', {
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  });
  const b = store.getState().addComponent('nanoparticle', {
    transform: { position: [10, 0, 0], rotation: [10, 0, 0], scale: 1 },
  });
  return [a, b];
}

describe('锁定（T-3.3 验收：点击不选中、gizmo 不吸附）', () => {
  it('select 对锁定组件 no-op；解锁后恢复可选', () => {
    const store = createSceneStore();
    const [a] = buildTwo(store);
    store.getState().toggleLock(a);
    store.getState().select(a);
    expect(store.getState().selectionId).toBeNull();      // 点击不选中
    store.getState().toggleLock(a);                        // 解锁
    store.getState().select(a);
    expect(store.getState().selectionId).toBe(a);
  });

  it('锁定当前选中组件 → 取消选中（gizmo 随之脱附）', () => {
    const store = createSceneStore();
    const [a] = buildTwo(store);
    store.getState().select(a);
    expect(store.getState().selectionId).toBe(a);
    store.getState().toggleLock(a);
    expect(store.getState().selectionId).toBeNull();
  });

  it('空点击（null）与未锁定选择不受影响；空白处取消选中照常', () => {
    const store = createSceneStore();
    const [a, b] = buildTwo(store);
    store.getState().select(a);
    store.getState().select(null);
    expect(store.getState().selectionId).toBeNull();
    store.getState().select(b);
    expect(store.getState().selectionId).toBe(b);
  });

  it('绑定层契约：锁定的 id 永远不会进入 selectionId（gizmo 不吸附的依据）', () => {
    const store = createSceneStore();
    const [a] = buildTwo(store);
    store.getState().toggleLock(a);
    // 模拟画布拾取到锁定组件的全部可能路径
    store.getState().select(a);
    store.getState().select(null);
    store.getState().select(a);
    expect(store.getState().selectionId).toBeNull();
  });
});

describe('分组（T-3.3 验收：成组整体变换、解组独立）', () => {
  it('groupComponents 赋同组 id；setTransform 增量同步到全组', () => {
    const store = createSceneStore();
    const [a, b] = buildTwo(store);
    const gid = store.getState().groupComponents([a, b]);
    expect(gid).toMatch(/^g\d+$/);
    expect(store.getState().components.every((c) => c.group === gid)).toBe(true);

    // 拖动 a：位置 +[5,0,0]、旋转 +[0,15,0]、缩放 ×2 → b 同步
    store.getState().setTransform(a, {
      position: [5, 0, 0], rotation: [0, 15, 0], scale: 2,
    });
    const [ca, cb] = store.getState().components;
    expect(cb.transform.position).toEqual([15, 0, 0]);      // 10+5
    expect(cb.transform.rotation).toEqual([10, 15, 0]);     // 10+0, 0+15
    expect(cb.transform.scale).toBeCloseTo(2, 10);          // 1×2
    expect(ca.transform.position).toEqual([5, 0, 0]);
  });

  it('缩放取比值保持组内比例（非 1 基准）', () => {
    const store = createSceneStore();
    const [a, b] = buildTwo(store);
    store.getState().groupComponents([a, b]);
    store.getState().setTransform(b, { position: [10, 0, 0], rotation: [10, 0, 0], scale: 1.5 });
    const [ca, cb] = store.getState().components;
    expect(ca.transform.scale).toBeCloseTo(1.5, 10);        // 1×1.5
    expect(cb.transform.scale).toBeCloseTo(1.5, 10);
    // b 自身位置不变（自身就是被设置者）
    expect(cb.transform.position).toEqual([10, 0, 0]);
    // a 位置获得 b 的增量（b 未动 → 0 偏移）
    expect(ca.transform.position).toEqual([0, 0, 0]);
  });

  it('未分组组件 setTransform 行为不变（回归）', () => {
    const store = createSceneStore();
    const [a] = buildTwo(store);
    store.getState().setTransform(a, { position: [5, 0, 0], rotation: [0, 0, 0], scale: 2 });
    const [ca, cb] = store.getState().components;
    expect(ca.transform.position).toEqual([5, 0, 0]);
    expect(cb.transform.position).toEqual([10, 0, 0]);      // 未受牵连
    expect(cb.transform.scale).toBe(1);
  });

  it('ungroupComponents 解组后恢复独立', () => {
    const store = createSceneStore();
    const [a, b] = buildTwo(store);
    store.getState().groupComponents([a, b]);
    store.getState().ungroupComponents([b]);
    expect(store.getState().components[0].group).toBeDefined();
    expect(store.getState().components[1].group).toBeUndefined();

    store.getState().setTransform(a, { position: [7, 0, 0], rotation: [0, 0, 0], scale: 1 });
    expect(store.getState().components[1].transform.position).toEqual([10, 0, 0]); // 不再牵连
  });

  it('locked / group 字段随场景 JSON 往返保留', () => {
    const store = createSceneStore();
    const [a, b] = buildTwo(store);
    store.getState().toggleLock(a);
    store.getState().groupComponents([a, b]);
    const doc = store.getState().toSceneDocument();
    store.getState().loadScene(JSON.parse(JSON.stringify(doc)));
    const comps = store.getState().components;
    expect(comps[0].locked).toBe(true);
    expect(comps[0].group).toBe(comps[1].group);
  });
});

describe('组操作可撤销/重做（与 T-2.1 历史栈集成）', () => {
  it('成组 → 撤销 → 解除；重做恢复组', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const [a, b] = buildTwo(store);
    store.getState().groupComponents([a, b]);
    expect(store.getState().components[0].group).toBe(store.getState().components[1].group);

    history.undo();
    expect(store.getState().components[0].group).toBeUndefined();

    history.redo();
    expect(store.getState().components[0].group).toBe(store.getState().components[1].group);
  });

  it('组内整体拖动 = 一条撤销步（setTransform 合并键不变）', () => {
    let t = 0;
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 500, now: () => t });
    const [a, b] = buildTwo(store);
    store.getState().groupComponents([a, b]);
    for (let x = 1; x <= 3; x++) {
      t += 100;
      store.getState().setTransform(a, { position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });
    }
    history.undo(); // 撤销合并的整段拖动 → b 也回到原点
    const cb = store.getState().components[1];
    expect(cb.transform.position).toEqual([10, 0, 0]);
  });
});
