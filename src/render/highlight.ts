/**
 * 拾取高亮 / 悬停反馈 —— T-7.1
 *
 * 视觉方案：反转法线外壳（BackSide 纯色），与 T-4.1 线稿档描边（1.07）分层共存：
 *   悬停 = 淡橙 1.10；选中 = 橙 1.14。外壳惰性创建、按状态切换可见性，不触碰几何。
 * 悬停状态机：hoverStore（vanilla store，UI 与渲染层共用）——
 *   画布 pointermove（BBox 级轻量拾取）与图层面板行悬停双向写入，
 *   两侧 UI 与渲染高亮同时联动（验收：双向联动正确、帧率无感损耗）。
 * 说明：外壳仅覆盖原子网格；橡胶基底（挤出几何）无外壳，反馈走图层面板联动。
 */
import * as THREE from 'three';
import { createStore } from 'zustand/vanilla';

export type HighlightState = 'none' | 'hover' | 'selected';

/* ---------- 悬停状态（画布 ↔ 图层面板双向联动） ---------- */

export interface HoverState {
  id: string | null;
  setHover: (id: string | null) => void;
}

export const hoverStore = createStore<HoverState>()((set) => ({
  id: null,
  setHover: (id) => set({ id: id === null ? null : id }),
}));

/* ---------- 外壳材质与创建 ---------- */

export const hoverShellMaterial = new THREE.MeshBasicMaterial({
  color: 0xffc46b, // 淡橙
  side: THREE.BackSide,
  transparent: true,
  opacity: 0.85,
});

export const selectShellMaterial = new THREE.MeshBasicMaterial({
  color: 0xe59a20, // 描边线默认色（场景配置可改，参考科图网 rgb(229,154,32)）
  side: THREE.BackSide,
  transparent: true,
  opacity: 0.85,
});

/**
 * 选中描边线外观配置（场景 Tab·描边线区，2026-11-04）：
 * enabled=false 时选中外壳隐藏；scale=轮廓厚度系数；glow=外壳不透明度。
 * 由 RendererService.setSelectionOutlineStyle 写入并触发外壳重建。
 */
export interface SelectionOutlineConfig {
  enabled: boolean;
  color: string;
  scale: number;
  glow: number;
}

let selectionOutline: SelectionOutlineConfig = {
  enabled: true,
  color: '#e59a20',
  scale: 1.15,
  glow: 0.85,
};

export function setSelectionOutlineConfig(cfg: Partial<SelectionOutlineConfig>): void {
  selectionOutline = { ...selectionOutline, ...cfg };
  if (cfg.color) selectShellMaterial.color.set(cfg.color).convertSRGBToLinear();
  selectShellMaterial.opacity = selectionOutline.glow;
  selectShellMaterial.transparent = selectionOutline.glow < 0.999;
  selectShellMaterial.needsUpdate = true;
}

export function getSelectionOutlineConfig(): SelectionOutlineConfig {
  return { ...selectionOutline };
}

const SHELL_SCALE: Record<Exclude<HighlightState, 'none'>, number> = {
  hover: 1.1,
  selected: 1.15, // 初始值；实际创建时按 selectionOutline.scale
};

/**
 * 从原子实例网格创建高亮外壳（复制实例矩阵并整体放大，BackSide 纯色）。
 * raycast 置空：外壳不参与任何拾取。
 */
export function createHighlightShell(
  src: THREE.InstancedMesh,
  state: Exclude<HighlightState, 'none'>,
): THREE.InstancedMesh {
  const material = state === 'selected' ? selectShellMaterial : hoverShellMaterial;
  const scale = state === 'selected' ? selectionOutline.scale : SHELL_SCALE.hover;
  const shell = new THREE.InstancedMesh(src.geometry, material, src.count);
  shell.userData.highlight = state;
  shell.raycast = () => undefined;
  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  for (let k = 0; k < src.count; k++) {
    src.getMatrixAt(k, mtx);
    mtx.decompose(pos, quat, scl);
    scl.multiplyScalar(scale);
    mtx.compose(pos, quat, scl);
    shell.setMatrixAt(k, mtx);
  }
  shell.visible = false;
  return shell;
}

/** 读取网格上的外壳（按状态）；不存在返回 undefined */
export function findShell(group: THREE.Group, state: Exclude<HighlightState, 'none'>): THREE.Object3D | undefined {
  return group.children.find((c) => c.userData.highlight === state);
}
