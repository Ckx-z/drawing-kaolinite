/**
 * 视觉外观预设（三维工作台升级 P1 材质 Tab，2026-11-03）
 *
 * 定位红线：这些是**视觉外观**（渲染质感），不是科学材料物性、不声称任何
 * 真实模拟；元素色板/原子-键的科学辨识性默认完整保留（仅可选整体着色）。
 * 应用对象 = 组件级材质克隆（RendererService.setComponentAppearance），
 * 绝不改 materials.ts 的全局共享 atomMaterial/bondMaterial。
 * 会话级状态：不写入场景文件（P2 再做持久化——任务书允许分阶段）。
 * 本模块纯数据 + 纯函数（plain object 即可单测，零 three 依赖）。
 */

export type AppearancePreset = 'default' | 'metal' | 'glass' | 'liquid' | 'gel';

export interface AppearanceParams {
  preset: AppearancePreset;
  /** 可选整体着色（hex 字符串）；缺省 = 保留元素色板 */
  colorOverride?: string | null;
  roughness?: number;
  metalness?: number;
  opacity?: number;
}

export interface ResolvedAppearance {
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  /** 玻璃/凝胶增强项 */
  clearcoat: number;
  envMapIntensity: number;
  colorOverride: string | null;
}

/** 预设基值（默认 = 项目期刊质感原值，materials.ts 同源） */
export const APPEARANCE_PRESETS: Record<AppearancePreset, Omit<ResolvedAppearance, 'colorOverride'>> = {
  default: { roughness: 0.42, metalness: 0.0, opacity: 1.0, transparent: false, clearcoat: 0.4, envMapIntensity: 0.9 },
  metal: { roughness: 0.28, metalness: 0.9, opacity: 1.0, transparent: false, clearcoat: 0.1, envMapIntensity: 1.2 },
  glass: { roughness: 0.08, metalness: 0.0, opacity: 0.42, transparent: true, clearcoat: 0.6, envMapIntensity: 1.4 },
  liquid: { roughness: 0.12, metalness: 0.05, opacity: 0.78, transparent: true, clearcoat: 0.8, envMapIntensity: 1.1 },
  gel: { roughness: 0.55, metalness: 0.0, opacity: 0.62, transparent: true, clearcoat: 0.9, envMapIntensity: 0.8 },
};

/** 预设 + 用户微调 → 最终材质参数（微调值覆盖预设；default 预设 = 原质感） */
export function resolveAppearance(params: AppearanceParams): ResolvedAppearance {
  const base = APPEARANCE_PRESETS[params.preset] ?? APPEARANCE_PRESETS.default;
  return {
    roughness: params.roughness ?? base.roughness,
    metalness: params.metalness ?? base.metalness,
    opacity: params.opacity ?? base.opacity,
    transparent: (params.opacity ?? base.opacity) < 0.999,
    clearcoat: base.clearcoat,
    envMapIntensity: base.envMapIntensity,
    colorOverride: params.colorOverride ?? null,
  };
}

/** 目标材质形状（MeshPhysicalMaterial 子集；plain object 可单测） */
export interface MaterialLike {
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  clearcoat: number;
  envMapIntensity: number;
  needsUpdate: boolean;
  /** sRGB hex 字符串（实现层转 THREE.Color） */
  color?: string;
}

/** 把解析结果套到材质（纯函数式：只写传入对象；color 缺省不动 = 元素色保留） */
export function applyAppearanceToMaterial(mat: MaterialLike, resolved: ResolvedAppearance): void {
  mat.roughness = resolved.roughness;
  mat.metalness = resolved.metalness;
  mat.opacity = resolved.opacity;
  mat.transparent = resolved.transparent;
  mat.clearcoat = resolved.clearcoat;
  mat.envMapIntensity = resolved.envMapIntensity;
  if (resolved.colorOverride) mat.color = resolved.colorOverride;
  mat.needsUpdate = true;
}
