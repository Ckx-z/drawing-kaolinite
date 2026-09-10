/**
 * 撤销/重做历史栈单测 —— T-2.1
 *
 * 核心验收（TODO）：连续任意操作后撤销到底再重做到顶，场景状态与操作前逐字段一致
 * （快照对比测试）。另覆盖：合并窗口、栈深上限、重做分支失效、失败操作不入栈。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { attachHistory, type History } from './history';
import { createSceneStore, sceneStore, sceneHistory, type SceneStore } from './sceneStore';

/** 全量快照对比（逐字段：components + selectionId，JSON 序列化对比） */
const snap = (store: SceneStore): string => {
  const s = store.getState();
  return JSON.stringify({ components: s.components, selectionId: s.selectionId });
};

describe('核心验收：任意操作序列 → 撤销到底 → 重做到顶，逐字段一致', () => {
  let store: SceneStore;
  let history: History;

  beforeEach(() => {
    store = createSceneStore();
    history = attachHistory(store, { mergeWindowMs: 0 }); // 关闭合并，每步独立
  });

  it('混合操作序列（加/删/参数/变换/显隐/锁定/重命名）全程可逆', () => {
    const initial = snap(store);

    // —— 正向：连续任意操作 ——
    const a = store.getState().addComponent('halloysite_tube');
    const b = store.getState().addComponent('kaolinite_sheet');
    store.getState().addComponent('nanoparticle');
    store.getState().updateParams(a, { innerR: 20, walls: 2, d001: 10 });
    store.getState().setTransform(b, { position: [10, -6, 0], rotation: [0, 15, 90], scale: 1.5 });
    store.getState().setVisibility(b, false);
    store.getState().toggleLock(a);
    store.getState().renameComponent(b, ' renamed 片层 ');
    store.getState().removeComponent(store.getState().components[2].id);
    const final = snap(store);

    // —— 撤销到底 ——
    while (history.undo());
    expect(snap(store)).toBe(initial);          // 与操作前逐字段一致
    expect(history.canUndo()).toBe(false);

    // —— 重做到顶 ——
    while (history.redo());
    expect(snap(store)).toBe(final);            // 与全部操作后逐字段一致
    expect(history.canRedo()).toBe(false);
  });

  it('载入场景与清空也可撤销；undo 恢复 selection', () => {
    const doc = {
      format: 'kaolin-scene/v1',
      saved: '2026-09-06T00:00:00.000Z',
      components: [
        {
          name: '载入片层', type: 'kaolinite_sheet',
          params: { Lx: 60, Ly: 50, layers: 2, d001: 8, shape: '六角', style: '球棍', edgeH: true },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
          visible: true,
        },
      ],
    };
    const before = store.getState().addComponent('molecule');
    store.getState().select(before);
    const withSelection = snap(store);

    store.getState().loadScene(doc);
    expect(store.getState().components).toHaveLength(1);
    store.getState().clear();
    expect(store.getState().components).toHaveLength(0);

    expect(history.undo()).toBe(true);          // 撤销 clear → 恢复载入内容
    expect(store.getState().components).toHaveLength(1);
    expect(history.undo()).toBe(true);          // 撤销 loadScene → 恢复分子 + 选中
    expect(snap(store)).toBe(withSelection);
    expect(store.getState().selectionId).toBe(before);
  });

  it('添加→删除→撤销：组件恢复且 id 不变；重做再删', () => {
    const id = store.getState().addComponent('nanoparticle', { params: { seed: 42 } });
    store.getState().removeComponent(id);
    expect(store.getState().components).toHaveLength(0);

    history.undo();
    const restored = store.getState().components[0];
    expect(restored.id).toBe(id);               // 快照回放保持 id 稳定
    expect((restored.params as { seed: number }).seed).toBe(42);

    history.redo();
    expect(store.getState().components).toHaveLength(0);
  });

  it('失败操作不入栈：非法参数抛错且不产生撤销步', () => {
    const id = store.getState().addComponent('molecule');
    const d0 = history.depths();                       // 含 addComponent 那 1 条
    expect(() => store.getState().updateParams(id, { Lx: 1 } as never)).toThrow(); // 类型不符
    expect(() => store.getState().updateParams('不存在', { kind: 'O₂' })).not.toThrow(); // 目标缺失静默
    expect(() =>
      store.getState().setTransform(id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 0.001 }),
    ).toThrow();                                       // 越界抛错
    expect(history.depths()).toEqual(d0);
  });

  it('新操作使重做分支失效', () => {
    store.getState().addComponent('molecule');
    store.getState().addComponent('molecule');
    history.undo();
    expect(history.canRedo()).toBe(true);
    store.getState().addComponent('nanoparticle');   // 分叉
    expect(history.canRedo()).toBe(false);
  });
});

