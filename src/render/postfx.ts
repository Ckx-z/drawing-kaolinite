/**
 * 后处理与构图辅助 —— T-4.3
 *
 * 选型说明（对 TODO 原文"SSAO 后处理或廉价接触阴影"二选一）：采用**廉价接触阴影**
 * ——方向光 shadow map（PCFSoft）+ ShadowMaterial 接影地板。理由：SSAO 多 pass
 * 在 16k 实例原子场景下 60fps 风险高（验收红线），而 shadow map 每帧仅多一次
 * 深度绘制（与主渲染同量级），且接触阴影正是 M1 参考样图的审美。
 *
 * 构图预设：等距 / 正视 / 俯视 / 复位——保持当前视距，仅改变方位角/俯仰角
 * （presetDirection 纯函数，Node 可单测）。水平线吸附 = 相机降到与目标同高
 * （视线水平，画面地平线自然水平——OrbitControls 本身无滚转）。
 */

export type CameraPreset = 'iso' | 'front' | 'top' | 'reset';

/** 各预设的取景方向单位向量（top 用微小的 z 分量规避万向锁） */
export function presetDirection(preset: CameraPreset): [number, number, number] {
  switch (preset) {
    case 'iso':
      return normalize([1, 0.82, 1]);
    case 'front':
      return [0, 0, 1];
    case 'top':
      return normalize([0, 1, 0.06]);
    case 'reset':
      return normalize([150, 110, 190]);
  }
}

/**
 * 相机预设算位（纯函数）：目标点 target、视距 distance → 新相机位置。
 * 视距保持不变（只转方位，不推拉）。
 */
export function presetPosition(
  preset: CameraPreset,
  target: [number, number, number],
  distance: number,
): [number, number, number] {
  const d = normalize(presetDirection(preset));
  return [target[0] + d[0] * distance, target[1] + d[1] * distance, target[2] + d[2] * distance];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
