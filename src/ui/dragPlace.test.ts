/**
 * 素材拖放三维画布 —— V2 P1 会话语义（dragPlace.ts）
 *
 * 放置 = 一次 addComponent（一条 Undo）+ 选中；取消路径全安全（画布外 / Esc /
 * pointercancel 会话清空）；异步几何仅构建一次（拖动不重复重建）；快速连续拖拽
 * 旧会话响应作废；尾随点击抑制标志单次消费。渲染层经 rendererRef 假件隔离。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildMolecule } from '../core/builders';
import { rendererRef } from '../state/rendererRef';
import { sceneStore, sceneHistory } from '../state/sceneStore';
import {
  beginSpecDrag,
  cancelAssetDrag,
  consumeDraggedFlag,
  finishAssetDrag,
  handleEscapeDuringDrag,
  updateAssetDrag,
} from './dragPlace';

const GEO = { atoms: buildMolecule('H₂O').atoms, bonds: [] as Array<[number, number]> };

/** 假渲染件：画布矩形 (0,0)-(800,600)；放置点可注入；几何 promise 按调用序排队放行 */
function fakeSvc(point: [number, number, number] | null) {
  const calls: string[] = [];
  const pending: Array<(g: unknown) => void> = [];
  return {
    calls,
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }) } },
    camera: { position: { toArray: () => [150, 110, 190], set: () => {} }, lookAt: () => {}, updateProjectionMatrix: () => {} },
    orbit: { target: { toArray: () => [0, 0, 0], set: () => {} }, update: () => {} },
    previewGeometry: vi.fn(() => new Promise<unknown>((res) => { pending.push(res); })),
    resolveGeoAt: (i: number, g: unknown) => pending[i]?.(g),
    setPlacementPreview: () => calls.push('set'),
    movePlacementPreview: () => calls.push('move'),
    hidePlacementPreview: () => calls.push('hide'),
    clearPlacementPreview: () => calls.push('clear'),
    pickPlacementPoint: () => point,
  };
}

const SPEC = { componentType: 'molecule' as const, params: { kind: 'H₂O' }, name: '水' };

beforeEach(() => {
  for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
  while (sceneHistory.undo()) { /* 回滚历史栈残留 */ }
  cancelAssetDrag();
  consumeDraggedFlag();
});

describe('放置（画布内松手）', () => {
  it('组件 +1、position = 拾取点、自动选中、预览清理、一条 Undo 可回退', async () => {
    rendererRef.current = fakeSvc([12, -4, 30]) as never;
    beginSpecDrag(SPEC);
    const svc = rendererRef.current as unknown as ReturnType<typeof fakeSvc>;
    svc.resolveGeoAt(0, GEO);
    await Promise.resolve(); // 微任务放行（几何落地）
    for (let i = 0; i < 50; i++) updateAssetDrag(400, 300); // 拖动全程
    const before = sceneStore.getState().components.length;
    const id = finishAssetDrag();
    expect(id).toBeTruthy();
    const comps = sceneStore.getState().components;
    expect(comps).toHaveLength(before + 1);
    const placed = comps.find((c) => c.id === id)!;
    expect(placed.transform.position).toEqual([12, -4, 30]);
    expect((placed.params as { kind?: string }).kind).toBe('H₂O');
    expect(sceneStore.getState().selectionId).toBe(id);
    expect(svc.calls).toContain('clear');
    // 拖动全程几何只构建一次（任务书 3.2 性能红线）
    expect(svc.previewGeometry).toHaveBeenCalledTimes(1);
    // 一条 Undo 回退放置
    expect(sceneHistory.undo()).toBe(true);
    expect(sceneStore.getState().components).toHaveLength(before);
    // 尾随点击抑制：放置后标志单次消费
    expect(consumeDraggedFlag()).toBe(true);
    expect(consumeDraggedFlag()).toBe(false);
  });
});

describe('取消路径（全部无场景变更）', () => {
  it('画布外松手：隐藏预览、不建组件', async () => {
    rendererRef.current = fakeSvc([1, 2, 3]) as never;
    beginSpecDrag(SPEC);
    const svc = rendererRef.current as unknown as ReturnType<typeof fakeSvc>;
    svc.resolveGeoAt(0, GEO);
    await Promise.resolve();
    updateAssetDrag(2000, 300); // 画布外
    expect(svc.calls).toContain('hide');
    const before = sceneStore.getState().components.length;
    expect(finishAssetDrag()).toBeNull();
    expect(sceneStore.getState().components).toHaveLength(before);
  });

  it('Esc 中断（App 键盘分发调用）：会话清空、事件被消费', () => {
    rendererRef.current = fakeSvc([1, 2, 3]) as never;
    beginSpecDrag(SPEC);
    expect(handleEscapeDuringDrag()).toBe(true);
    expect(finishAssetDrag()).toBeNull();
    // 非拖放会话时 Esc 不被本模块消费（交回通用分发）
    expect(handleEscapeDuringDrag()).toBe(false);
  });

  it('快速连续拖拽：旧会话的异步几何响应作废（不串预览）', async () => {
    rendererRef.current = fakeSvc([5, 5, 5]) as never;
    beginSpecDrag(SPEC);
    const svcA = rendererRef.current as unknown as ReturnType<typeof fakeSvc>;
    beginSpecDrag({ ...SPEC, params: { kind: 'C₇H₈' } }); // 立刻开新会话（第二次 previewGeometry 已入队）
    svcA.resolveGeoAt(0, GEO); // 旧会话（第 0 个 promise）响应迟到
    await Promise.resolve();
    expect(svcA.calls).not.toContain('set'); // 旧响应被 seq 守卫丢弃
  });

  it('几何构建失败（resolve null）：静默取消，放置点有效也不落地', async () => {
    rendererRef.current = fakeSvc([8, 8, 8]) as never;
    beginSpecDrag(SPEC);
    const svc = rendererRef.current as unknown as ReturnType<typeof fakeSvc>;
    svc.resolveGeoAt(0, null);
    await Promise.resolve();
    updateAssetDrag(400, 300);
    const before = sceneStore.getState().components.length;
    expect(finishAssetDrag()).toBeNull();
    expect(sceneStore.getState().components).toHaveLength(before);
  });
});
