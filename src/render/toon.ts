/**
 * 线稿档材质 —— T-4.1（双轨渲染，决策 D04）
 *
 * 渲染档 = PBR（materials.ts，MeshPhysicalMaterial + PMREM 环境，宣讲/PPT 用）；
 * 线稿档 = MeshToonMaterial + 3 阶 gradientMap（无高光、无阴影像素，明暗量化为
 * 三档色阶）+ 原子反转法线描边外壳（BackSide 纯色）——期刊示意图审美，对齐
 * M1 样图"线稿档"对照，也是矢量导出（T-5.3 SVG）的诚实材质路径。
 *
 * 全部为模块级单例：双档切换只改 mesh.material 引用与描边外壳可见性，
 * 不触碰几何（验收：切换 <1s 不重建几何）。
 */
import * as THREE from 'three';
import { atomMaterial, bondMaterial, substrateMaterial, srgb } from './materials';

export type RenderMode = 'render' | 'toon';

/** 3 阶渐变贴图：暗部 110 / 中间 190 / 亮部 255，NearestFilter 保持硬边色阶 */
export function createToonGradientMap(): THREE.DataTexture {
  const data = new Uint8Array([110, 190, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.LuminanceFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const gradient = createToonGradientMap();

/** 线稿档三件套：原子用实例色（与渲染档同一 setColorAt 通路），无高光无阴影 */
export const toonAtomMaterial = new THREE.MeshToonMaterial({
  color: 0xffffff,
  gradientMap: gradient,
});

export const toonBondMaterial = new THREE.MeshToonMaterial({
  color: srgb(0x8f959c),
  gradientMap: gradient,
});

export const toonSubstrateMaterial = new THREE.MeshToonMaterial({
  color: srgb(0xc9d2dc),
  gradientMap: gradient,
});

/** 均匀描边：反转法线外壳材质（BackSide 纯色，不受光照） */
export const outlineMaterial = new THREE.MeshBasicMaterial({
  color: srgb(0x2b2f33),
  side: THREE.BackSide,
});

/** 双档材质查找表（mesh.userData.matKind → 当前档位材质） */
export function materialFor(kind: string, mode: RenderMode): THREE.Material {
  if (mode === 'toon') {
    if (kind === 'bond') return toonBondMaterial;
    if (kind === 'substrate') return toonSubstrateMaterial;
    return toonAtomMaterial;
  }
  if (kind === 'bond') return bondMaterial;
  if (kind === 'substrate') return substrateMaterial;
  return atomMaterial;
}
