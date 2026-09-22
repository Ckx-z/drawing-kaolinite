/**
 * 拖拽吸附状态层（2026-09-22）：gizmo 松手时把重叠的小分子吸附到基底表面。
 *
 * 拖拽中仅检测+提示（性能约束：吸附变换只在释放执行）；Alt/Shift 按住时跳过
 * （自由放置）；吸附 = 一次 setTransform（attachHistory 天然一条 Undo =
 * 恢复自由放置的"解除吸附"路径）。AdsorptionRecord 内存态（不进 scene 文档：
 * 几何可由组件重演，schema 零升级）。
 */
import { sceneStore } from './sceneStore';
import { rendererRef } from './rendererRef';
import {
  atomsOverlap,
  boxOf,
  boxesOverlap,
  boxVolume,
  planSnap,
  worldAtoms,
  type SnapTransformInput,
} from '../core/surface/snap';

export interface AdsorptionRecord {
  id: string;
  adsorbateId: string;
  substrateId: string;
  surfacePoint: [number, number, number];
  surfaceNormal: [number, number, number];
  transformBefore: SnapTransformInput;
  transformAfter: SnapTransformInput;
}

export interface PendingSnap {
  adsorbateId: string;
  substrateId: string;
  substrateName: string;
}

let pending: PendingSnap | null = null;
const records: AdsorptionRecord[] = [];

/** 修饰键状态（SceneCanvas 键盘监听维护——Alt/Shift = 本轮跳过吸附） */
export const snapModifiers = { alt: false, shift: false };

export function getPendingSnap(): PendingSnap | null {
  return pending;
}

/** 清除待吸附态（拖拽结束/组件取消选中时） */
export function pendingClear(): void {
  pending = null;
}

/** 修饰键状态源（SceneCanvas 键盘监听写入） */
export const modifierState = { alt: false, shift: false };

export function getAdsorptionRecords(): readonly AdsorptionRecord[] {
  return records;
}

/**
 * 拖拽中检测（轻量：包围盒预筛 + 原子级确认）。返回是否处于"将吸附"状态。
 * 判定：拖拽组件（吸附质候选）与另一组件重叠；基底 = 体积较大方（任务书 1）。
 */
export function detectSnapOnDrag(adsorbateId: string): boolean {
  pending = null;
  const svc = rendererRef.current;
  const s = sceneStore.getState();
  const mol = s.components.find((c) => c.id === adsorbateId);
  if (!mol || mol.type !== 'molecule' || !svc) return false;
  const molGeo = svc.getComponentGeometry(adsorbateId);
  if (!molGeo) return false;
  const molWorld = worldAtoms(molGeo.atoms, mol.transform);
  const molBox = boxOf(molWorld);
  for (const other of s.components) {
    if (other.id === adsorbateId) continue;
    const geo = svc.getComponentGeometry(other.id);
    if (!geo) continue;
    const w = worldAtoms(geo.atoms, other.transform);
    // 入口判定：盒交 或 原子级重叠任一即可（贴面时分子盒可能在基底盒外但原子已近距）
    if (!boxesOverlap(molBox, boxOf(w)) && !atomsOverlap(molWorld, w)) continue;
    // 大小判定：体积大者为基底；同量级时任选其一为基底（另一必为 molecule）
    const sub = boxVolume(boxOf(w)) >= boxVolume(molBox) ? { comp: other, atoms: w } : { comp: mol, atoms: molWorld };
    const ads = sub.comp.id === other.id ? mol : other;
    if (ads.type !== 'molecule') continue; // 吸附质必须是分子
    if (!atomsOverlap(molWorld, w) && !boxesOverlap(molBox, boxOf(w))) continue;
    pending = { adsorbateId: ads.id, substrateId: sub.comp.id, substrateName: sub.comp.name };
    return true;
  }
  return false;
}

/**
 * 释放时执行吸附（onTransformChange 拦截调用）：返回写入 store 的 transform，
 * 或 null（无吸附 / 修饰键跳过）。吸附 = 质心贴最近表面原子 + 法向 vdW 推出
 * + clash 保证不穿透；朝向保持（不强制旋转）。执行后记录 AdsorptionRecord。
 */
export function applySnapOnRelease(adsorbateId: string, freeTransform: SnapTransformInput): SnapTransformInput | null {
  const svc = rendererRef.current;
  const s = sceneStore.getState();
  const pend = pending;
  pending = null;
  if (!pend || pend.adsorbateId !== adsorbateId) return null;
  if (snapModifiers.alt || snapModifiers.shift) return null; // 自由放置
  const sub = s.components.find((c) => c.id === pend.substrateId);
  const mol = s.components.find((c) => c.id === adsorbateId);
  const subGeo = svc?.getComponentGeometry(pend.substrateId);
  const molGeo = svc?.getComponentGeometry(adsorbateId);
  if (!sub || !mol || !subGeo || !molGeo) return null;
  const subWorld = worldAtoms(subGeo.atoms, sub.transform);
  const plan = planSnap(molGeo.atoms, freeTransform, subWorld);
  records.unshift({
    id: `snap-${Date.now()}`,
    adsorbateId,
    substrateId: pend.substrateId,
    surfacePoint: plan.surfacePoint,
    surfaceNormal: plan.surfaceNormal,
    transformBefore: { ...(mol.transform as SnapTransformInput) },
    transformAfter: { ...plan.transform },
  });
  if (records.length > 200) records.pop();
  return plan.transform;
}

/** 解除吸附：恢复该分子最近一次吸附前的 transform（走 setTransform = 一条 Undo） */
export function detachLastSnap(adsorbateId: string): SnapTransformInput | null {
  const r = records.find((x) => x.adsorbateId === adsorbateId);
  if (!r) return null;
  records.splice(records.indexOf(r), 1);
  return { ...r.transformBefore };
}
