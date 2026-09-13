/**
 * 模板库载入测试 —— T-11.8
 *
 * applyTemplate 纯逻辑（Dexie 存取链路在浏览器验收覆盖）：
 * 种子模板可载入（strictObject 键剔除回归）、id 全部重生成、
 * component/shape 锚定重映射、模板内编组重建。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyTemplate, type TemplateEntry } from './templateLibrary';
import { attachHistory } from './history';
import { createSceneStore } from './sceneStore';
import type { ArrowShape, TextShape } from '../core/shapes/schema';

const SEEDS = JSON.parse(
  readFileSync(new URL('../../data/seed-templates.json', import.meta.url), 'utf8'),
) as TemplateEntry[];

describe('模板库（T-11.8）', () => {
  it('种子模板数据完整（防手改回归）', () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(4);
    for (const t of SEEDS) {
      expect(t.id).toMatch(/^tpl-/);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.shapes.length).toBeGreaterThan(0);
    }
  });

  it('载入种子模板：缺省字段全部经 schema 默认值补齐、id 无旧值残留', () => {
    const store = createSceneStore();
    const tpl = SEEDS.find((t) => t.id === 'tpl-interfacial')!;
    applyTemplate(store, tpl);
    const shapes = store.getState().shapes;
    expect(shapes).toHaveLength(tpl.shapes.length);
    const oldIds = new Set(tpl.shapes.map((s) => s.id));
    expect(shapes.every((s) => !oldIds.has(s.id))).toBe(true);
    const texts = shapes.filter((s) => s.type === 'text').map((s) => (s as TextShape).text);
    expect(texts).toContain('反应物');
    expect(texts).toContain('界面反应区');
  });

  it('整个载入合并为一条命令：一次 Ctrl+Z 全部回退、一次重做恢复', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const tpl = SEEDS.find((t) => t.id === 'tpl-interfacial')!;
    applyTemplate(store, tpl);
    expect(store.getState().shapes).toHaveLength(9);
    expect(history.depths().undo).toBe(1); // 不是 9 条
    history.undo();
    expect(store.getState().shapes).toHaveLength(0);
    history.redo();
    expect(store.getState().shapes).toHaveLength(9);
  });

  it('载入全部四种种子模板均不抛错（全量回归）', () => {
    for (const tpl of SEEDS) {
      const store = createSceneStore();
      expect(() => applyTemplate(store, tpl)).not.toThrow();
      expect(store.getState().shapes).toHaveLength(tpl.shapes.length);
    }
  });

  it('组件/图元 id 重映射：component 与 shape 锚定指向新 id，编组重建', () => {
    const store = createSceneStore();
    // 用真实组件充当模板 components（改旧 id 模拟模板数据）
    const probe = createSceneStore();
    probe.getState().addComponent('nanoparticle');
    const comp = { ...probe.getState().components[0]!, id: 'tpl-c1' };

    const tpl = {
      id: 'tpl-x',
      name: '锚定与编组',
      components: [comp],
      shapes: [
        { id: 'tpl-s1', type: 'rect', x: 0, y: 0, w: 10, h: 10, group: 'tpl-g1' },
        { id: 'tpl-s2', type: 'rect', x: 20, y: 0, w: 10, h: 10, group: 'tpl-g1' },
        {
          id: 'tpl-s3',
          type: 'arrow',
          x: 0,
          y: 0,
          w: 30,
          h: 0,
          anchors: {
            start: { kind: 'component', id: 'tpl-c1' },
            end: { kind: 'shape', id: 'tpl-s2' },
          },
        },
      ],
    } as unknown as TemplateEntry;

    applyTemplate(store, tpl);
    const st = store.getState();
    expect(st.components).toHaveLength(1);
    const newCid = st.components[0]!.id;
    expect(newCid).not.toBe('tpl-c1');

    const arrow = st.shapes.find((s) => s.type === 'arrow') as ArrowShape;
    expect(arrow.anchors.start).toEqual({ kind: 'component', id: newCid });
    const end = arrow.anchors.end as { kind: string; id: string };
    expect(end.kind).toBe('shape');
    expect(st.shapes.some((s) => s.id === end.id && s.type === 'rect')).toBe(true);

    // 编组按新 id 重建：两个 rect 同组且组名不同于模板旧名
    const boxes = st.shapes.filter((s) => s.type === 'rect');
    const groups = new Set(boxes.map((b) => b.group));
    expect(groups.size).toBe(1);
    expect(groups.has('tpl-g1')).toBe(false);
  });

  it('快照式复现（2026-09-13 五原则）：组件 transform 逐位原样 + 相机/形态/2D 视图恢复 + 老模板兼容', async () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const { rendererRef } = await import('./rendererRef');
    const { shapeViewStore } = await import('../ui/shapes/view');

    // 假渲染服务：记录相机恢复调用
    const camPos = { set: (x: number, y: number, z: number) => { camPos.v = [x, y, z]; }, v: null as null | number[] };
    const tgt = { set: (x: number, y: number, z: number) => { tgt.v = [x, y, z]; }, v: null as null | number[] };
    const calls: string[] = [];
    const fakeSvc = {
      camera: { position: camPos, lookAt: () => calls.push('lookAt'), updateProjectionMatrix: () => calls.push('proj') },
      orbit: { target: tgt, update: () => calls.push('orbitUpdate') },
    };
    const prev = rendererRef.current;
    rendererRef.current = fakeSvc as never;
    try {
      // ① 组件坐标逐位快照
      const tpl: TemplateEntry = {
        id: 'tpl-snap', name: '快照测试',
        components: [{
          id: 'old1', type: 'kaolinite_sheet', name: '片层A',
          params: { Lx: 40, Ly: 36, layers: 2, d001: 7.4, shape: '矩形', style: '空间填充', edgeH: false, mineral: 'kaolinite' },
          transform: { position: [-8.5, 3.25, 0], rotation: [10, -25, 5], scale: 1.2 },
          visible: true,
        }] as never,
        shapes: [],
        mode: 'diagram',
        camera: { position: [12, -34, 56], target: [1, 2, 3] },
        view: { zoom: 1.75, panX: 40, panY: -20 },
      };
      applyTemplate(store, tpl);
      const comp = store.getState().components[0]!;
      expect(comp.transform.position).toEqual([-8.5, 3.25, 0]);   // 绝对坐标逐位
      expect(comp.transform.rotation).toEqual([10, -25, 5]);
      expect(comp.transform.scale).toBe(1.2);                      // 比例锁定
      // ② 视角/形态/2D 视图恢复
      expect(store.getState().mode).toBe('diagram');
      expect(camPos.v).toEqual([12, -34, 56]);
      expect(tgt.v).toEqual([1, 2, 3]);
      expect(calls).toContain('lookAt');
      const v = shapeViewStore.getState();
      expect([v.zoom, v.panX, v.panY]).toEqual([1.75, 40, -20]);

      // ③ 老模板（无 camera/mode/view）：不恢复视角（相机不被触碰）
      camPos.v = null; tgt.v = null;
      applyTemplate(store, { id: 'old', name: '老模板', shapes: [] });
      expect(camPos.v).toBeNull();
      expect(tgt.v).toBeNull();

      // ④ 一次撤销整组回退（群组整体）
      history.undo();
      expect(store.getState().shapes).toHaveLength(0);
    } finally {
      rendererRef.current = prev;
    }
  });
});
