/**
 * V2 交互升级 —— 快捷键冲突防护 + M3 科研闭环（store 级）
 *
 * 闭环链路：甲苯资产检索 → 拖放置换（dragPlace + 假渲染件）→ gizmo 语义变换 →
 * 拖拽吸附引擎（detect + apply，CeO₂ 真实 slab 几何）→ 逐条 Undo 全回退 →
 * 模板 roundtrip 复现（组件数与 transform 保持）。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { buildCrystalSurface, buildMolecule } from '../core/builders';
import { MINERALS } from '../core/minerals';
import { createAssetComponent, searchAssets } from '../core/assets/assetSearch';
import { attachHistory } from '../state/history';
import { rendererRef } from '../state/rendererRef';
import { sceneStore, sceneHistory } from '../state/sceneStore';
import * as dragSnap from '../state/dragSnap';
import { worldAtoms } from '../core/surface/snap';
import { beginSpecDrag, finishAssetDrag, updateAssetDrag } from './dragPlace';
import { SHORTCUTS } from './shortcuts';

describe('快捷键注册表（G/E/S/F 新增不冲突）', () => {
  it('（key × mod × shift）组合全表唯一——未来新增再撞车会在本测试爆', () => {
    const seen = new Set<string>();
    for (const s of SHORTCUTS) {
      const k = `${s.mod ?? 'none'}|${s.shift ? 'shift' : '-'}|${s.key}`;
      expect(seen.has(k), `冲突组合：${k}（${s.label}）`).toBe(false);
      seen.add(k);
    }
  });

  it('G/E/S 三档 gizmo 与 F/Shift+F 取景已注册且需要选中态', () => {
    const find = (key: string, shift = false): (typeof SHORTCUTS)[number] | undefined =>
      SHORTCUTS.find((s) => s.key === key && s.mod === 'none' && !!s.shift === shift);
    expect(find('g')?.label).toContain('移动');
    expect(find('e')?.label).toContain('旋转');
    expect(find('s')?.label).toContain('缩放');
    expect(find('f')?.needsSelection).toBe(true);
    expect(find('f', true)?.label).toContain('适配');
  });
});

/* ---------- M3 闭环 ---------- */

const SURF = { mineral: 'ceo2', h: 1, k: 1, l: 1, sizeX: 14, sizeY: 14, thickness: 9, termination: 0, style: '球棍' } as const;
const TOLUENE = buildMolecule('C₇H₈');
const SURF_GEO = buildCrystalSurface(MINERALS.ceo2.cifText, { ...SURF });

function fakeSvc(point: [number, number, number] | null, geos: Record<string, { atoms: typeof TOLUENE.atoms }> = {}): unknown {
  return {
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }) } },
    camera: { position: { toArray: () => [150, 110, 190], set: () => {} }, lookAt: () => {}, updateProjectionMatrix: () => {} },
    orbit: { target: { toArray: () => [0, 0, 0], set: () => {} }, update: () => {} },
    previewGeometry: () => Promise.resolve({ atoms: TOLUENE.atoms, bonds: TOLUENE.bonds }),
    setPlacementPreview: () => {},
    movePlacementPreview: () => {},
    hidePlacementPreview: () => {},
    clearPlacementPreview: () => {},
    pickPlacementPoint: () => point,
    getComponentGeometry: (id: string) => (geos[id] ? { atoms: geos[id]!.atoms, bonds: [] } : null),
    tc: { dragging: true },
    getSelectedId: () => null,
    setHover: () => {},
  };
}

beforeEach(() => {
  for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
  while (sceneHistory.undo()) { /* 清历史残留 */ }
  dragSnap.pendingClear();
  dragSnap.snapModifiers.alt = false;
  dragSnap.snapModifiers.shift = false;
});

