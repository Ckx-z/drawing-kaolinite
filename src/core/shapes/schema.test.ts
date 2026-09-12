/**
 * 机理图图元层验收测试 —— T-11.1
 *
 * 覆盖：五种图元 schema 往返与默认值、非法样式拒绝、锚定三态、
 * 场景文档集成（旧文档兼容）、store 写操作（校验/级联退化/Z 序）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sceneDocumentSchema, SCENE_FORMAT } from '../schema';
import { anchorSchema, shapeSchema, type ArrowShape, type TextShape } from './schema';
import { createSceneStore } from '../../state/sceneStore';
import { attachHistory } from '../../state/history';
import { nearestEdgePoint, normBox, resolveEndpoint } from '../../ui/shapes/draw';

const CIF = readFileSync(new URL('../../../data/kaolinite.cif', import.meta.url), 'utf8');

describe('图元 schema（T-11.1）', () => {
  it('五种图元默认值填充与往返', () => {
    const rect = shapeSchema.parse({ type: 'rect', id: 's1', x: 10, y: 20, w: 160, h: 90 });
    expect(rect.type).toBe('rect');
    expect(rect.stroke).toBe('#2b2f33');
    expect(rect.fill).toBe('none');
    expect(rect.visible).toBe(true);
    expect(rect.locked).toBe(false);

    const text = shapeSchema.parse({ type: 'text', id: 's2', x: 0, y: 0, w: 100, h: 24, text: '插层反应' }) as TextShape;
    expect(text.fontSize).toBe(14);
    expect(text.outline).toBe(true);

    const arrow = shapeSchema.parse({ type: 'arrow', id: 's3', x: 0, y: 0, w: 100, h: 0 }) as ArrowShape;
    expect(arrow.anchors.start.kind).toBe('free'); // 锚定默认 free
    expect(arrow.headSize).toBe(10);

    expect(shapeSchema.parse({ type: 'ellipse', id: 's4', x: 0, y: 0, w: 50, h: 50 }).type).toBe('ellipse');
    expect(shapeSchema.parse({ type: 'line', id: 's5', x: 0, y: 0, w: 50, h: 50 }).type).toBe('line');
  });

  it('负宽高合法（拖拽方向任意）、旋转/线宽/虚线往返', () => {
    const s = shapeSchema.parse({ type: 'rect', id: 's1', x: 100, y: 100, w: -60, h: -40, rotation: 15, dash: 'dashed', lineWidth: 3 });
    expect(s.w).toBe(-60);
    expect(s.rotation).toBe(15);
    expect(s.dash).toBe('dashed');
  });

  it('非法样式拒绝：未知类型 / 非法色 / 线宽越界 / 空文本', () => {
    expect(() => shapeSchema.parse({ type: 'star', id: 's1', x: 0, y: 0, w: 1, h: 1 })).toThrow();
    expect(() => shapeSchema.parse({ type: 'rect', id: 's1', x: 0, y: 0, w: 1, h: 1, stroke: 'red' })).toThrow();
    expect(() => shapeSchema.parse({ type: 'rect', id: 's1', x: 0, y: 0, w: 1, h: 1, lineWidth: 99 })).toThrow();
    expect(() => shapeSchema.parse({ type: 'text', id: 's1', x: 0, y: 0, w: 1, h: 1, text: '' })).toThrow();
  });

  it('锚定三态：free/shape（含 side）/component 合法；shape 缺 id 拒绝', () => {
    expect(anchorSchema.parse({ kind: 'free' }).kind).toBe('free');
    const a = anchorSchema.parse({ kind: 'shape', id: 's2', side: 'left' });
    expect(a.kind === 'shape' && a.side).toBe('left');
    expect(anchorSchema.parse({ kind: 'component', id: 'c1' }).kind).toBe('component');
    expect(() => anchorSchema.parse({ kind: 'shape' })).toThrow();
  });

  it('场景文档：旧文档无 shapes 合法；含 shapes 往返', () => {
    const legacy = {
      format: SCENE_FORMAT,
      saved: new Date().toISOString(),
      components: [],
    };
    expect(() => sceneDocumentSchema.parse(legacy)).not.toThrow();

    const doc = sceneDocumentSchema.parse({
      ...legacy,
      shapes: [
        { type: 'rect', id: 's1', x: 10, y: 10, w: 100, h: 60 },
        { type: 'arrow', id: 's2', x: 0, y: 0, w: 80, h: 40, anchors: { start: { kind: 'component', id: 'c1' }, end: { kind: 'free' } } },
      ],
    });
    expect(doc.shapes).toHaveLength(2);
    expect((doc.shapes?.[1] as ArrowShape | undefined)?.anchors.start.kind).toBe('component');
  });
});

describe('store 图元写操作（T-11.1）', () => {
  it('addShape：默认样式 + 校验 + 返回稳定 id；updateShape 非法拒绝且状态不变', () => {
    const store = createSceneStore();
    const id = store.getState().addShape({ type: 'rect', x: 10, y: 10 });
    expect(id).toMatch(/^s\d+$/);
    expect(store.getState().shapes).toHaveLength(1);
    expect(store.getState().shapes[0]!.w).toBe(160); // 默认尺寸

    store.getState().updateShape(id, { stroke: '#ff0000' });
    expect(store.getState().shapes[0]!.stroke).toBe('#ff0000');
    expect(() => store.getState().updateShape(id, { lineWidth: 99 })).toThrow();
    expect(store.getState().shapes[0]!.lineWidth).toBe(2); // 状态不变
  });

  it('removeShape 级联：锚定该图元的箭头端点退化为 free', () => {
    const store = createSceneStore();
    const box = store.getState().addShape({ type: 'rect', x: 0, y: 0 });
    const arrow = store.getState().addShape({ type: 'arrow', x: 0, y: 0, w: 50, h: 0 });
    store.getState().updateShape(arrow, { anchors: { start: { kind: 'shape', id: box }, end: { kind: 'free' } } });
    store.getState().removeShape(box);
    const a = store.getState().shapes[0] as ArrowShape;
    expect(a.type).toBe('arrow');
    expect(a.anchors.start.kind).toBe('free');
  });

  it('图元/组件选中互斥；锁定图元不可选；Z 序调整', () => {
    const store = createSceneStore();
    const cid = store.getState().addComponent('nanoparticle');
    store.getState().select(cid);
    const s1 = store.getState().addShape({ type: 'rect', x: 0, y: 0 });
    const s2 = store.getState().addShape({ type: 'ellipse', x: 0, y: 0 });

    store.getState().selectShape(s2);
    expect(store.getState().shapeSelectionIds).toEqual([s2]);
    expect(store.getState().selectionId).toBeNull(); // 互斥

    store.getState().toggleShapeSelection(s1); // Ctrl+点击累加多选
    expect(store.getState().shapeSelectionIds).toEqual([s2, s1]);

    store.getState().updateShape(s2, { locked: true });
    store.getState().selectShape(null);
    store.getState().selectShape(s2); // 锁定不可选
    expect(store.getState().shapeSelectionIds).toEqual([]);

    store.getState().moveShapeOrder(s1, 'front'); // s1 置顶
    expect(store.getState().shapes[1]!.id).toBe(s1);
    store.getState().moveShapeOrder(s1, 'backward');
    expect(store.getState().shapes[0]!.id).toBe(s1);
  });

  it('场景往返：shapes 保存与载入（含组件锚定）', () => {
    const store = createSceneStore();
    store.getState().addComponent('kaolinite_sheet');
    const cid = store.getState().components[0]!.id;
    store.getState().addShape({ type: 'arrow', x: 10, y: 10, w: 100, h: 0, anchors: { start: { kind: 'component', id: cid }, end: { kind: 'free' } } } as never);

    const doc = store.getState().toSceneDocument();
    expect(doc.shapes).toHaveLength(1);

    const store2 = createSceneStore();
    store2.getState().loadScene(JSON.stringify(doc));
    expect(store2.getState().shapes).toHaveLength(1);
    expect(store2.getState().shapes[0]!.type).toBe('arrow');
  });
});

describe('图元撤销/重做（T-11.4：Snapshot 扩展 + 标注欠债一并偿还）', () => {
  it('addShape/updateShape/removeShape 均可撤销重做；拖拽类更新合并为一条', async () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0, now: () => 0 });

    const id = store.getState().addShape({ type: 'rect', x: 0, y: 0 });
    store.getState().updateShape(id, { x: 100 });
    history.undo();
    expect(store.getState().shapes[0]!.x).toBe(0);
    history.redo();
    expect(store.getState().shapes[0]!.x).toBe(100);

    store.getState().removeShape(id);
    expect(store.getState().shapes).toHaveLength(0);
    history.undo(); // 撤销 removeShape
    expect(store.getState().shapes).toHaveLength(1);

    history.undo(); // 撤销 updateShape（回到 x=0）
    expect(store.getState().shapes[0]!.x).toBe(0);
    history.undo(); // 撤销 addShape → 空
    expect(store.getState().shapes).toHaveLength(0);
    history.redo();
    expect(store.getState().shapes).toHaveLength(1);
  });

  it('同 key 连续 updateShape 在合并窗口内合并为一条（一次 Ctrl+Z 撤销整个拖动）', async () => {
    const store = createSceneStore();
    let t = 0;
    const history = attachHistory(store, { mergeWindowMs: 800, now: () => t });
    const id = store.getState().addShape({ type: 'rect', x: 0, y: 0 });
    t = 100;
    store.getState().updateShape(id, { x: 10 });
    t = 200;
    store.getState().updateShape(id, { x: 20 });
    t = 300;
    store.getState().updateShape(id, { x: 30 });
    expect(history.depths().undo).toBe(2); // addShape + 合并后的 updateShape
    history.undo();
    expect(store.getState().shapes[0]!.x).toBe(0); // 回到拖动前
  });

  it('removeComponent 级联锚定退化可撤销（锚定关系恢复）', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0, now: () => 0 });
    const cid = store.getState().addComponent('nanoparticle');
    const aid = store.getState().addShape({ type: 'arrow', x: 0, y: 0, w: 50, h: 0 } as never);
    store.getState().updateShape(aid, { anchors: { start: { kind: 'component', id: cid }, end: { kind: 'free' } } } as never);

    store.getState().removeComponent(cid);
    let a = store.getState().shapes[0] as ArrowShape;
    expect(a.anchors.start.kind).toBe('free'); // 级联退化

    history.undo(); // 组件回来，锚定关系恢复
    a = store.getState().shapes[0] as ArrowShape;
    expect(a.anchors.start.kind).toBe('component');
    expect(store.getState().components).toHaveLength(1);
  });

  it('标注操作可撤销（T-4.4 遗留欠债偿还）', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0, now: () => 0 });
    store.getState().addAnnotation({ type: 'label', text: 'hello', target: [0, 0, 0] });
    expect(store.getState().annotations).toHaveLength(1);
    history.undo();
    expect(store.getState().annotations).toHaveLength(0);
    history.redo();
    expect(store.getState().annotations).toHaveLength(1);
  });
});

describe('图元几何纯函数（绘制/命中共用）', () => {
  it('normBox：负宽高归一化为正向框', () => {
    expect(normBox({ x: 100, y: 50, w: -60, h: -40 })).toEqual({ x: 40, y: 10, w: 60, h: 40 });
  });

  it('nearestEdgePoint：外部点投影到边缘；内部点投到最近边', () => {
    const b = { x: 0, y: 0, w: 100, h: 100 };
    expect(nearestEdgePoint(b, { x: 150, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(nearestEdgePoint(b, { x: 50, y: 150 })).toEqual({ x: 50, y: 100 });
    expect(nearestEdgePoint(b, { x: 10, y: 50 })).toEqual({ x: 0, y: 50 }); // 内部近左边
  });

  it('resolveEndpoint：shape 锚定取边缘最近点；component 锚定投影跟随、裁剪夹边', () => {
    const shapes = [
      { type: 'rect', id: 'r1', x: 0, y: 0, w: 100, h: 100, stroke: '#000000', fill: 'none', lineWidth: 2, dash: 'solid', visible: true, locked: false, rotation: 0 },
    ] as never as import('./schema').SceneShape[];
    // shape 锚定
    const ep = resolveEndpoint({ kind: 'shape', id: 'r1' }, { x: 150, y: 50 }, shapes, [], undefined, 800, 600);
    expect(ep).toMatchObject({ x: 100, y: 50, visible: true });
    // component 锚定：投影可见
    const comps = [{ id: 'c1', transform: { position: [10, 10, 10] as [number, number, number] } }];
    const proj = (p: [number, number, number]) => ({ x: p[0] * 10, y: p[1] * 10, visible: p[0] < 50 });
    const ok = resolveEndpoint({ kind: 'component', id: 'c1' }, { x: 0, y: 0 }, [], comps, proj, 800, 600);
    expect(ok).toMatchObject({ x: 100, y: 100, visible: true });
    // 裁剪：夹到视口边缘
    const clipped = resolveEndpoint({ kind: 'component', id: 'c1' }, { x: 0, y: 0 }, [], comps, () => ({ x: -9999, y: 50, visible: false }), 800, 600);
    expect(clipped.visible).toBe(false);
    expect(clipped.x).toBe(16); // 左边缘 16px
    void CIF;
  });
});

describe('箭头样式（2026-09-12：bow 弧线 + heads 双端）', () => {
  it('bow/heads 默认值（0/end）与显式往返；非法值拒绝', () => {
    const plain = shapeSchema.parse({ type: 'arrow', id: 's1', x: 0, y: 0, w: 100, h: 0 }) as ArrowShape;
    expect(plain.bow).toBe(0);
    expect(plain.heads).toBe('end');

    const curved = shapeSchema.parse({ type: 'arrow', id: 's2', x: 0, y: 0, w: 100, h: 0, bow: -60, heads: 'both' }) as ArrowShape;
    expect(curved.bow).toBe(-60);
    expect(curved.heads).toBe('both');

    expect(shapeSchema.safeParse({ type: 'arrow', id: 's3', x: 0, y: 0, w: 1, h: 0, bow: 300 }).success).toBe(false);
    expect(shapeSchema.safeParse({ type: 'arrow', id: 's4', x: 0, y: 0, w: 1, h: 0, heads: 'mid' }).success).toBe(false);
    // line 不受影响（无 bow/heads）
    const ln = shapeSchema.parse({ type: 'line', id: 's5', x: 0, y: 0, w: 50, h: 50 });
    expect('bow' in ln).toBe(false);
  });
});
