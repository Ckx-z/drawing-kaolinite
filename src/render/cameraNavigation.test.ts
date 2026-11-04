/**
 * 三维工作台升级纯数学测试（P0-B/P1，2026-11-03）
 *
 * - viewDirection：与 postfx.presetDirection 同约定（前=+Z、顶=+Y 微偏 z）
 * - stepDirection：球面大圆弧插值（端点保真、中点等角、恒定模长）
 * - cubeMatrixForCamera：M = diag(1,−1,1)·q⁻¹——六轴视角逐一验算
 *   「被点击面/正对面法线指向观察者（css z>0）」，斜 45° 验算顶面朝上
 * - gridSpacingFor：10^n 阶梯（单调、下限、粒度）
 * - appearance：预设基值解析 + 微调覆盖 + 颜色缺省保留元素色板
 */
import { describe, expect, it } from 'vitest';
import {
  cubeMatrixForCamera,
  easeInOutCubic,
  stepDirection,
  viewDirection,
} from './cameraNavigation';
import { gridSpacingFor } from './ViewportGrid';
import {
  APPEARANCE_PRESETS,
  applyAppearanceToMaterial,
  resolveAppearance,
  type MaterialLike,
} from './appearance';

/** 相机位于 target + dir*distance、lookAt target、up=+Y 时的四元数（手写推导） */
function lookQuaternion(dir: [number, number, number]): [number, number, number, number] {
  // forward f = -dir；与 postfx 同款 up=(0,1,0)
  const f = stepDirection([0, 0, -1], [dir[0], dir[1], dir[2]], 1).map((n) => -n) as [number, number, number];
  const norm = Math.hypot(f[0], f[1], f[2]);
  const fw: [number, number, number] = [f[0] / norm, f[1] / norm, f[2] / norm];
  const up: [number, number, number] = [0, 1, 0];
  // right = normalize(fw × up)…注意 three lookAt: z 轴 = -fw
  const zx = -fw[0], zy = -fw[1], zz = -fw[2];
  // x = up × z
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  // y = z × x
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  // 旋转矩阵（列 = x,y,z 轴）→ 四元数
  const m00 = xx, m10 = xy, m20 = xz;
  const m01 = yx, m11 = yy, m21 = yz;
  const m02 = zx, m12 = zy, m22 = zz;
  const trace = m00 + m11 + m22;
  let qw: number, qx: number, qy: number, qz: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qx, qy, qz, qw];
}

/** css 立方体某面的本地法线（css 坐标：y 下） */
const FACE_NORMALS = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, -1, 0], // css 顶面在 −y 侧（css y 朝下）
  bottom: [0, 1, 0],
} as const;

/** M·n（css matrix3d 列主序 × 向量，取方向分量） */
function applyMatrix(m: number[], n: readonly number[]): [number, number, number] {
  return [
    m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
    m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
    m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
  ];
}

describe('viewDirection（与 presetDirection 同约定）', () => {
  it('前/右/左为主轴单位向量；顶/底带 0.06 z 偏移且归一', () => {
    expect(viewDirection('front')).toEqual([0, 0, 1]);
    expect(viewDirection('back')).toEqual([0, 0, -1]);
    expect(viewDirection('right')).toEqual([1, 0, 0]);
    expect(viewDirection('left')).toEqual([-1, 0, 0]);
    const top = viewDirection('top');
    expect(top[1]).toBeGreaterThan(0.99);
    expect(top[2]).toBeGreaterThan(0);
    expect(Math.hypot(...top)).toBeCloseTo(1, 6);
    const bottom = viewDirection('bottom');
    expect(bottom[1]).toBeLessThan(-0.99);
  });
});

