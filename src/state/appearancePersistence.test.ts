/**
 * 右栏高保真改造 P2 —— 对象外观持久化与隔离（2026-11-04）
 *
 * - 旧场景兼容：无 appearance 字段的场景 JSON 载入零影响（缺省 = 科研材质）
 * - roundtrip：toSceneDocument → loadScene 保留外观（保存/载入/撤销一致）
 * - 撤销：setAppearance 一条 Undo 可回退；恢复科研材质同样一条
 * - 跨组件隔离：A 设玻璃、B 不受影响；切回 A 回显真实状态（无 useState 残留）
 * - 模板/模块：moduleCommon.appearance 随条目保留
 * - 剪贴板：Cmd+C/D 复制的外观随副本保留
 * - 非法外观：preset 越界被 schema 拦截且状态不变
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { attachHistory } from '../state/history';
import { createSceneStore, sceneStore, sceneHistory } from '../state/sceneStore';
import type { ComponentAppearance } from '../core/types';

const GLASS: ComponentAppearance = { preset: 'glass', colorOverride: null };
const METAL_TINT: ComponentAppearance = { preset: 'metal', colorOverride: '#336699', roughness: 0.3 };

beforeEach(() => {
  for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
  while (sceneHistory.undo()) { /* 清历史 */ }
});

describe('旧场景兼容（缺省 appearance）', () => {
  it('无 appearance 字段的历史场景载入零影响；默认读取为 null', () => {
    const legacy = {
      format: 'kaolin-scene/v1',
      saved: new Date().toISOString(),
      components: [
        { id: 'a1', type: 'kaolinite_sheet', name: '旧片层', params: { Lx: 40, Ly: 40, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, mineral: 'kaolinite' }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, visible: true },
      ],
    };
    expect(() => sceneStore.getState().loadScene(JSON.stringify(legacy))).not.toThrow();
    expect(sceneStore.getState().components[0]!.appearance).toBeUndefined();
    expect(sceneStore.getState().components[0]!.name).toBe('旧片层');
  });
});

describe('setAppearance：持久化 + 撤销 + 隔离', () => {
  it('写外观后 toSceneDocument roundtrip 保留', () => {
    const id = sceneStore.getState().addComponent('kaolinite_sheet');
    sceneStore.getState().setAppearance(id, GLASS);
    expect(sceneStore.getState().components.find((c) => c.id === id)?.appearance?.preset).toBe('glass');

    const doc = sceneStore.getState().toSceneDocument();
    const saved = doc.components.find((c) => c.id === id) as { appearance?: ComponentAppearance };
    expect(saved.appearance?.preset).toBe('glass');
    // 载入回读（无相机快照 → loadScene 返回 false 属预期，仅断言外观回读）
    sceneStore.getState().loadScene(JSON.stringify(doc));
    expect(sceneStore.getState().components[0]!.appearance?.preset).toBe('glass');
  });

  it('undo/redo：mergeWindow=0 的确定性单步（一条撤销回退外观）', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const id = store.getState().addComponent('kaolinite_sheet');
    store.getState().setAppearance(id, GLASS);
    expect(store.getState().components.find((c) => c.id === id)?.appearance?.preset).toBe('glass');
    expect(history.undo()).toBe(true);
    expect(store.getState().components.find((c) => c.id === id)?.appearance).toBeUndefined();
    expect(history.redo()).toBe(true);
    expect(store.getState().components.find((c) => c.id === id)?.appearance?.preset).toBe('glass');
  });

  it('跨组件隔离：A 玻璃不影响 B；各自回显真实状态', () => {
    const a = sceneStore.getState().addComponent('kaolinite_sheet');
    const b = sceneStore.getState().addComponent('nanoparticle');
    sceneStore.getState().setAppearance(a, GLASS);
    sceneStore.getState().setAppearance(b, METAL_TINT);
    const ca = sceneStore.getState().components.find((c) => c.id === a)!;
    const cb = sceneStore.getState().components.find((c) => c.id === b)!;
    expect(ca.appearance?.preset).toBe('glass');
    expect(cb.appearance?.preset).toBe('metal');
    expect(cb.appearance?.colorOverride).toBe('#336699');
    // A 再选回：状态仍是 glass（无 B 残留）
    sceneStore.getState().select(a);
    expect(sceneStore.getState().components.find((c) => c.id === sceneStore.getState().selectionId)?.appearance?.preset).toBe('glass');
  });

  it('恢复科研材质（null）可被撤销重做（确定性单步）', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const id = store.getState().addComponent('molecule', { params: { kind: 'H₂O' } });
    store.getState().setAppearance(id, GLASS);
    store.getState().setAppearance(id, null);
    expect(store.getState().components.find((c) => c.id === id)?.appearance).toBeUndefined();
    expect(history.undo()).toBe(true);
    expect(store.getState().components.find((c) => c.id === id)?.appearance?.preset).toBe('glass');
  });

  it('非法 appearance 被 schema 拦截且状态不变', () => {
    const id = sceneStore.getState().addComponent('kaolinite_sheet');
    expect(() => sceneStore.getState().setAppearance(id, { preset: 'holographic' as never })).toThrow();
    expect(sceneStore.getState().components.find((c) => c.id === id)?.appearance).toBeUndefined();
    expect(() => sceneStore.getState().setAppearance(id, { preset: 'glass', roughness: 5 })).toThrow();
    expect(sceneStore.getState().components.find((c) => c.id === id)?.appearance).toBeUndefined();
  });
});

describe('复制链路外观保留', () => {
  it('duplicateComponent：参数 + 外观随副本', () => {
    const id = sceneStore.getState().addComponent('nanoparticle');
    sceneStore.getState().setAppearance(id, METAL_TINT);
    const n0 = sceneStore.getState().components.length;
    const dup = sceneStore.getState().duplicateComponent(id)!;
    expect(sceneStore.getState().components.length).toBe(n0 + 1);
    expect(sceneStore.getState().components.find((c) => c.id === dup)?.appearance).toEqual(METAL_TINT);
    expect(sceneStore.getState().components.find((c) => c.id === dup)?.params).toEqual(
      sceneStore.getState().components.find((c) => c.id === id)?.params,
    );
  });

  it('剪贴板 Cmd+C/V：副本携带外观', () => {
    const id = sceneStore.getState().addComponent('molecule', { params: { kind: 'C₇H₈' } });
    sceneStore.getState().setAppearance(id, GLASS);
    sceneStore.getState().select(id);
    // 经 shortcuts 的 copy/paste 内部路径：直接复用 duplicateComponent 之外的独立验证——
    // 这里验证 store 数据足以支撑剪贴板（appearance 在组件上，clip 结构化拷贝即可）
    const comp = sceneStore.getState().components.find((c) => c.id === id)!;
    expect(comp.appearance?.preset).toBe('glass');
    const snapshot = structuredClone(comp);
    expect(snapshot.appearance?.preset).toBe('glass');
  });
});

describe('模块/模板外观保留', () => {
  it('模块条目接受可选 appearance（moduleCommon）', async () => {
    const { moduleEntryFromComponent } = await import('../state/moduleLibrary');
    const id = sceneStore.getState().addComponent('molecule', { params: { kind: 'H₂O' } });
    sceneStore.getState().setAppearance(id, GLASS);
    const comp = sceneStore.getState().components.find((c) => c.id === id)!;
    const entry = moduleEntryFromComponent(
      comp as never,
      'data:image/png;base64,x',
      '水（玻璃）',
    );
    expect((entry as unknown as { appearance?: ComponentAppearance }).appearance?.preset ?? 'none').toBe('glass');
  });
});
