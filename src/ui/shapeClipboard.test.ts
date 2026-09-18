/**
 * 2D 图元 Copy/Paste 验收 —— 2026-09-17（扩展既有双槽剪贴板）
 *
 * 覆盖任务书四十九~五十五：五类图元复制 ID 不同、连续粘贴逐次错开、
 * 重新 Copy 重置计数、副本深独立（改副本原不变）、粘贴后自动选中、
 * 逐次 Undo、锚定副本成自由图元、图元选中时 Cmd+C/D 真正触发
 * （needsSelection 修复回归）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearShortcutClipboard, handleShortcut, type ShortcutHost } from './shortcuts';
import { attachHistory } from '../state/history';
import { createSceneStore } from '../state/sceneStore';
import type { SceneShape } from '../core/shapes/schema';

const mkHost = (store: ReturnType<typeof createSceneStore>): ShortcutHost => ({
  getState: store.getState,
  history: { undo: () => false, redo: () => false },
  toggleCheatSheet: () => {},
});

/** 模拟 Cmd/Ctrl+键 */
const press = (host: ShortcutHost, key: string): boolean =>
  handleShortcut(
    { key, ctrlKey: true, metaKey: false, shiftKey: false, preventDefault: () => {} } as unknown as KeyboardEvent,
    host,
  );

const addRect = (store: ReturnType<typeof createSceneStore>, x = 100, y = 80): string =>
  store.getState().addShape({ type: 'rect', x, y, w: 60, h: 40, stroke: '#b45309' } as never);

beforeEach(() => {
  clearShortcutClipboard();
});

describe('图元复制粘贴（五类图元）', () => {
  it.each(['rect', 'ellipse', 'arrow', 'line', 'text'] as const)('%s：Copy/Paste → 新 ID + 属性保持', (type) => {
    const store = createSceneStore();
    const host = mkHost(store);
    const partial: Record<string, unknown> = { type, x: 100, y: 80, w: 60, h: 40 };
    if (type === 'text') partial.text = '吸附';
    if (type === 'arrow') { partial.headSize = 14; partial.bow = 0; }
    const origId = store.getState().addShape(partial as never);
    store.getState().selectShape(origId);

    expect(press(host, 'c')).toBe(true); // 图元选中（无组件选中）Cmd+C 真正触发（核心回归）
    expect(press(host, 'v')).toBe(true);
    const shapes = store.getState().shapes;
    expect(shapes).toHaveLength(2);
    const copy = shapes.find((s) => s.id !== origId)!;
    expect(copy.id).not.toBe(origId);
    expect(copy.type).toBe(type);
    expect(copy.stroke).toBe(shapes.find((s) => s.id === origId)!.stroke); // 样式保持
    if (type === 'text') expect((copy as { text: string }).text).toBe('吸附');
    // 粘贴后自动选中副本
    expect(store.getState().shapeSelectionIds).toEqual([copy.id]);
    // 副本位置有可见偏移（+12）
    expect(copy.x).toBe(112);
    expect(copy.y).toBe(92);
  });

  it('文本副本深独立：改副本文字，原文字不变', () => {
    const store = createSceneStore();
    const host = mkHost(store);
    const origId = store.getState().addShape({ type: 'text', x: 0, y: 0, w: 50, h: 24, text: 'A' } as never);
    store.getState().selectShape(origId);
    press(host, 'c');
    press(host, 'v');
    const copy = store.getState().shapes.find((s) => s.id !== origId)!;
    store.getState().updateShape(copy.id, { text: 'B' } as Partial<SceneShape>);
    expect((store.getState().shapes.find((s) => s.id === origId)! as { text: string }).text).toBe('A');
    expect((store.getState().shapes.find((s) => s.id === copy.id)! as { text: string }).text).toBe('B');
  });

  it('矩形填充深独立：改副本样式，原样式不变', () => {
    const store = createSceneStore();
    const host = mkHost(store);
    const origId = store.getState().addShape({ type: 'rect', x: 0, y: 0, w: 30, h: 20, fill: '#ff0000' } as never);
    store.getState().selectShape(origId);
    press(host, 'c');
    press(host, 'v');
    const copy = store.getState().shapes.find((s) => s.id !== origId)!;
    store.getState().updateShape(copy.id, { fill: '#0000ff' } as Partial<SceneShape>);
    expect(store.getState().shapes.find((s) => s.id === origId)!.fill).toBe('#ff0000');
  });
});

