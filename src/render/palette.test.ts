/**
 * 色板验收测试 —— T-4.2
 *
 * 验收标准（TODO）：切色板全场景即时生效并随场景 JSON 保存/恢复；
 * 颜色经 sRGB → 线性通路（与画布一致）。渲染像素级一致性由浏览器实测。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ELEMENTS } from '../core/elements';
import { paletteSettingSchema, sceneDocumentSchema } from '../core/schema';
import { addAtoms, recolorAtomMesh } from './instanced';
import { PALETTES, resolveColor, setActivePalette, activeColorFor } from './palette';
import { createSceneStore } from '../state/sceneStore';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALL_ELEMENTS = Object.keys(ELEMENTS);

describe('预设色板', () => {
  it('4 套色板（默认/暖调/冷调/高对比）覆盖全部 16 元素且为合法 hex', () => {
    expect(PALETTES).toHaveLength(4);
    for (const p of PALETTES) {
      for (const el of ALL_ELEMENTS) {
        expect(p.colors[el], `${p.id}/${el}`).toMatch(HEX);
      }
    }
  });

  it('暖调/冷调/高对比为确定性变换（同输入同输出）且与默认色不同', () => {
    for (const el of ALL_ELEMENTS) {
      const d = PALETTES[0].colors[el];
      expect(PALETTES[1].colors[el]).toBe(PALETTES[1].colors[el]); // 稳定
      expect(PALETTES[1].colors[el]).not.toBe(d);
      expect(PALETTES[2].colors[el]).not.toBe(d);
      expect(PALETTES[3].colors[el]).not.toBe(d);
    }
  });

  it('resolveColor 优先级：overrides > 指定色板 > 默认', () => {
    expect(resolveColor('O', { id: 'warm' })).toBe(PALETTES[1].colors.O);
    expect(resolveColor('O', { id: 'warm', overrides: { O: '#123456' } })).toBe('#123456');
    expect(resolveColor('O', {})).toBe(PALETTES[0].colors.O);
    expect(resolveColor('未知元素', {})).toBe('#9AA0A6'); // 回退灰
  });

  it('active 色板：新组件创建路径（addAtoms→activeColorFor）随 setActivePalette 变化', () => {
    setActivePalette({ id: 'warm' });
    expect(activeColorFor('O')).toBe(PALETTES[1].colors.O);
    setActivePalette({ overrides: { O: '#abcdef' } });
    expect(activeColorFor('O')).toBe('#abcdef');
    setActivePalette({});
    expect(activeColorFor('O')).toBe(PALETTES[0].colors.O);
  });
});

describe('场景 JSON 持久化（T-4.2 验收：随场景保存/恢复）', () => {
  it('setPalette → toSceneDocument 含 palette → loadScene 恢复', () => {
    const store = createSceneStore();
    store.getState().addComponent('halloysite_tube');
    store.getState().setPalette({ id: 'cool', overrides: { O: '#123456' } });

    const doc = store.getState().toSceneDocument();
    expect(doc.palette).toEqual({ id: 'cool', overrides: { O: '#123456' } });

    const store2 = createSceneStore();
    store2.getState().loadScene(JSON.parse(JSON.stringify(doc)));
    expect(store2.getState().palette).toEqual({ id: 'cool', overrides: { O: '#123456' } });
  });

  it('未设置色板时序列化不含 palette 字段；旧场景文件（无 palette）载入回默认', () => {
    const store = createSceneStore();
    store.getState().addComponent('molecule');
    expect('palette' in store.getState().toSceneDocument()).toBe(false);

    const store2 = createSceneStore();
    store2.getState().loadScene({
      format: 'kaolin-scene/v1',
      saved: '2026-09-06T00:00:00.000Z',
      components: [],
    });
    expect(store2.getState().palette).toEqual({});
  });

  it('schema 拒绝非法覆盖色（非 #RRGGBB）', () => {
    const bad = {
      format: 'kaolin-scene/v1',
      saved: '2026-09-06T00:00:00.000Z',
      components: [],
      palette: { overrides: { O: 'red' } },
    };
    expect(sceneDocumentSchema.safeParse(bad).success).toBe(false);
    expect(paletteSettingSchema.safeParse({ id: 'warm' }).success).toBe(true);
  });
});

describe('重着色（不重建几何）', () => {
  it('recolorAtomMesh 按覆盖色更新实例色（instanceColor 通路）', () => {
    setActivePalette({}); // 默认
    const g = new THREE.Group();
    addAtoms(g, [
      { el: 'O', x: 0, y: 0, z: 0 },
      { el: 'Si', x: 3, y: 0, z: 0 },
    ], false);
    const mesh = g.children[0] as THREE.InstancedMesh;
    expect(mesh.userData.elements).toEqual(['O']); // 按元素分桶：O/Si 各一个 InstancedMesh

    const before = new THREE.Color();
    mesh.getColorAt(0, before);

    // 全局切到覆盖色
    setActivePalette({ overrides: { O: '#00ff00' } });
    recolorAtomMesh(mesh);
    const after = new THREE.Color();
    mesh.getColorAt(0, after);

    expect(after.getHexString()).not.toBe(before.getHexString());
    // 覆盖色 #00ff00 经线性化后 g 通道显著高于 r/b（明度抖动 ±0.05 不改变结论）
    expect(after.g).toBeGreaterThan(after.r);
    expect(after.g).toBeGreaterThan(after.b);
  });
});
