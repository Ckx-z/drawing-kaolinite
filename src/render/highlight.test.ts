/**
 * 拾取高亮 / 悬停反馈测试 —— T-7.1
 *
 * 覆盖：外壳创建（实例矩阵放大、材质契约、raycast 置空、状态分离）、hoverStore 状态机。
 * 帧率无感（BBox 拾取 O(组件数)）与双向联动正确性由浏览器实测覆盖。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  createHighlightShell,
  findShell,
  hoverShellMaterial,
  selectShellMaterial,
  hoverStore,
} from './highlight';

function atomMesh(count = 3): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial(), count);
  const mtx = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    mtx.makeScale(2, 2, 2);
    mtx.setPosition(k * 10, 0, 0);
    m.setMatrixAt(k, mtx);
  }
  m.userData.matKind = 'atom';
  return m;
}

describe('高亮外壳', () => {
  it('创建 hover/selected 双外壳：实例数一致、矩阵放大 1.10/1.14、BackSide 纯色', () => {
    const src = atomMesh(3);
    const hover = createHighlightShell(src, 'hover');
    const select = createHighlightShell(src, 'selected');

    expect(hover.count).toBe(3);
    expect(hover.material).toBe(hoverShellMaterial);
    expect(hoverShellMaterial.side).toBe(THREE.BackSide);
    expect(select.material).toBe(selectShellMaterial);

    // 实例缩放 = 原 2 × (1.10 / 1.14)，位置平移保持（中心不漂移）
    const mtx = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    src.getMatrixAt(0, mtx);
    mtx.decompose(pos, quat, scl);
    expect(scl.x).toBe(2);
    hover.getMatrixAt(0, mtx);
    mtx.decompose(pos, quat, scl);
    expect(scl.x).toBeCloseTo(2.2, 5);
    expect(pos.x).toBe(0); // 平移分量不被缩放
    select.getMatrixAt(0, mtx);
    mtx.decompose(pos, quat, scl);
    expect(scl.x).toBeCloseTo(2.28, 5);
    expect(hover.userData.highlight).toBe('hover');
    expect(select.userData.highlight).toBe('selected');
  });

  it('外壳 raycast 置空（不参与任何拾取，不干扰点击选中）', () => {
    const shell = createHighlightShell(atomMesh(), 'hover');
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), new THREE.PerspectiveCamera());
    expect(() => shell.raycast(ray, [])).not.toThrow();
    const hits: THREE.Intersection[] = [];
    shell.raycast(ray, hits);
    expect(hits).toHaveLength(0); // 置空实现：永远无交点
  });

  it('findShell 按状态检索', () => {
    const g = new THREE.Group();
    g.add(atomMesh());
    g.add(createHighlightShell(g.children[0] as THREE.InstancedMesh, 'hover'));
    g.add(createHighlightShell(g.children[0] as THREE.InstancedMesh, 'selected'));
    expect(findShell(g, 'hover')?.userData.highlight).toBe('hover');
    expect(findShell(g, 'selected')?.userData.highlight).toBe('selected');
    expect(findShell(g, 'none' as 'hover')).toBeUndefined();
  });
});

describe('hoverStore 状态机（画布 ↔ 图层面板双向联动数据源）', () => {
  beforeEach(() => hoverStore.getState().setHover(null));

  it('setHover 写入/清除；null 幂等', () => {
    hoverStore.getState().setHover('c1');
    expect(hoverStore.getState().id).toBe('c1');
    hoverStore.getState().setHover(null);
    expect(hoverStore.getState().id).toBeNull();
    hoverStore.getState().setHover(null);
    expect(hoverStore.getState().id).toBeNull();
  });

  it('订阅通知（Canvas 外壳与面板行样式共同数据源）', () => {
    const seen: Array<string | null> = [];
    const un = hoverStore.subscribe(({ id }) => seen.push(id));
    hoverStore.getState().setHover('c2');
    hoverStore.getState().setHover(null);
    un();
    expect(seen).toEqual(['c2', null]);
  });
});
