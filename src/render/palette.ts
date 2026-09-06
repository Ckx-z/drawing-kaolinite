/**
 * 色板 —— T-4.2（预设学术色板 + 逐元素覆盖）
 *
 * 默认色板 = elements.ts 的期刊柔和配色（O 红 / Si 米黄 / Al 银粉…，M1 样图体系）；
 * 暖调/冷调 = 对默认色做确定性 HSL 变换；高对比 = 拉开饱和度与明度分布。
 * 逐元素覆盖（overrides）优先级最高，随场景 JSON 持久化（schema palette 字段）。
 *
 * active 状态：instanced.ts 创建新原子网格时读取（新增组件即刻着色）；
 * RendererService.setPalette 更新 active 并对既有网格重着色（不重建几何）。
 */
import * as THREE from 'three';
import { ELEMENTS } from '../core/elements';

export interface PaletteSetting {
  id?: string;
  overrides?: Record<string, string>;
}

export interface PaletteDef {
  id: string;
  name: string;
  colors: Record<string, string>;
}

const DEFAULT_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(ELEMENTS).map(([k, v]) => [k, v.color]),
);

/** 确定性 HSL 变换（THREE r147 legacy 模式：分量即 sRGB，往返无损） */
function shiftColor(hex: string, dh: number, sm: number, lightnessFn: (l: number) => number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + dh + 1) % 1, Math.min(1, hsl.s * sm), Math.min(1, Math.max(0, lightnessFn(hsl.l))));
  return `#${c.getHexString()}`;
}

const WARM = (hex: string): string => shiftColor(hex, 0.055, 1.12, (l) => Math.min(1, l * 1.04 + 0.01));
const COOL = (hex: string): string => shiftColor(hex, -0.07, 0.95, (l) => l * 0.98);
const CONTRAST = (hex: string): string =>
  shiftColor(hex, 0, 1.5, (l) => (l < 0.5 ? l * 0.72 : 1 - (1 - l) * 0.72));

const from = (fn: (hex: string) => string): Record<string, string> =>
  Object.fromEntries(Object.entries(DEFAULT_COLORS).map(([k, v]) => [k, fn(v)]));

export const PALETTES: PaletteDef[] = [
  { id: 'default', name: '期刊柔和', colors: { ...DEFAULT_COLORS } },
  { id: 'warm', name: '暖调', colors: from(WARM) },
  { id: 'cool', name: '冷调', colors: from(COOL) },
  { id: 'contrast', name: '高对比', colors: from(CONTRAST) },
];

/** 解析某色板对某元素的颜色；未知名回退默认色板 → elements.ts */
export function resolveColor(el: string, setting: PaletteSetting | undefined): string {
  return (
    setting?.overrides?.[el] ??
    PALETTES.find((p) => p.id === setting?.id)?.colors[el] ??
    DEFAULT_COLORS[el] ??
    '#9AA0A6'
  );
}

/* ---------- active 状态（新组件创建时着色用） ---------- */

let active: PaletteSetting = {};

export function setActivePalette(p: PaletteSetting): void {
  active = p;
}

export function activeColorFor(el: string): string {
  return resolveColor(el, active);
}
