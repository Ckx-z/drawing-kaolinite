/**
 * 渲染视觉常量（2026-09-19 集中管理）——此前 0.95/0.92/0.16 散落
 * instanced.ts / RendererService（原子球 ×2 处 + SVG 半径 + 键半径 ×2 处）。
 *
 * 球棍比例修正背景：cov×0.95 的原子球几乎覆盖整根键（C–C 1.52Å vs
 * 两球半径和 0.95×(0.76+0.76)=1.44Å），画面接近空间填充而非 ball-and-stick。
 * 调整为 Chem3D/Jmol 风比例：球更小、棍细而修长；center-to-center 圆柱
 * 两端各入球 overlap，消除球-棍接缝（纯渲染重叠，不改原子中心距——
 * 键长/键角测量不受影响）。
 */
import { getElement } from '../core/elements';

/** 空间填充：vdW × 0.92（保持不变，禁止与球棍混轨） */
export const SPACE_FILLING_VDW_SCALE = 0.92;
/** 球棍原子球：cov × 0.42（2026-09-19：0.95 → 0.42） */
export const BALL_STICK_ATOM_SCALE = 0.42;
/** 球棍键圆柱半径（Å；2026-09-19b：0.13 → 0.12） */
export const BALL_STICK_BOND_RADIUS = 0.12;
/** 键圆柱两端入球重叠（Å/端）：球-棍无缝，不改变化学长度 */
export const BALL_STICK_BOND_OVERLAP = 0.1;
/**
 * 球棍原子球下限（Å）：H cov 0.31×0.42=0.130 若无下限将与键半径同量级，
 * 视觉退化为"圆柱末端白帽子"。max(cov×scale, 0.20) → H=0.20 / C=0.319 /
 * bond=0.12，H/bond ≈ 1.67——H 明确为球。通用规则不特判 H（cov×0.42 < 0.20
 * 仅 H 与 He，后者不出现于任何素材，矿物最小元素 O 0.66×0.42=0.277 不受钳制）。
 */
export const BALL_STICK_MIN_ATOM_RADIUS = 0.2;

/** 元素显示半径（3D InstancedMesh 与 SVG 导出同源） */
export function displayRadius(el: string, ballstick: boolean): number {
  const info = getElement(el);
  if (ballstick) {
    const cov = info?.cov ?? 1;
    return Math.max(cov * BALL_STICK_ATOM_SCALE, BALL_STICK_MIN_ATOM_RADIUS);
  }
  return (info?.vdw ?? 1.6) * SPACE_FILLING_VDW_SCALE;
}
