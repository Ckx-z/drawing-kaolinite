/**
 * 拖拽吸附验收（2026-09-22）：重叠判定 → 吸附放置 → 不穿透/可撤销/修饰键跳过。
 * 纯函数级（数值断言，非截图）。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildMolecule } from '../builders';
import type { Atom } from '../geometry';
import {
  atomsOverlap,
  boxOf,
  boxesOverlap,
  boxVolume,
  minAtomDistance,
  planSnap,
  worldAtoms,
  type WorldAtom,
} from './snap';

const T = (position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale = 1) => ({ position, rotation, scale });

/** 假基底：z=0 平面上一片 O 原子（片层近似） */
const slabAtoms: WorldAtom[] = [];
for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) slabAtoms.push({ el: 'O', x: i * 2.8, y: j * 2.8, z: 0 });

describe('重叠检测', () => {
  it('包围盒相交判定 + 体积大小判定', () => {
    const a = boxOf([{ el: 'O', x: 0, y: 0, z: 0 }, { el: 'O', x: 2, y: 2, z: 2 }]);
    const b = boxOf([{ el: 'O', x: 1, y: 1, z: 1 }, { el: 'O', x: 5, y: 5, z: 5 }]);
    const c = boxOf([{ el: 'O', x: 10, y: 10, z: 10 }, { el: 'O', x: 12, y: 12, z: 12 }]);
    expect(boxesOverlap(a, b)).toBe(true);
    expect(boxesOverlap(a, c)).toBe(false);
    expect(boxVolume(b)).toBeGreaterThan(boxVolume(a));
  });

  it('原子级重叠：分子穿入基底 → true；分离 → false', () => {
    const mol = worldAtoms(buildMolecule('H₂O').atoms, T([0, 0, 0.3]));
    expect(atomsOverlap(mol, slabAtoms)).toBe(true);
    const far = worldAtoms(buildMolecule('H₂O').atoms, T([0, 0, 6]));
    expect(atomsOverlap(far, slabAtoms)).toBe(false);
  });
});

describe('吸附放置（planSnap）', () => {
  const molLocal: Atom[] = buildMolecule('H₂O').atoms;

  it('重叠分子吸附后：贴表面（minDist ≈ vdW 接触带）、不穿透、无 clash', () => {
    const t = T([0.5, 0.3, 0.4]); // 与片层重叠
    const plan = planSnap(molLocal, t, slabAtoms);
    const placed = worldAtoms(molLocal, plan.transform);
    const md = minAtomDistance(placed, slabAtoms);
    expect(md).toBeGreaterThan(1.9); // ≥ 0.7×(O·O vdW 和)≈2.1 的接触带下沿
    expect(md).toBeLessThan(4.5); // 贴合（不是被推飞）
    expect(plan.surfaceNormal[2]).toBeGreaterThan(0.9); // 平面基底法向 ≈ +z
    expect(plan.transform.rotation).toEqual(t.rotation); // 朝向保持（用户表达权）
  });

  it('侧向拖入：吸附点取最近表面原子；质心落在表面点上方法向带', () => {
    const t = T([5.6, 2.8, -0.5]);
    const plan = planSnap(molLocal, t, slabAtoms);
    expect(plan.surfacePoint[0]).toBeCloseTo(5.6, 1);
    const placed = worldAtoms(molLocal, plan.transform);
    const cy = placed.reduce((s, a) => s + a.y / placed.length, 0);
    expect(cy).toBeCloseTo(2.8, 1); // 质心 y 对齐表面点
  });

  it('缩放分子吸附仍成立（视觉缩放语义一致）', () => {
    const plan = planSnap(molLocal, T([0, 0, 0.2], [0, 30, 0], 2), slabAtoms);
    const placed = worldAtoms(molLocal, plan.transform);
    expect(minAtomDistance(placed, slabAtoms)).toBeGreaterThan(1.9);
  });
});

describe('dragSnap 状态层（detect/apply/修饰键/撤销记录）', () => {
  it('端到端：重叠释放 → 吸附 transform（记录 before/after）；Alt 按住 → 自由放置', async () => {
    const { sceneStore } = await import('../../state/sceneStore');
    const { rendererRef } = await import('../../state/rendererRef');
    const dragSnap = await import('../../state/dragSnap');
    // 假渲染服务：提供两组件几何
    const geo = new Map<string, { atoms: Atom[]; bonds: never[] }>();
    const fake = {
      getComponentGeometry: (id: string) => geo.get(id) ?? null,
      tc: { dragging: true },
      getSelectedId: () => 'mol1',
      setHover: () => {},
    };
    const prev = rendererRef.current;
    rendererRef.current = fake as never;
    try {
      for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
      const sid = sceneStore.getState().addComponent('kaolinite_sheet'); // 基底（大）
      const mid = sceneStore.getState().addComponent('molecule', { params: { kind: 'H₂O' } });
      sceneStore.getState().setTransform(mid, T([0, 0, 0.3]) as never); // 拖到重叠位
      geo.set(sid, { atoms: slabAtoms as never as Atom[], bonds: [] });
      geo.set(mid, { atoms: buildMolecule('H₂O').atoms, bonds: [] });
      expect(dragSnap.detectSnapOnDrag(mid)).toBe(true);
      expect(dragSnap.getPendingSnap()?.substrateId).toBe(sid);
      const snapped = dragSnap.applySnapOnRelease(mid, T([0, 0, 0.3]));
      expect(snapped).toBeTruthy();
      expect(snapped!.position[2]).toBeGreaterThan(0.3); // 被推到表面上方
      expect(dragSnap.getAdsorptionRecords()[0]!.transformBefore.position).toEqual([0, 0, 0.3]);
      // Alt 跳过：再次重叠释放但按住 Alt → null（自由放置）
      dragSnap.detectSnapOnDrag(mid);
      dragSnap.snapModifiers.alt = true;
      expect(dragSnap.applySnapOnRelease(mid, T([0, 0, 0.5]))).toBeNull();
      dragSnap.snapModifiers.alt = false;
      // 解除吸附：恢复 before
      const back = dragSnap.detachLastSnap(mid);
      expect(back?.position).toEqual([0, 0, 0.3]);
    } finally {
      rendererRef.current = prev;
      for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
    }
  });
});
