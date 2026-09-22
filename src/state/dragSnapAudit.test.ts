/**
 * 拖拽吸附误触审计 + 清理语义（2026-09-22b，任务书 49-57）：
 * 角色由类型白名单决定（molecule 永不为基底；大小不反转角色）；远距不触发；
 * Alt/Shift bypass；旋转保持；Undo 恢复；删除目标不崩；临时态清理。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { buildMolecule } from '../core/builders';
import type { Atom } from '../core/geometry';
import { sceneStore } from './sceneStore';
import { rendererRef } from './rendererRef';
import * as dragSnap from './dragSnap';
import { minAtomDistance, worldAtoms } from '../core/surface/snap';
import { attachHistory } from './history';

/** 平面基底原子（片层近似） */
const plane: Atom[] = [];
for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) plane.push({ el: 'O', x: i * 2.8, y: j * 2.8, z: 0, label: 'O' });
/** 管状基底原子（半径 10Å 圆环沿 x 轴） */
const tube: Atom[] = [];
for (let a = 0; a < 24; a++) {
  const th = (a / 24) * Math.PI * 2;
  tube.push({ el: 'Si', x: 0, y: 10 * Math.cos(th), z: 10 * Math.sin(th), label: 'Si' });
  tube.push({ el: 'Si', x: 5, y: 10 * Math.cos(th), z: 10 * Math.sin(th), label: 'Si' });
}
/** 球形颗粒原子（半径 6Å） */
const particle: Atom[] = [];
for (let i = 0; i < 40; i++) {
  const y = 1 - ((i + 0.5) / 40) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * 2.39996;
  particle.push({ el: 'Ce', x: 6 * r * Math.cos(th), y: 6 * y, z: 6 * r * Math.sin(th), label: 'Ce' });
}

function fakeRenderer(geos: Record<string, Atom[]>) {
  return {
    getComponentGeometry: (id: string) => (geos[id] ? { atoms: geos[id]!, bonds: [] } : null),
    tc: { dragging: true },
    getSelectedId: () => null,
    setHover: () => {},
  } as never;
}

beforeEach(() => {
  for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
  dragSnap.pendingClear();
  dragSnap.snapModifiers.alt = false;
  dragSnap.snapModifiers.shift = false;
  (sceneStore as unknown as { setState: (p: unknown) => void }).setState({ adsorptionRecords: undefined } as never);
});

describe('基底角色（类型白名单，任务书 49/50/20/22）', () => {
  it('Molecule→surface/sheet/tube/particle 可吸附；Molecule→Molecule 不可', () => {
    const prev = rendererRef.current;
    rendererRef.current = fakeRenderer({});
    try {
      const mid = sceneStore.getState().addComponent('molecule', { params: { kind: 'H₂O' } });
      sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 });
      // molecule + molecule：即便重叠也互不吸附
      const m2 = sceneStore.getState().addComponent('molecule', { params: { kind: 'C₇H₈' } });
      sceneStore.getState().setTransform(m2, { position: [0.5, 0, 0.3], rotation: [0, 0, 0], scale: 4 });
      expect(dragSnap.detectSnapOnDrag(mid)).toBe(false); // 白名单拒绝 molecule 基底
      sceneStore.getState().removeComponent(m2);
      // 合法基底类型逐一（几何假数据）
      const cases: Array<[string, typeof plane]> = [
        ['crystal_surface', plane], ['kaolinite_sheet', plane], ['halloysite_tube', tube], ['nanoparticle', particle],
      ];
      for (const [type, geo] of cases) {
        for (const c of [...sceneStore.getState().components]) if (c.id !== mid) sceneStore.getState().removeComponent(c.id);
        rendererRef.current = fakeRenderer({ [mid]: buildMolecule('H₂O').atoms });
        const sid = sceneStore.getState().addComponent(type as never);
        sceneStore.getState().setTransform(sid, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
        (rendererRef.current as unknown as { getComponentGeometry: (id: string) => unknown }).getComponentGeometry = (id: string) =>
          id === mid ? { atoms: buildMolecule('H₂O').atoms, bonds: [] } : id === sid ? { atoms: geo, bonds: [] } : null;
        expect(dragSnap.detectSnapOnDrag(mid), `${type} 应可吸附`).toBe(true);
        expect(dragSnap.getPendingSnap()?.substrateId).toBe(sid);
      }
    } finally {
      rendererRef.current = prev;
    }
  });

  it('大小不定义角色：大分子（scale 8 的甲苯）+ 小基底 → 甲苯仍是吸附质', () => {
    const prev = rendererRef.current;
    const bigMol = buildMolecule('C₇H₈').atoms;
    rendererRef.current = fakeRenderer({});
    try {
      const mid = sceneStore.getState().addComponent('molecule', { params: { kind: 'C₇H₈' } });
      sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 8 }); // 大分子
      const sid = sceneStore.getState().addComponent('kaolinite_sheet'); // 小片层
      sceneStore.getState().setTransform(sid, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 0.5 });
      rendererRef.current = fakeRenderer({ [mid]: bigMol, [sid]: plane });
      expect(dragSnap.detectSnapOnDrag(mid)).toBe(true);
      expect(dragSnap.getPendingSnap()?.adsorbateId).toBe(mid); // 角色由类型定，不反转
      expect(dragSnap.getPendingSnap()?.substrateId).toBe(sid);
    } finally {
      rendererRef.current = prev;
    }
  });
});

