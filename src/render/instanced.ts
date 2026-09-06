/**
 * 实例化渲染 —— 自 demo/index.html 移植（T-1.4）
 * 按元素分桶 InstancedMesh：每种元素一个实例网格（一次 draw call 渲染上万原子）；
 * LOD：原子数 >15k 用 8 段球、>6k 用 12 段、其余 18 段。
 */
import * as THREE from 'three';
import { getElement } from '../core/elements';
import type { Atom, Bond } from '../core/geometry';
import { atomMaterial, bondMaterial } from './materials';

const FALLBACK = { cov: 1, vdw: 1.6, color: '#9AA0A6', name: '未知' };

/** 原子 → 按元素分桶的 InstancedMesh（空间填充 = vdw×0.92；球棍 = cov×0.95） */
export function addAtoms(g: THREE.Group, atoms: Atom[], ballstick: boolean): void {
  const byEl: Record<string, Atom[]> = {};
  for (const a of atoms) (byEl[a.el] = byEl[a.el] ?? []).push(a);
  const seg = atoms.length > 15000 ? 8 : atoms.length > 6000 ? 12 : 18;
  const sph = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  const mtx = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const el in byEl) {
    const info = getElement(el) ?? FALLBACK;
    const baseR = ballstick ? info.cov * 0.95 : info.vdw * 0.92;
    const arr = byEl[el];
    const m = new THREE.InstancedMesh(sph, atomMaterial, arr.length);
    m.userData.matKind = 'atom'; // T-4.1 双轨切换按此换材质
    for (let k = 0; k < arr.length; k++) {
      const a = arr[k];
      const r = a.r ?? baseR;
      mtx.makeScale(r, r, r);
      mtx.setPosition(a.x, a.y, a.z);
      m.setMatrixAt(k, mtx);
      col.set(info.color).convertSRGBToLinear(); // sRGB → 线性，保证输出色相
      col.offsetHSL(0, 0, (Math.random() - 0.5) * 0.05); // 轻微明度抖动，"手作"质感
      m.setColorAt(k, col);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    g.add(m);
  }
}

/** 键 → 单个 InstancedMesh 圆柱（半径 rad Å） */
export function addBonds(g: THREE.Group, atoms: Atom[], bonds: Bond[], rad: number): void {
  if (!bonds.length) return;
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const m = new THREE.InstancedMesh(cyl, bondMaterial, bonds.length);
  m.userData.matKind = 'bond';
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const mtx = new THREE.Matrix4();
  const s = new THREE.Vector3();
  for (let k = 0; k < bonds.length; k++) {
    const a = atoms[bonds[k][0]];
    const b = atoms[bonds[k][1]];
    v1.set(a.x, a.y, a.z);
    v2.set(b.x, b.y, b.z);
    dir.subVectors(v2, v1);
    const len = dir.length() || 1e-4;
    mid.addVectors(v1, v2).multiplyScalar(0.5);
    q.setFromUnitVectors(up, dir.normalize());
    s.set(rad, len, rad);
    mtx.compose(mid, q, s);
    m.setMatrixAt(k, mtx);
  }
  g.add(m);
}
