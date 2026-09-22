/**
 * 吸附候选 UI 状态（2026-09-21 产品闭环）：独立 zustand store——预览数据，
 * 不是 Scene components，不进 Undo/LayerPanel/Template/Export。
 * 只有 apply() 才经 sceneStore.addComponent 改变场景（一条 Undo）。
 * generate 用 params+CIF 确定性重建 slab（主线程轻量，任务书七十一），零随机。
 */
import { create } from 'zustand';
import { buildMolecule } from '../core/builders';
import { mineralOf } from '../core/minerals';
import { buildMillerSlab } from '../core/surface/slab';
import { applySurfaceDefects, surfaceSiteKey } from '../core/builders';
import { eulerDegToMatrix, generateAdsorptionCandidates, matrixToEulerDeg, type AdsiteKind, type AdsorbCandidate } from '../core/surface/adsorb';
import type { Transform } from '../core/types';
import type { CrystalSurfaceParams } from '../core/types';
import { sceneStore } from './sceneStore';

interface SurfaceSnapshot {
  compId: string;
  mineral: string;
  h: number;
  k: number;
  l: number;
  sizeX: number;
  sizeY: number;
  thickness: number;
  termination: number;
}

interface AdsorptionState {
  surface: SurfaceSnapshot | null;
  adsorbate: string;
  site: AdsiteKind;
  distance: number;
  candidates: AdsorbCandidate[];
  activeIndex: number;
  generate: (compId: string, params: CrystalSurfaceParams) => AdsorbCandidate[];
  setActive: (i: number) => void;
  apply: () => string | null;
  clear: () => void;
}

const snapshotOf = (compId: string, p: CrystalSurfaceParams): SurfaceSnapshot => ({
  compId,
  mineral: String(p.mineral ?? 'ceo2'),
  h: p.h,
  k: p.k,
  l: p.l,
  sizeX: p.sizeX,
  sizeY: p.sizeY,
  thickness: p.thickness,
  termination: p.termination ?? 0,
});

export const useAdsorptionStore = create<AdsorptionState>((set, get) => ({
  surface: null,
  adsorbate: 'C₇H₈',
  site: 'top',
  distance: 3.0,
  candidates: [],
  activeIndex: 0,
  generate: (compId, p) => {
    const { adsorbate, site, distance } = get();
    // 2026-09-22c（Gate 3）：吸附引擎使用 defected 几何——同一 siteKey 删除规则
    // 与 buildCrystalSurface 完全一致（UI 有空位，算法读同一原子集）
    const slab0 = buildMillerSlab(mineralOf(String(p.mineral ?? 'ceo2')).cifText, {
      h: p.h, k: p.k, l: p.l,
      sizeX: p.sizeX, sizeY: p.sizeY,
      thickness: p.thickness,
      termination: p.termination ?? 0,
    });
    const defects = (p as { defects?: Array<{ siteKey: string; element: string; originalPosition: [number, number, number] }> }).defects ?? [];
    const applied = applySurfaceDefects(slab0, defects);
    void surfaceSiteKey;
    const surf = { ...slab0, atoms: applied.atoms, bonds: applied.bonds, vacancies: defects.map((d) => d.originalPosition) };
    const mol = buildMolecule(adsorbate as never);
    const candidates = generateAdsorptionCandidates(surf, mol, site, distance, adsorbate);
    set({ surface: snapshotOf(compId, p), candidates, activeIndex: 0 });
    return candidates;
  },
  setActive: (i) => set({ activeIndex: i }),
  apply: () => {
    const { surface, adsorbate, candidates, activeIndex } = get();
    const cand = candidates[activeIndex];
    if (!surface || !cand) return null;
    const id = sceneStore.getState().addComponent('molecule', {
      name: `${adsorbate}@${surface.mineral}(${surface.h}${surface.k}${surface.l})`,
      params: { kind: adsorbate as never },
      transform: worldCandidateTransform(cand, sceneStore.getState().components.find((c) => c.id === surface.compId)?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }),
    });
    set({ candidates: [], activeIndex: 0 });
    return id;
  },
  clear: () => set({ surface: null, candidates: [], activeIndex: 0 }),
}));

const matApply = (R: number[][], v: [number, number, number]): [number, number, number] => [
  R[0]![0]! * v[0] + R[0]![1]! * v[1] + R[0]![2]! * v[2],
  R[1]![0]! * v[0] + R[1]![1]! * v[1] + R[1]![2]! * v[2],
  R[2]![0]! * v[0] + R[2]![1]! * v[1] + R[2]![2]! * v[2],
];
const matMul = (A: number[][], B: number[][]): number[][] =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i]![0]! * B[0]![j]! + A[i]![1]! * B[1]![j]! + A[i]![2]! * B[2]![j]!));

/**
 * 候选局部 pose × surface transform → 世界 pose（Scale→Rotate→Translate，与
 * Renderer/THREE.Euler('XYZ') 同序——任务书十三）。Transform.scale 为均匀标量：
 * 视觉缩放语义——候选随表面同缩放（分子组件 scale=s），局部科学距离（UI 显示的
 * Å 值）不变；世界最近距离 = s × 局部 minDistance。无放缩时 minDistance 不变量守恒。
 */
export function worldCandidateTransform(
  cand: AdsorbCandidate,
  surfT: Transform,
): { position: [number, number, number]; rotation: [number, number, number]; scale: number } {
  const s = surfT.scale;
  const Rs = eulerDegToMatrix(surfT.rotation);
  const Rm = eulerDegToMatrix(cand.rotation);
  const Rw = matMul(Rs, Rm);
  const Tm = cand.position;
  return {
    position: [
      surfT.position[0] + s * (Rs[0]![0]! * Tm[0] + Rs[0]![1]! * Tm[1] + Rs[0]![2]! * Tm[2]),
      surfT.position[1] + s * (Rs[1]![0]! * Tm[0] + Rs[1]![1]! * Tm[1] + Rs[1]![2]! * Tm[2]),
      surfT.position[2] + s * (Rs[2]![0]! * Tm[0] + Rs[2]![1]! * Tm[1] + Rs[2]![2]! * Tm[2]),
    ],
    rotation: matrixToEulerDeg(Rw),
    scale: s,
  };
}

/** 候选世界原子（预览用：reference 原子按世界 pose 放置；未 Apply 仍是 UI 态） */
export function worldCandidateAtoms(
  cand: AdsorbCandidate,
  adsorbateKind: string,
  surfT: Transform,
): { atoms: typeof cand.atoms; bonds: typeof cand.bonds } {
  const raw = buildMolecule(adsorbateKind as never); // reference molecule 零修改（任务书二十五）
  const pose = worldCandidateTransform(cand, surfT);
  const R = eulerDegToMatrix(pose.rotation);
  const atoms = raw.atoms.map((a) => {
    const r = matApply(R, [a.x, a.y, a.z]);
    return { el: a.el, label: a.label, x: r[0]! * pose.scale + pose.position[0], y: r[1]! * pose.scale + pose.position[1], z: r[2]! * pose.scale + pose.position[2] };
  });
  return { atoms, bonds: raw.bonds.map((b) => [...b] as never) };
}

/** 命令式清理入口（模板打开/清空/场景载入三挂点 + AdsorptionSection 失效） */
export function clearAdsorption(): void {
  useAdsorptionStore.getState().clear();
}