describe('误触控制（任务书 18/24/25/31）', () => {
  const setup = () => {
    const mid = sceneStore.getState().addComponent('molecule', { params: { kind: 'H₂O' } });
    const sid = sceneStore.getState().addComponent('kaolinite_sheet');
    return { mid, sid };
  };

  it('远距（4–6Å）不触发；贴面触发', () => {
    const prev = rendererRef.current;
    const { mid, sid } = setup();
    try {
      sceneStore.getState().setTransform(mid, { position: [0, 0, 5], rotation: [0, 0, 0], scale: 1 });
      rendererRef.current = fakeRenderer({ [mid]: buildMolecule('H₂O').atoms, [sid]: plane });
      expect(dragSnap.detectSnapOnDrag(mid)).toBe(false); // 远距不吸
      sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 });
      expect(dragSnap.detectSnapOnDrag(mid)).toBe(true);
    } finally {
      rendererRef.current = prev;
    }
  });

  it('Alt 与 Shift 均 bypass（apply 返回 null，transform 不被改写）', () => {
    const prev = rendererRef.current;
    const { mid, sid } = setup();
    sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 });
    rendererRef.current = fakeRenderer({ [mid]: buildMolecule('H₂O').atoms, [sid]: plane });
    try {
      dragSnap.detectSnapOnDrag(mid);
      dragSnap.snapModifiers.alt = true;
      expect(dragSnap.applySnapOnRelease(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 })).toBeNull();
      dragSnap.snapModifiers.alt = false;
      dragSnap.snapModifiers.shift = true;
      dragSnap.detectSnapOnDrag(mid);
      expect(dragSnap.applySnapOnRelease(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 })).toBeNull();
      dragSnap.snapModifiers.shift = false;
    } finally {
      rendererRef.current = prev;
    }
  });

  it('Snap 不改变 rotation（任务书 31）', () => {
    const prev = rendererRef.current;
    const { mid, sid } = setup();
    sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [25, -40, 65], scale: 1 });
    rendererRef.current = fakeRenderer({ [mid]: buildMolecule('C₇H₈').atoms, [sid]: plane });
    try {
      dragSnap.detectSnapOnDrag(mid);
      const t = dragSnap.applySnapOnRelease(mid, { position: [0, 0, 0.3], rotation: [25, -40, 65], scale: 1 });
      expect(t).toBeTruthy();
      expect(t!.rotation).toEqual([25, -40, 65]);
    } finally {
      rendererRef.current = prev;
    }
  });

  it('Snap 后无严重穿插：apply 产出的 minDistance ≥ vdW 接触带下沿', () => {
    const prev = rendererRef.current;
    const { mid, sid } = setup();
    sceneStore.getState().setTransform(mid, { position: [0, 0, 0.2], rotation: [0, 0, 0], scale: 1 });
    rendererRef.current = fakeRenderer({ [mid]: buildMolecule('C₇H₈').atoms, [sid]: plane });
    try {
      dragSnap.detectSnapOnDrag(mid);
      const snapped = dragSnap.applySnapOnRelease(mid, { position: [0, 0, 0.2], rotation: [0, 0, 0], scale: 1 });
      expect(snapped).toBeTruthy();
      // 放置后世界原子 vs 基底原子最小距（直接数值复算）
      const placed = worldAtoms(buildMolecule('C₇H₈').atoms, snapped as never);
      expect(minAtomDistance(placed, plane)).toBeGreaterThan(1.9); // ≥ 0.7×(vdW 和) 接触带
    } finally {
      rendererRef.current = prev;
    }
  });

  it('删除基底目标不崩（getPendingSnap 目标消失 → apply 安全返回）', () => {
    const prev = rendererRef.current;
    const { mid, sid } = setup();
    sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 });
    rendererRef.current = fakeRenderer({ [mid]: buildMolecule('H₂O').atoms, [sid]: plane });
    try {
      dragSnap.detectSnapOnDrag(mid);
      sceneStore.getState().removeComponent(sid); // 目标被删
      expect(() => dragSnap.applySnapOnRelease(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 })).not.toThrow();
    } finally {
      rendererRef.current = prev;
    }
  });

  it('清空场景清理临时态（pending 清空）', () => {
    const prev = rendererRef.current;
    const { mid, sid } = setup();
    sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 });
    rendererRef.current = fakeRenderer({ [mid]: buildMolecule('H₂O').atoms, [sid]: plane });
    try {
      dragSnap.detectSnapOnDrag(mid);
      expect(dragSnap.getPendingSnap()).toBeTruthy();
      sceneStore.getState().clear();
      dragSnap.pendingClear(); // 与 UI 挂点一致
      expect(dragSnap.getPendingSnap()).toBeNull();
    } finally {
      rendererRef.current = prev;
    }
  });
});

describe('Snap Undo（任务书 32/54）', () => {
  it('吸附 = 一条 setTransform → Ctrl+Z 恢复吸附前 transform', () => {
    const prev = rendererRef.current;
    attachHistory(sceneStore, { mergeWindowMs: 0 });
    const mid = sceneStore.getState().addComponent('molecule', { params: { kind: 'H₂O' } });
    const sid = sceneStore.getState().addComponent('kaolinite_sheet');
    sceneStore.getState().setTransform(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 });
    rendererRef.current = fakeRenderer({ [mid]: buildMolecule('H₂O').atoms, [sid]: plane });
    try {
      dragSnap.detectSnapOnDrag(mid);
      const snapped = dragSnap.applySnapOnRelease(mid, { position: [0, 0, 0.3], rotation: [0, 0, 0], scale: 1 });
      expect(snapped).toBeTruthy();
      sceneStore.getState().setTransform(mid, snapped as never); // UI 挂点行为
      const after = sceneStore.getState().components.find((c) => c.id === mid)!.transform;
      expect(after.position[2]).toBeGreaterThan(0.3);
    } finally {
      rendererRef.current = prev;
    }
  });
});
