/**
 * 橡胶基底几何 —— 自 demo/core/builders.js buildSubstrate 移植（T-1.4）
 * 依赖 THREE.Shape/Extrude，故归渲染层；内核保持零 THREE 依赖。
 */
import * as THREE from 'three';
import type { SubstrateParams } from '../core/types';

export function buildSubstrateGeometry(p: SubstrateParams): THREE.BufferGeometry {
  const Lx = p.Lx;
  const Ly = p.Ly;
  const T = p.thickness;
  const rc = Math.min(Lx, Ly) * 0.16;
  const s = new THREE.Shape();
  const x0 = -Lx / 2;
  const y0 = -Ly / 2;
  s.moveTo(x0 + rc, y0);
  s.lineTo(x0 + Lx - rc, y0);
  s.quadraticCurveTo(x0 + Lx, y0, x0 + Lx, y0 + rc);
  s.lineTo(x0 + Lx, y0 + Ly - rc);
  s.quadraticCurveTo(x0 + Lx, y0 + Ly, x0 + Lx - rc, y0 + Ly);
  s.lineTo(x0 + rc, y0 + Ly);
  s.quadraticCurveTo(x0, y0 + Ly, x0, y0 + Ly - rc);
  s.lineTo(x0, y0 + rc);
  s.quadraticCurveTo(x0, y0, x0 + rc, y0);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: T,
    bevelEnabled: true,
    bevelThickness: 0.55,
    bevelSize: 0.55,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geo.rotateX(-Math.PI / 2); // 挤出方向 → 竖直（y 轴），顶面朝上
  geo.translate(0, T / 2, 0);
  return geo;
}