describe('合并窗口（滑块拖动 = 一次 Ctrl+Z）', () => {
  it('同组件连续 updateParams 合并为一条；窗口过期或换组件则分步', () => {
    let t = 1000;
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 800, now: () => t });
    const a = store.getState().addComponent('halloysite_tube');
    const b = store.getState().addComponent('halloysite_tube');

    store.getState().updateParams(a, { innerR: 15 });
    t += 300;
    store.getState().updateParams(a, { innerR: 18 });
    t += 300;
    store.getState().updateParams(a, { walls: 3 });
    expect(history.depths().undo).toBe(3);      // 2×add + 800ms 窗口内合并成 1 条

    t += 5000;                                  // 窗口过期
    store.getState().updateParams(a, { innerR: 25 });
    expect(history.depths().undo).toBe(4);

    store.getState().updateParams(b, { innerR: 30 }); // 换组件 → 新命令
    expect(history.depths().undo).toBe(5);

    history.undo();                              // 撤销 b 的修改
    expect((store.getState().components[1].params as { innerR: number }).innerR).toBe(14);
    history.undo();                              // 撤销 a 的过期段
    expect((store.getState().components[0].params as { innerR: number }).innerR).toBe(18);
    history.undo();                              // 撤销合并段 → 回到 addComponent 后默认值
    expect((store.getState().components[0].params as { innerR: number }).innerR).toBe(14);
  });

  it('setTransform 拖拽同样合并', () => {
    let t = 0;
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 500, now: () => t });
    const id = store.getState().addComponent('molecule');
    for (let x = 1; x <= 5; x++) {
      t += 50;
      store.getState().setTransform(id, { position: [x, 0, 0], rotation: [0, 0, 0], scale: 4 });
    }
    expect(history.depths().undo).toBe(2);      // 1×add + 拖拽合并成 1 条
    history.undo();
    expect(store.getState().components[0].transform.position).toEqual([0, 0, 0]);
  });
});

describe('栈深上限可配', () => {
  it('limit=3 时只保留最近 3 条，可撤销 3 步', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { limit: 3, mergeWindowMs: 0 });
    for (let i = 0; i < 5; i++) store.getState().addComponent('molecule');
    expect(history.depths().undo).toBe(3);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);         // 最旧 2 条已丢弃
    expect(store.getState().components).toHaveLength(2);
  });
});

describe('应用单例：写操作自动入历史', () => {
  it('sceneStore + sceneHistory 就位；clearHistory 可清', () => {
    sceneHistory.clearHistory();
    const n0 = sceneStore.getState().components.length;
    const id = sceneStore.getState().addComponent('nanoparticle');
    expect(sceneHistory.canUndo()).toBe(true);
    sceneHistory.undo();
    expect(sceneStore.getState().components).toHaveLength(n0);
    expect(sceneStore.getState().components.some((c) => c.id === id)).toBe(false);
  });

  it('撤销触发订阅通知（rendererBinding 依赖此行为同步渲染）', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.components.length));

    const id = store.getState().addComponent('molecule');
    store.getState().removeComponent(id);
    expect(seen).toEqual([1, 0]);

    history.undo();
    expect(seen).toEqual([1, 0, 1]);            // undo 也是一次普通 setState → 通知订阅者
    expect(store.getState().components).toHaveLength(1);
  });
});

describe('历史栈变化通知（2026-09-10：顶栏后退/前进按钮禁用态）', () => {
  it('入栈/撤销/重做/清空各触发一次；退订后不再触发', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    let n = 0;
    const unsub = history.subscribe(() => {
      n++;
    });

    store.getState().addComponent('molecule'); // 入栈 → 1
    expect(n).toBe(1);
    history.undo(); // → 2
    expect(n).toBe(2);
    history.redo(); // → 3
    expect(n).toBe(3);
    history.clearHistory(); // → 4
    expect(n).toBe(4);
    expect(history.canUndo()).toBe(false);

    unsub();
    store.getState().addComponent('molecule'); // 退订后不再通知
    expect(n).toBe(4);
  });

  it('状态未变的写操作（目标不存在）不入栈也不通知', () => {
    const store = createSceneStore();
    const history = attachHistory(store);
    let n = 0;
    history.subscribe(() => {
      n++;
    });
    store.getState().removeComponent('no-such-id'); // 静默 no-op
    expect(n).toBe(0);
  });
});
