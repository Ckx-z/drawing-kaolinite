/**
 * 共享 PBR 材质 —— 自 demo/index.html 移植（T-1.4）
 * 关键点：sRGB → 线性转换，保证输出色相与色板一致（demo 实测踩坑后固化）。
 */
import * as THREE from 'three';

/** sRGB hex → 线性 Color（材质/背景统一入口） */
export function srgb(hex: number): THREE.Color {
  return new THREE.Color(hex).convertSRGBToLinear();
}

/** 原子材质：白色基底 + 实例色；roughness/clearcoat 对齐 demo 期刊柔和质感 */
export const atomMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.42,
  metalness: 0.0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.5,
  envMapIntensity: 0.9,
});

export const bondMaterial = new THREE.MeshPhysicalMaterial({
  color: srgb(0x8f959c),
  roughness: 0.55,
  clearcoat: 0.2,
});

export const substrateMaterial = new THREE.MeshPhysicalMaterial({
  color: srgb(0xc9d2dc),
  roughness: 0.88,
  metalness: 0,
  clearcoat: 0.15,
  envMapIntensity: 0.6,
});