describe('连续粘贴与计数重置', () => {
  it('Paste ×3：数量 +3、ID 全不同、位置逐次错开 (+12/+24/+36)', () => {
    const store = createSceneStore();
    const host = mkHost(store);
    const origId = addRect(store);
    store.getState().selectShape(origId);
    press(host, 'c');
    press(host, 'v');
    press(host, 'v');
    press(host, 'v');
    const shapes = store.getState().shapes;
    expect(shapes).toHaveLength(4); // 原始 + 3 副本
    const ids = new Set(shapes.map((s) => s.id));
    expect(ids.size).toBe(4);
    const xs = shapes.filter((s) => s.id !== origId).map((s) => s.x).sort((a, b) => a - b);
    expect(xs).toEqual([112, 124, 136]); // 逐次错开，不叠在同一位置
  });

  it('重新 Copy 重置计数：Copy A 粘 3 次 → Copy B 首次粘贴回到 +12', () => {
    const store = createSceneStore();
    const host = mkHost(store);
    const a = addRect(store, 0, 0);
    const b = store.getState().addShape({ type: 'text', x: 300, y: 10, w: 40, h: 20, text: 'B' } as never);
    store.getState().selectShape(a);
    press(host, 'c');
    press(host, 'v');
    press(host, 'v');
    press(host, 'v');
    store.getState().selectShape(b);
    press(host, 'c');
    press(host, 'v');
    const pastedB = store.getState().shapes.filter((s) => s.type === 'text').find((s) => s.id !== b)!;
    expect(pastedB.x).toBe(312); // 从第一档开始，不继承 A 的计数
  });
});

describe('锚定副本（外部绑定清除）', () => {
  it('锚定 3D 组件的箭头：副本无 anchors，可独立移动不吸回', () => {
    const store = createSceneStore();
    const host = mkHost(store);
    const compId = store.getState().addComponent('nanoparticle');
    const arrowId = store.getState().addShape({
      type: 'arrow', x: 0, y: 0, w: 60, h: 0,
      anchors: { start: { kind: 'component', id: compId }, end: { kind: 'free' } },
    } as never);
    store.getState().selectShape(arrowId);
    press(host, 'c');
    press(host, 'v');
    const copy = store.getState().shapes.find((s) => s.type === 'arrow' && s.id !== arrowId)! as { anchors?: { start: { kind: string } } };
    expect(copy.anchors?.start.kind ?? 'free').toBe('free'); // 外部锚定已清 → 自由图元（schema 补 free 默认）
    // 原箭头锚定保留
    const orig = store.getState().shapes.find((s) => s.id === arrowId)! as { anchors: { start: { kind: string } } };
    expect(orig.anchors.start.kind).toBe('component');
  });
});

describe('History 与多选粘贴', () => {
  it('Paste ×3 → Undo ×2 → 数量逐次减少；Copy 不产生历史', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const host = mkHost(store);
    const origId = addRect(store);
    store.getState().selectShape(origId);
    const before = history.depths().undo;
    press(host, 'c'); // Copy 不改场景不入历史
    expect(history.depths().undo).toBe(before);
    press(host, 'v');
    press(host, 'v');
    press(host, 'v');
    expect(store.getState().shapes).toHaveLength(4);
    history.undo();
    expect(store.getState().shapes).toHaveLength(3);
    history.undo();
    expect(store.getState().shapes).toHaveLength(2);
  });

  it('多选整体粘贴：三个图元一起 Copy，Paste 保持相对距离且各得新 ID', () => {
    const store = createSceneStore();
    const host = mkHost(store);
    const r = addRect(store, 0, 0);
    const t = store.getState().addShape({ type: 'text', x: 100, y: 0, w: 40, h: 20, text: 'x' } as never);
    const l = store.getState().addShape({ type: 'line', x: 200, y: 0, w: 30, h: 0 } as never);
    store.getState().selectShapes([r, t, l]);
    press(host, 'c');
    press(host, 'v');
    const shapes = store.getState().shapes;
    expect(shapes).toHaveLength(6);
    const newIds = store.getState().shapeSelectionIds;
    expect(newIds).toHaveLength(3);
    for (const id of newIds) expect([r, t, l]).not.toContain(id);
    // 相对距离保持：副本整体 +12 平移
    const copyRect = shapes.find((s) => s.id === newIds[0] && s.type === 'rect')!;
    const copyText = shapes.find((s) => s.type === 'text' && [r, t, l].every((o) => s.id !== o))!;
    expect(copyText.x - copyRect.x).toBe(100);
  });
});
