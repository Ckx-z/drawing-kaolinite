/**
 * 场景文件视角快照（2026-09-13，与模板五原则同源）：
 * toSceneDocument 采集相机/形态/2D 视图；loadScene 有 camera 原样恢复并返回 true
 * （调用方跳过 frameAll）；旧场景无字段返回 false 回退取景。
 */
import { describe, expect, it } from 'vitest';
import { createSceneStore } from './sceneStore';
import { rendererRef } from './rendererRef';
import { shapeViewStore } from '../ui/shapes/view';
import { SCENE_FORMAT } from '../core/schema';

const fakeSvc = (initial?: [number, number, number]) => {
  const mk = (v0?: [number, number, number]) => {
    const o = {
      v: v0 ? [...v0] as number[] : null,
      set(x: number, y: number, z: number) { o.v = [x, y, z]; },
      toArray: () => (o.v ? [...o.v] : [0, 0, 0]),
    };
    return o;
  };
  const pos = mk(initial);
  const tgt = mk(initial ? [1, 2, 3] : undefined);
  const calls: string[] = [];
  return {
    pos, tgt, calls,
    svc: {
      camera: { position: pos, lookAt: () => calls.push('lookAt'), updateProjectionMatrix: () => calls.push('proj') },
      orbit: { target: tgt, update: () => calls.push('orbit') },
    } as never,
  };
};

describe('场景视角快照', () => {
  it('toSceneDocument 含相机/形态/2D 视图；loadScene 原样恢复并返回 true', () => {
    const store = createSceneStore();
    const f = fakeSvc([48, -30, 42]);
    const prev = rendererRef.current;
    rendererRef.current = f.svc;
    try {
      store.setState({ mode: 'diagram' });
      shapeViewStore.getState().setView({ zoom: 2.5, panX: -30, panY: 12 });
      const doc = store.getState().toSceneDocument();
      expect(doc.format).toBe(SCENE_FORMAT);
      expect(doc.mode).toBe('diagram');
      expect(doc.view).toEqual({ zoom: 2.5, panX: -30, panY: 12 });
      expect(doc.camera).toBeDefined();

      // 破坏现场后载入：形态/视图/相机恢复
      store.setState({ mode: 'mixed' });
      shapeViewStore.getState().resetView();
      const restored = store.getState().loadScene(JSON.parse(JSON.stringify(doc)));
      expect(restored).toBe(true);
      expect(store.getState().mode).toBe('diagram');
      const v = shapeViewStore.getState();
      expect([v.zoom, v.panX, v.panY]).toEqual([2.5, -30, 12]);
      expect(f.calls).toContain('lookAt');
    } finally {
      rendererRef.current = prev;
      shapeViewStore.getState().resetView();
    }
  });

  it('旧场景（无视角字段）：loadScene 返回 false，不碰相机', () => {
    const store = createSceneStore();
    const f = fakeSvc();
    const prev = rendererRef.current;
    rendererRef.current = f.svc;
    try {
      const legacy = {
        format: SCENE_FORMAT,
        saved: new Date().toISOString(),
        components: [],
      };
      const restored = store.getState().loadScene(legacy);
      expect(restored).toBe(false);
      expect(f.pos.v).toBeNull(); // 相机未被触碰 → 调用方 frameAll 回退
      expect(f.tgt.v).toBeNull();
    } finally {
      rendererRef.current = prev;
    }
  });
});
