/**
 * V2 交互闭环 —— 快捷键防护 + 自由摆放工作流（D15 改版，2026-11-05）
 *
 * 自动拖拽吸附已删除（D15）：闭环 = 甲苯检索 → 拖放置换（可落在表面内部）→
 * 松手自由变换提交 = 用户变换逐位一致（原自动吸附触发场景作为回归用例）→
 * 逐条 Undo 全回退 → 模板 roundtrip 复现。快捷键全表唯一性防护不变。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { buildCrystalSurface, buildMolecule } from '../core/builders';
import { MINERALS } from '../core/minerals';
import { createAssetComponent, searchAssets } from '../core/assets/assetSearch';
import { attachHistory } from '../state/history';
import { rendererRef } from '../state/rendererRef';
import { createSceneStore, sceneStore, sceneHistory } from '../state/sceneStore';
import { beginSpecDrag, finishAssetDrag, updateAssetDrag } from './dragPlace';
import { commitGizmoTransform } from './transformRelease';
import { SHORTCUTS } from './shortcuts';
import type { Transform } from '../core/types';

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

/* ---------- 自由摆放闭环 ---------- */

const SURF = { mineral: 'ceo2', h: 1, k: 1, l: 1, sizeX: 14, sizeY: 14, thickness: 9, termination: 0, style: '球棍' } as const;
const TOLUENE = buildMolecule('C₇H₈');
const SURF_GEO = buildCrystalSurface(MINERALS.ceo2.cifText, { ...SURF });

/** 假渲染件 gizmo 回读状态（松手提交入口用）：target 之外的组件回读 null */
const gizmoState: { gizmo: Transform; target: string | null } = {
  gizmo: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } as Transform,
  target: null,
};

/** 假渲染件：画布 (0,0)-(800,600)；放置点可注入 */
function fakeSvc(point: [number, number, number] | null): { svc: unknown; setGizmo: (t: Transform) => void } {
  return {
    svc: {
      renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }) } },
      camera: { position: { toArray: () => [150, 110, 190], set: () => {} }, lookAt: () => {}, updateProjectionMatrix: () => {} },
      orbit: { target: { toArray: () => [0, 0, 0], set: () => {} }, update: () => {} },
      previewGeometry: () => Promise.resolve({ atoms: TOLUENE.atoms, bonds: TOLUENE.bonds }),
      setPlacementPreview: () => {},
      movePlacementPreview: () => {},
      hidePlacementPreview: () => {},
      clearPlacementPreview: () => {},
      pickPlacementPoint: () => point,
      // transformRelease 松手提交入口所需
      getComponentTransform: (id: string) => (gizmoState.target === id ? { ...gizmoState.gizmo } : null),
    },
    setGizmo: (t) => {
      gizmoState.gizmo = t;
    },
  };
}

beforeEach(() => {
  for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
  while (sceneHistory.undo()) { /* 清历史残留 */ }
});

describe('自由摆放闭环（D15：无自动贴附）', () => {
  it('甲苯资产可检索且工厂给出 molecule 规格', () => {
    const hits = searchAssets('甲苯');
    expect(hits.length).toBeGreaterThan(0);
    const spec = createAssetComponent(hits[0]!.id);
    expect(spec?.componentType).toBe('molecule');
  });

  it('全链路：拖放置换（深入表面=原吸附触发场景，位置原样保留）→ 松手自由变换 → 逐条 Undo 全回退', async () => {
    sceneStore.getState().addComponent('crystal_surface', { params: { ...SURF } });
    const surfZ = Math.max(...SURF_GEO.atoms.map((a) => a.z));

    // ① 拖放：拾取点直接落进表面内部（重叠）——放置值逐位保留，无贴面/推出
    const spec = createAssetComponent(searchAssets('甲苯')[0]!.id)!;
    const f = fakeSvc([0, 0, surfZ - 3]);
    rendererRef.current = f.svc as never;
    beginSpecDrag(spec);
    await Promise.resolve();
    updateAssetDrag(400, 300);
    const molId = finishAssetDrag()!;
    expect(sceneStore.getState().components).toHaveLength(2);
    expect(sceneStore.getState().components.find((c) => c.id === molId)!.transform.position).toEqual([0, 0, surfZ - 3]);

    // ② gizmo 拖到更深重叠后松手：commitGizmoTransform（SceneCanvas 同一入口）原样提交
    gizmoState.target = molId;
    const userT: Transform = { position: [0, 0, surfZ - 8], rotation: [0, 30, 0], scale: 4 };
    f.setGizmo(userT);
    expect(commitGizmoTransform(f.svc as never, molId, sceneStore)).toBe(true);
    const after = sceneStore.getState().components.find((c) => c.id === molId)!.transform;
    expect(after.position).toEqual(userT.position); // 重叠场景下无任何改写
    expect(after.rotation).toEqual(userT.rotation);
    expect(after.scale).toBe(4);

    // ③ 逐条 Undo 全回退到空场景（拖放 + 松手提交各一条）
    let n = 0;
    while (sceneHistory.undo()) n++;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(sceneStore.getState().components).toHaveLength(0);
  });

  it('松手提交：组件不存在时静默跳过、零历史污染', () => {
    const store = createSceneStore();
    const history = attachHistory(store, { mergeWindowMs: 0 });
    const f = fakeSvc(null);
    expect(commitGizmoTransform(f.svc as never, 'ghost', store)).toBe(false);
    expect(history.depths().undo).toBe(0);
    expect(store.getState().components).toHaveLength(0);
  });

  it('模板 roundtrip：自由摆放的甲苯随场景存取精确复现', async () => {
    const f = fakeSvc([3, -2, 20]);
    rendererRef.current = f.svc as never;
    beginSpecDrag(createAssetComponent(searchAssets('甲苯')[0]!.id)!);
    await Promise.resolve();
    updateAssetDrag(400, 300);
    const molId = finishAssetDrag()!;
    sceneStore.getState().setTransform(molId, { position: [3, -2, 11], rotation: [0, 30, 0], scale: 4 });

    const doc = sceneStore.getState().toSceneDocument();
    const t = doc.components.find((c) => c.id === molId)!;
    expect(t.transform.position).toEqual([3, -2, 11]);
    sceneStore.getState().loadScene(JSON.stringify(doc));
    const back = sceneStore.getState().components.find((c) => c.name === t.name)!;
    expect(back.transform.position).toEqual([3, -2, 11]);
    expect(back.transform.rotation).toEqual([0, 30, 0]);
    expect((back.params as Record<string, unknown>).kind).toBe((t.params as Record<string, unknown>).kind);
  });
});
