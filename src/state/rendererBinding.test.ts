import { beforeEach, describe, expect, it } from 'vitest';
import type { Transform } from '../core/types';
import { bindRenderer, type RendererLike } from './rendererBinding';
import { createSceneStore } from './sceneStore';

/**
 * 绑定层测试：用可检视的测试替身替代 RendererService（不 import three），
 * 调度器注入手动 flush，验证「即时同步 + 参数重建 rAF 节流」两条路径。
 */

function makeFake() {
  const calls: Array<{ op: string; id?: string; value?: unknown }> = [];
  const fake: RendererLike = {
    addComponent: (c) => calls.push({ op: 'add', id: c.id }),
    rebuildComponent: (c) => calls.push({ op: 'rebuild', id: c.id }),
    removeComponent: (id) => calls.push({ op: 'remove', id }),
    setComponentVisible: (id, v) => calls.push({ op: 'visible', id, value: v }),
    setComponentTransform: (id, t: Transform) => calls.push({ op: 'transform', id, value: t }),
    setSelection: (id) => calls.push({ op: 'select', id: id ?? '(null)' }),
  };
  return { calls, fake };
}

let pendingFlush: (() => void) | null = null;
const manualSchedule = (cb: () => void): number => {
  pendingFlush = cb;
  return 1;
};

let store: ReturnType<typeof createSceneStore>;

beforeEach(() => {
  store = createSceneStore();
  pendingFlush = null;
});

describe('bindRenderer：初始全量 + 即时差异', () => {
  it('绑定时同步现有组件与选择', () => {
    const s = store.getState();
    s.addComponent('nanoparticle');
    const id = s.addComponent('molecule');
    s.select(id);

    const { calls, fake } = makeFake();
    bindRenderer(store, fake, { schedule: manualSchedule });
    expect(calls.filter((c) => c.op === 'add')).toHaveLength(2);
    expect(calls.filter((c) => c.op === 'select')[0]?.id).toBe(id);
  });

  it('新增/删除/显隐/变换即时同步；选择切换同步', () => {
    const { calls, fake } = makeFake();
    bindRenderer(store, fake, { schedule: manualSchedule });

    const id = store.getState().addComponent('kaolinite_sheet');
    expect(calls.at(-1)).toMatchObject({ op: 'add', id });

    store.getState().setVisibility(id, false);
    expect(calls.at(-1)).toMatchObject({ op: 'visible', id, value: false });

    store.getState().setTransform(id, { position: [1, 2, 3], rotation: [0, 0, 0], scale: 1 });
    expect(calls.at(-1)).toMatchObject({ op: 'transform', id, value: { position: [1, 2, 3] } });

    store.getState().select(id);
    expect(calls.at(-1)).toMatchObject({ op: 'select', id });

    store.getState().removeComponent(id);
    // 删除的是选中组件 → store 自动清选择，绑定按序同步 remove + select(null)
    expect(calls.at(-2)).toMatchObject({ op: 'remove', id });
    expect(calls.at(-1)).toMatchObject({ op: 'select', id: '(null)' });
    // 已是 null 再 select(null) → 无状态变化，不产生新调用
    store.getState().select(null);
    expect(calls.at(-1)).toMatchObject({ op: 'select', id: '(null)' });
  });
});

describe('参数重建节流（T-1.5 验收核心）', () => {
  it('同帧多次参数更新只触发一次 rebuild（rAF 合并）', () => {
    const { calls, fake } = makeFake();
    bindRenderer(store, fake, { schedule: manualSchedule });
    const id = store.getState().components[0]?.id ?? store.getState().addComponent('nanoparticle');
    calls.length = 0;

    store.getState().updateParams(id, { radius: 5 });
    store.getState().updateParams(id, { radius: 6 });
    store.getState().updateParams(id, { grains: 200 });
    expect(pendingFlush).not.toBeNull();
    expect(calls.filter((c) => c.op === 'rebuild')).toHaveLength(0); // 尚未 flush

    pendingFlush?.();
    const rebuilds = calls.filter((c) => c.op === 'rebuild');
    expect(rebuilds).toHaveLength(1);
    expect(rebuilds[0]?.id).toBe(id);

    // flush 后再改 → 重新排队
    store.getState().updateParams(id, { radius: 7 });
    expect(pendingFlush).not.toBeNull();
    pendingFlush?.();
    expect(calls.filter((c) => c.op === 'rebuild')).toHaveLength(2);
  });

  it('重建排队期间删除组件 → flush 跳过已删 id', () => {
    const { calls, fake } = makeFake();
    bindRenderer(store, fake, { schedule: manualSchedule });
    const id = store.getState().components[0]?.id ?? store.getState().addComponent('nanoparticle');
    calls.length = 0;

    store.getState().updateParams(id, { radius: 5 });
    store.getState().removeComponent(id);
    pendingFlush?.();
    expect(calls.filter((c) => c.op === 'rebuild')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'remove')).toHaveLength(1);
  });

  it('取消订阅后不再同步', () => {
    const { calls, fake } = makeFake();
    const unsub = bindRenderer(store, fake, { schedule: manualSchedule });
    unsub();
    calls.length = 0;
    store.getState().addComponent('molecule');
    expect(calls).toHaveLength(0);
  });
});
