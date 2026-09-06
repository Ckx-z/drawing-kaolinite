/**
 * 双轨渲染材质契约测试 —— T-4.1
 *
 * 验收核心（Node 侧）：线稿档 = MeshToonMaterial + 3 阶 gradientMap（无高光无阴影
 * 的材质学保证）+ 描边外壳 BackSide；材质查找表按档位与 matKind 正确分发。
 * 渲染像素级抽样（线稿档无高光/阴影像素）与切换 <1s 由浏览器实测覆盖。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createToonGradientMap,
  materialFor,
  outlineMaterial,
  toonAtomMaterial,
  toonBondMaterial,
  toonSubstrateMaterial,
} from './toon';

describe('线稿档材质契约', () => {
  it('三件套均为 MeshToonMaterial（无高光/阴影的材质学保证）', () => {
    expect(toonAtomMaterial).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(toonBondMaterial).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(toonSubstrateMaterial).toBeInstanceOf(THREE.MeshToonMaterial);
    // Toon 材质无镜面高光/清漆项（contrast with MeshPhysicalMaterial）
    expect('specular' in toonAtomMaterial).toBe(false);
    expect('clearcoat' in toonAtomMaterial).toBe(false);
  });

  it('gradientMap 为 3 阶亮度纹理（明暗量化三档色阶）', () => {
    const g = createToonGradientMap();
    expect(g.image.width).toBe(3);
    expect(g.image.height).toBe(1);
    expect(g.minFilter).toBe(THREE.NearestFilter); // 硬边色阶，不做插值
    expect(Array.from(g.image.data)).toEqual([110, 190, 255]);
  });

  it('描边外壳：BackSide 纯色 MeshBasicMaterial（不受光照，均匀描边）', () => {
    expect(outlineMaterial).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(outlineMaterial.side).toBe(THREE.BackSide);
  });
});

describe('materialFor 查找表', () => {
  it('按 matKind × 档位正确分发（atom/bond/substrate × render/toon）', () => {
    expect(materialFor('atom', 'render')).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(materialFor('bond', 'render')).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(materialFor('substrate', 'render')).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(materialFor('atom', 'toon')).toBe(toonAtomMaterial);
    expect(materialFor('bond', 'toon')).toBe(toonBondMaterial);
    expect(materialFor('substrate', 'toon')).toBe(toonSubstrateMaterial);
    // 未知 kind 回退原子材质（球棍分子等复用原子通路）
    expect(materialFor('molecule', 'toon')).toBe(toonAtomMaterial);
  });

  it('sRGB → 线性转换与渲染档一致（线稿档色相不变）', () => {
    // 0x8f959c 经 convertSRGBToLinear 后各分量应小于原 sRGB 值
    const c = toonBondMaterial.color;
    expect(c.r).toBeLessThan(0x8f / 255);
    expect(c.g).toBeLessThan(0x95 / 255);
    expect(c.b).toBeLessThan(0x9c / 255);
  });
});