describe('stepDirection（球面弧线插值）', () => {
  const a: [number, number, number] = [0, 0, 1];
  const b: [number, number, number] = [1, 0, 0];

  it('端点保真 + 恒定单位模长', () => {
    expect(stepDirection(a, b, 0)).toEqual([0, 0, 1]);
    for (const t of [0.25, 0.5, 0.75]) {
      const v = stepDirection(a, b, t);
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    }
    const end = stepDirection(a, b, 1);
    expect(end[0]).toBeCloseTo(1, 9);
  });

  it('中点等角（90° 弧中点与两端各 45°）', () => {
    const mid = stepDirection(a, b, 0.5);
    expect(mid[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(mid[2]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('对跖方向（前↔后 180°）经枢轴弧安全过渡：模长恒 1、端点正确', () => {
    const a: [number, number, number] = [0, 0, 1];
    const b: [number, number, number] = [0, 0, -1];
    for (const t of [0.25, 0.5, 0.75]) {
      const v = stepDirection(a, b, t);
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    }
    const end = stepDirection(a, b, 1);
    expect(end[2]).toBeCloseTo(-1, 9);
  });
});

describe('easeInOutCubic', () => {
  it('端点 0/1、中点 0.5、单调', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    let prev = -1;
    for (let t = 0; t <= 1.001; t += 0.05) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('cubeMatrixForCamera（六轴视角：被观察面法线指向观察者 css z>0）', () => {
  const cases: Array<[keyof typeof FACE_NORMALS, Parameters<typeof viewDirection>[0]]> = [
    ['front', 'front'],
    ['back', 'back'],
    ['right', 'right'],
    ['left', 'left'],
    ['top', 'top'],
    ['bottom', 'bottom'],
  ];
  it.each(cases)('相机位于 %s → 该面可见（css z>0.99）', (face, dir) => {
    const q = lookQuaternion(viewDirection(dir));
    const m = cubeMatrixForCamera(q);
    const n = applyMatrix(m, FACE_NORMALS[face]);
    expect(n[2]).toBeGreaterThan(0.99);
    // 恒为显示变换（w 行不产生透视畸变）
    expect(m[15]).toBe(1);
  });

  it('正面视角时文字不镜像（front 面局部 x 轴映射到屏幕右 = css +x）', () => {
    const q = lookQuaternion(viewDirection('front'));
    const m = cubeMatrixForCamera(q);
    const xAxis = applyMatrix(m, [1, 0, 0]);
    expect(xAxis[0]).toBeGreaterThan(0.99);
  });

  it('斜 45°（前上之间）：顶面可见且朝屏幕上方（css y<0），前面可见', () => {
    const dir = stepDirection(viewDirection('front'), viewDirection('top'), 0.5);
    const q = lookQuaternion(dir);
    const m = cubeMatrixForCamera(q);
    const topN = applyMatrix(m, FACE_NORMALS.top);
    const frontN = applyMatrix(m, FACE_NORMALS.front);
    expect(topN[2]).toBeGreaterThan(0.3);
    expect(topN[1]).toBeLessThan(-0.3); // 屏幕上方 = css −y
    expect(frontN[2]).toBeGreaterThan(0.3);
  });
});

describe('gridSpacingFor（10^n 阶梯，纯视觉不改科学单位）', () => {
  it('近距细网格、远距粗网格、单调不减、下限 0.5', () => {
    expect(gridSpacingFor(1)).toBe(0.5);
    const ladder = [2, 15, 40, 120, 400, 1200, 4000].map(gridSpacingFor);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1]!);
    for (const v of ladder) expect(v).toBeGreaterThanOrEqual(0.5);
    // 阶梯值均为 10^n 形态（0.5 为显式下限豁免）
    for (const v of ladder) {
      if (v === 0.5) continue;
      const e = Math.log10(v);
      expect(Math.abs(e - Math.round(e))).toBeLessThan(1e-9);
    }
  });
});

describe('appearance（视觉预设：非科学物性，元素色默认保留）', () => {
  it('预设解析出基值；微调覆盖预设', () => {
    const glass = resolveAppearance({ preset: 'glass' });
    expect(glass.roughness).toBe(APPEARANCE_PRESETS.glass.roughness);
    expect(glass.transparent).toBe(true);
    const tuned = resolveAppearance({ preset: 'metal', roughness: 0.5, opacity: 0.9 });
    expect(tuned.roughness).toBe(0.5);
    expect(tuned.opacity).toBeCloseTo(0.9);
    expect(tuned.transparent).toBe(true);
  });

  it('default 预设 = 项目原期刊质感（materials.ts 同源数值）', () => {
    const d = APPEARANCE_PRESETS.default;
    expect(d.roughness).toBe(0.42);
    expect(d.metalness).toBe(0);
    expect(d.opacity).toBe(1);
  });

  it('套用只写声明参数；未开整体着色时 color 不动（元素色板保留）', () => {
    const mat: MaterialLike = {
      roughness: 0.42, metalness: 0, opacity: 1, transparent: false,
      clearcoat: 0.4, envMapIntensity: 0.9, needsUpdate: false, color: '#ffffff',
    };
    applyAppearanceToMaterial(mat, resolveAppearance({ preset: 'metal' }));
    expect(mat.metalness).toBeCloseTo(0.9);
    expect(mat.color).toBe('#ffffff'); // 元素色未被触碰
    expect(mat.needsUpdate).toBe(true);
    applyAppearanceToMaterial(mat, resolveAppearance({ preset: 'gel', colorOverride: '#336699' }));
    expect(mat.color).toBe('#336699');
    expect(mat.transparent).toBe(true);
  });
});
