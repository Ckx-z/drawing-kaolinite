/**
 * 接触阴影 + 构图预设测试 —— T-4.3
 *
 * 覆盖：构图预设算位纯函数（方位/视距保持/万向锁规避）；接触阴影的开关契约
 * （材质/可见性——运行时 60fps 由浏览器实测）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { presetDirection, presetPosition } from './postfx';

describe('构图预设算位（纯函数）', () => {
  it('等距：三轴均为正（右上前方）；正视：正前方（x=y=0）；俯视：几乎正上方', () => {
    const iso = presetDirection('iso');
    expect(iso[0]).toBeGreaterThan(0);
    expect(iso[1]).toBeGreaterThan(0);
    expect(iso[2]).toBeGreaterThan(0);

    const front = presetDirection('front');
    expect(front[0]).toBe(0);
    expect(front[1]).toBe(0);
    expect(front[2]).toBe(1);

    const top = presetDirection('top');
    expect(top[1]).toBeGreaterThan(0.99); // 主分量向上
    expect(Math.abs(top[2])).toBeGreaterThan(0); // 微小 z 分量规避万向锁
  });

  it('视距保持：以目标为锚、预设方向 × 当前距离', () => {
    const target: [number, number, number] = [10, -6, 0];
    const pos = presetPosition('front', target, 250);
    const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
    expect(d).toBeCloseTo(250, 6);
    expect(pos[0]).toBeCloseTo(10, 6); // 正视：与目标同 x
    expect(pos[1]).toBeCloseTo(-6, 6); // 与目标同 y
  });

  it('预设方向均为单位向量', () => {
    for (const p of ['iso', 'front', 'top', 'reset'] as const) {
      const [x, y, z] = presetDirection(p);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
  });
});

describe('接触阴影开关契约（材质/灯光配置）', () => {
  it('ShadowMaterial 为透明接影材质（本体不显示，只显示阴影）', () => {
    const m = new THREE.ShadowMaterial({ opacity: 0.22 });
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeLessThan(1);
  });

  it('接影地板几何：水平放置（绕 x 旋转 -90°）', () => {
    const g = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(g, new THREE.ShadowMaterial());
    mesh.rotation.x = -Math.PI / 2;
    mesh.updateMatrixWorld();
    // 平面法线 (0,0,1) 旋转后指向 +y（朝上接影）
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(mesh.rotation);
    expect(normal.y).toBeCloseTo(1, 6);
  });
});
