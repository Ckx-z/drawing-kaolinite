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
import { generateAdsorptionCandidates, type AdsiteKind, type AdsorbCandidate } from '../core/surface/adsorb';
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
    const slab = buildMillerSlab(mineralOf(String(p.mineral ?? 'ceo2')).cifText, {
      h: p.h, k: p.k, l: p.l,
      sizeX: p.sizeX, sizeY: p.sizeY,
      thickness: p.thickness,
      termination: p.termination ?? 0,
    });
    const mol = buildMolecule(adsorbate as never);
    const candidates = generateAdsorptionCandidates(slab, mol, site, distance, adsorbate);
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
      transform: { position: cand.position, rotation: cand.rotation, scale: 1 },
    });
    set({ candidates: [], activeIndex: 0 });
    return id;
  },
  clear: () => set({ surface: null, candidates: [], activeIndex: 0 }),
}));

/** 命令式清理入口（模板打开/清空/场景载入三挂点 + AdsorptionSection 失效） */
export function clearAdsorption(): void {
  useAdsorptionStore.getState().clear();
}