describe('M3 科研闭环：搜索 → 拖放 → 变换 → 吸附 → Undo → 模板复现', () => {
  it('甲苯资产可检索且工厂给出 molecule 规格', () => {
    const hits = searchAssets('甲苯');
    expect(hits.length).toBeGreaterThan(0);
    const spec = createAssetComponent(hits[0]!.id);
    expect(spec?.componentType).toBe('molecule');
  });

  it('全链路：拖放置换于表面上方 → 吸附引擎贴合 → 两条 Undo 全回退', async () => {
    // ① 表面组件（真实 CeO₂(111) slab，恒等变换）
    const surfId = sceneStore.getState().addComponent('crystal_surface', { params: { ...SURF } });
    const surf = { [surfId]: { atoms: SURF_GEO.atoms } };
    const surfZ = Math.max(...SURF_GEO.atoms.map((a) => a.z));

    // ② 甲苯拖放到表面正上方（dragPlace + 指定拾取点）
    const spec = createAssetComponent(searchAssets('甲苯')[0]!.id)!;
    rendererRef.current = fakeSvc([0, 0, surfZ + 8], surf) as never;
    beginSpecDrag(spec);
    await Promise.resolve(); // 几何预构建微任务
    updateAssetDrag(400, 300);
    const molId = finishAssetDrag()!;
    expect(sceneStore.getState().components).toHaveLength(2);
    expect(sceneStore.getState().selectionId).toBe(molId);
    // 检测阶段换上含分子几何的假件（detect/apply 均经 getComponentGeometry 取世界原子）
    rendererRef.current = fakeSvc([0, 0, surfZ + 8], { ...surf, [molId]: { atoms: TOLUENE.atoms } }) as never;

    // ③ gizmo 语义变换：下压到与表面重叠（一条 setTransform）
    const mol = sceneStore.getState().components.find((c) => c.id === molId)!;
    const dragged = { ...mol.transform, position: [0, 0, surfZ + 1] as [number, number, number] };
    sceneStore.getState().setTransform(molId, dragged);

    // ④ 拖拽吸附：检测命中 CeO₂ 基底，松手 apply = 质心贴面 + vdW 推出（一条 setTransform）
    expect(dragSnap.detectSnapOnDrag(molId)).toBe(true);
    const free = sceneStore.getState().components.find((c) => c.id === molId)!.transform;
    const snapped = dragSnap.applySnapOnRelease(molId, free as never);
    expect(snapped).toBeTruthy();
    sceneStore.getState().setTransform(molId, snapped as never);
    // 科学不变量：吸附后分子世界原子最低点不低于 slab 底面（无穿透）；
    // 且贴合确实发生（transform 与自由拖放值不同）。甲苯默认 scale=4、半径大，
    // 质心高度依构象而变——不写死位置区间，锁「不穿透 + 真吸附」。
    const snappedT = sceneStore.getState().components.find((c) => c.id === molId)!.transform;
    expect(snappedT.position).not.toEqual(free.position);
    const molWorldZ = worldAtoms(TOLUENE.atoms, snappedT).map((a) => a.z);
    const slabMinZ = Math.min(...SURF_GEO.atoms.map((a) => a.z));
    expect(Math.min(...molWorldZ)).toBeGreaterThan(slabMinZ - 0.5);

    // ⑤ 逐条 Undo 全回退：吸附/下压/放置/表面至少各一条（同窗合并可能并条），
    // 终态 = 空场景（历史合并语义不改变可完全回退的事务性）
    let undoN = 0;
    while (sceneHistory.undo()) undoN++;
    expect(undoN).toBeGreaterThanOrEqual(3);
    expect(sceneStore.getState().components).toHaveLength(0);
  });

  it('模板 roundtrip：放置 + 吸附后的甲苯随场景存取精确复现', async () => {
    const surfId = sceneStore.getState().addComponent('crystal_surface', { params: { ...SURF } });
    const surf = { [surfId]: { atoms: SURF_GEO.atoms } };
    rendererRef.current = fakeSvc([3, -2, 20], surf) as never;
    beginSpecDrag(createAssetComponent(searchAssets('甲苯')[0]!.id)!);
    await Promise.resolve();
    updateAssetDrag(400, 300);
    const molId = finishAssetDrag()!;
    sceneStore.getState().setTransform(molId, { position: [3, -2, 11], rotation: [0, 30, 0], scale: 4 });

    const doc = sceneStore.getState().toSceneDocument();
    const t = doc.components.find((c) => c.id === molId)!;
    expect(t.transform.position).toEqual([3, -2, 11]);
    expect(t.transform.rotation).toEqual([0, 30, 0]);
    // 载入复现（normalizeScene 会重生成 id，按名称+变换比对）
    const ok = sceneStore.getState().loadScene(JSON.stringify(doc));
    expect(ok).toBe(true); // 相机快照路径
    const back = sceneStore.getState().components.find((c) => c.name === t.name)!;
    expect(back.transform.position).toEqual([3, -2, 11]);
    expect(back.transform.rotation).toEqual([0, 30, 0]);
    expect((back.params as Record<string, unknown>).kind).toBe((t.params as Record<string, unknown>).kind);
  });
});

/** attachHistory 类型引用（避免未用告警；历史栈在 sceneStore 单例上已就绪） */
void attachHistory;
