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
});
