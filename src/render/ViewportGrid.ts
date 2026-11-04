/**
 * 三维透视网格（三维工作台升级 P0-A，2026-11-03）
 *
 * 世界空间水平面（XZ，Y-up，与 shadowGround 同向不同高——低 0.25Å 防 z-fighting）。
 * 单面片 + fragment shader：屏幕空间 fwidth 抗锯齿细/主线、相机距离自适应间距
 * （1-5-10 幂次阶梯，纯视觉参考，不改变任何科学单位）、径向渐隐 + 掠射角渐隐
 * （防地平线摩尔纹与密集闪烁）。DoubleSide 支持从下方观察。
 *
 * 编辑辅助元素红线：raycast 全禁（不参与拾取/放置命中）；不计入组件包围盒/
 * frameAll/统计；导出快照经 withEditorHelpersHidden 统一隐藏。
 */
import * as THREE from 'three';

/** 相机距离 → 网格基础间距（Å 视觉参考阶梯 10^n，下限 0.5Å；纯函数可单测） */
export function gridSpacingFor(camDistance: number): number {
  const d = Math.max(camDistance, 1);
  const step = Math.pow(10, Math.round(Math.log10(d / 12)));
  return Math.max(step, 0.5);
}

/** 主线每 N 条细线 */
export const MAJOR_EVERY = 10;

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  uniform float uOpacity;
  uniform float uSpacing;
  uniform vec3 uCamPos;
  uniform float uFadeStart;
  uniform float uFadeEnd;

  float gridLine(vec2 p, float spacing) {
    vec2 c = p / spacing;
    vec2 g = abs(fract(c - 0.5) - 0.5) * spacing;
    float fw = max(fwidth(c.x), fwidth(c.y)) * spacing;
    float line = min(g.x, g.y);
    return 1.0 - smoothstep(0.0, fw * 1.2, line);
  }

  void main() {
    vec2 p = vWorld.xz;
    float minor = gridLine(p, uSpacing);
    float major = gridLine(p, uSpacing * float(${MAJOR_EVERY}.0));

    // 径向渐隐（相机 XZ 距离）：远处趋零，防边缘截断与摩尔纹
    float dCam = distance(p, uCamPos.xz);
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dCam);
    // 掠射角渐隐：视线与平面夹角越小越淡（防地平线密集闪烁）
    vec3 viewDir = uCamPos - vWorld;
    float grazing = abs(normalize(viewDir).y);
    fade *= smoothstep(0.02, 0.18, grazing);

    float a = max(minor * 0.45, major * 0.9) * uOpacity * fade;
    vec3 col = mix(uMinor, uMajor, clamp(major * 0.9, 0.0, 1.0));
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export interface ViewportGridStyle {
  visible?: boolean;
  minorColor?: string;
  majorColor?: string;
  /** 0–1，整体不透明度系数 */
  opacity?: number;
}

export class ViewportGrid {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.PlaneGeometry;
  private y = 0;
  private lastSpacing = 0;

  constructor() {
    this.geo = new THREE.PlaneGeometry(4000, 4000);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMinor: { value: new THREE.Color('#c7ced8') },
        uMajor: { value: new THREE.Color('#a8b2c0') },
        uOpacity: { value: 0.75 },
        uSpacing: { value: 5 },
        uCamPos: { value: new THREE.Vector3() },
        uFadeStart: { value: 260 },
        uFadeEnd: { value: 1500 },
      },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2; // XZ 水平面（Y-up）
    this.mesh.renderOrder = -1; // 先于透明元素（阴影地板等）
    this.mesh.raycast = () => undefined; // 红线：绝不参与拾取/放置命中
    this.mesh.matrixAutoUpdate = false;
    this.updateMatrix();
  }

  /** 高度同步（编辑地面略下方，防 z-fighting；每帧由服务以缓存包围盒最低点喂入） */
  setHeight(y: number): void {
    if (Math.abs(y - this.y) < 0.01) return;
    this.y = y;
    this.updateMatrix();
  }

  private updateMatrix(): void {
    this.mesh.position.set(0, this.y, 0);
    this.mesh.updateMatrix();
  }

  /** 每帧：相机位置 → 距离自适应间距 + 渐隐 uniform（无几何重建） */
  update(camera: THREE.PerspectiveCamera): void {
    const dist = Math.hypot(camera.position.x, camera.position.z);
    const spacing = gridSpacingFor(dist);
    if (spacing !== this.lastSpacing) {
      this.lastSpacing = spacing;
      this.mat.uniforms.uSpacing.value = spacing;
    }
    (this.mat.uniforms.uCamPos.value as THREE.Vector3).copy(camera.position);
  }

  setStyle(style: ViewportGridStyle): void {
    if (style.visible !== undefined) this.mesh.visible = style.visible;
    if (style.minorColor) (this.mat.uniforms.uMinor.value as THREE.Color).set(style.minorColor);
    if (style.majorColor) (this.mat.uniforms.uMajor.value as THREE.Color).set(style.majorColor);
    if (style.opacity !== undefined) this.mat.uniforms.uOpacity.value = style.opacity;
  }

  getStyle(): ViewportGridStyle {
    return {
      visible: this.mesh.visible,
      opacity: this.mat.uniforms.uOpacity.value as number,
    };
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
