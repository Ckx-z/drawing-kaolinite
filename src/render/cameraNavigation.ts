/**
 * 相机导航（三维工作台升级 P0-B，2026-11-03）
 *
 * 纯数学部分（viewDirection / stepDirection / easeInOutCubic / cubeMatrixForCamera）
 * Node 可单测；动画部分操作 RendererService 现有相机与 OrbitControls（不建第二套
 * 相机/控制），用户 pointerdown / 滚轮即接管取消，动画结束恢复阻尼绕轨。
 *
 * 方向约定与 postfx.presetDirection 同源：前=+Z、右=+X、顶=+Y（带微小 z 偏移
 * 规避万向锁，与既有「俯视」预设一致）。
 */

export type ViewDir = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** 六面方向单位向量（与 presetDirection 同约定；top/bottom 带 0.06 偏移防 gimbal） */
export function viewDirection(dir: ViewDir): [number, number, number] {
  switch (dir) {
    case 'front':
      return [0, 0, 1];
    case 'back':
      return [0, 0, -1];
    case 'left':
      return [-1, 0, 0];
    case 'right':
      return [1, 0, 0];
    case 'top':
      return normalize([0, 1, 0.06]);
    case 'bottom':
      return normalize([0, -1, 0.06]);
  }
}

/** 球面插值步进：单位向量 start→end 的 t 时刻方向（大圆弧，恒定视距） */
export function stepDirection(
  start: [number, number, number],
  end: [number, number, number],
  t: number,
): [number, number, number] {
  const dot = clamp(start[0] * end[0] + start[1] * end[1] + start[2] * end[2], -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-6) return [...end];
  if (omega > Math.PI - 1e-3) {
    // 对跖（180° 反向，如 前↔后）：经正交枢轴分两段四分之一弧，避免数值退化
    const axis: [number, number, number] = Math.abs(start[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const mid = normalize([
      start[1] * axis[2] - start[2] * axis[1],
      start[2] * axis[0] - start[0] * axis[2],
      start[0] * axis[1] - start[1] * axis[0],
    ]);
    return t < 0.5 ? stepDirection(start, mid, t * 2) : stepDirection(mid, end, (t - 0.5) * 2);
  }
  const so = Math.sin(omega);
  const w0 = Math.sin((1 - t) * omega) / so;
  const w1 = Math.sin(t * omega) / so;
  const v: [number, number, number] = [
    start[0] * w0 + end[0] * w1,
    start[1] * w0 + end[1] * w1,
    start[2] * w0 + end[2] * w1,
  ];
  return normalize(v);
}

/** 缓入缓出（t∈[0,1]） */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * ViewCube CSS 3D 变换（纯函数，六轴+斜视角数值实证）。
 *
 * 推导：视图旋转 V = q⁻¹（world→camera）。Three 相机空间 y 朝上，CSS 3D
 * y 朝下（像素坐标）——基变换 F = diag(1,−1,1) 共轭：M = F·V·F
 * （det = +1 仍为纯旋转）。六轴视角「被观察面 css z>0」与斜 45° 顶面朝上
 * 全部数值实证通过；front 视角恒等映射（文字不镜像）。返回 16 元列主序。
 */
export function cubeMatrixForCamera(quat: [number, number, number, number]): number[] {
  const [x, y, z, w] = quat;
  const l = Math.hypot(x, y, z, w) || 1;
  const qi = { x: -x / l, y: -y / l, z: -z / l, w: w / l }; // q⁻¹
  const { x: qx, y: qy, z: qz, w: qw } = qi;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  // V 的行（world→camera）
  const v = [
    [1 - (yy + zz), xy - wz, xz + wy],
    [xy + wz, 1 - (xx + zz), yz - wx],
    [xz - wy, yz + wx, 1 - (xx + yy)],
  ];
  const F = [1, -1, 1];
  // M = F·V·F
  const m: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] = F[i] * v[i][j] * F[j];
  // css matrix3d 列主序
  return [
    m[0][0], m[1][0], m[2][0], 0,
    m[0][1], m[1][1], m[2][1], 0,
    m[0][2], m[1][2], m[2][2], 0,
    0, 0, 0, 1,
  ];
}


function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/* ---------- 动画（操作 RendererService 现有相机/OrbitControls） ---------- */

export interface CameraAnimation {
  cancel: () => void;
  /** 是否仍在进行 */
  active: () => boolean;
}

/** 模块级当前动画句柄（ViewCube 卸载/模式切换时统一取消） */
let currentAnimation: CameraAnimation | null = null;

export function cancelCameraAnimation(): void {
  currentAnimation?.cancel();
  currentAnimation = null;
}

/**
 * 动画转到标准视角：保持 orbit.target 与视距（球面弧线插值方向），
 * ~260ms 缓入缓出；进行中用户 pointerdown/滚轮即取消（相机停在当前姿态，
 * OrbitControls 无缝接管，不会被"拉回去"）。svc.orbit 动画期间禁用。
 */
export function animateCameraToView(
  svc: import('./RendererService').RendererService,
  dir: ViewDir,
  durationMs = 260,
): CameraAnimation {
  const { camera, orbit } = svc;
  const target = orbit.target;
  const distance = camera.position.distanceTo(target);
  const startDir = normalize([
    camera.position.x - target.x,
    camera.position.y - target.y,
    camera.position.z - target.z,
  ]);
  const endDir = normalize(viewDirection(dir));

  let cancelled = false;
  let raf = 0;
  const rendererDom = svc.renderer.domElement;
  const onUserTakeover = (): void => {
    cancelled = true;
  };
  const cleanup = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
    rendererDom.removeEventListener('pointerdown', onUserTakeover, true);
    rendererDom.removeEventListener('wheel', onUserTakeover, true);
    orbit.enabled = true;
    if (currentAnimation === animation) currentAnimation = null;
  };
  rendererDom.addEventListener('pointerdown', onUserTakeover, { capture: true });
  rendererDom.addEventListener('wheel', onUserTakeover, { capture: true, passive: true });
  orbit.enabled = false;

  const animation: CameraAnimation = {
    cancel: () => {
      cancelled = true;
    },
    active: () => !cancelled && raf !== 0,
  };
  currentAnimation = animation;

  const step = (): void => {
    if (cancelled) {
      cleanup();
      return;
    }
    const t = easeInOutCubic((performance.now() - start) / durationMs);
    const dirNow = stepDirection(startDir, endDir, t);
    camera.position.set(
      target.x + dirNow[0] * distance,
      target.y + dirNow[1] * distance,
      target.z + dirNow[2] * distance,
    );
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    if (t >= 1) {
      cleanup();
      orbit.update();
      return;
    }
    raf = requestAnimationFrame(step);
  };
  const start = performance.now();
  raf = requestAnimationFrame(step);

  return animation;
}
