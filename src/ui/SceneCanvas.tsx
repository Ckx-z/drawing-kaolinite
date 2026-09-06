/**
 * 三维画布 —— T-1.6
 * 挂载 RendererService，接入两条回路：
 *  渲染同步：bindRenderer(store → service)（T-1.5）；
 *  交互回写：画布拾取 onSelect → store.select；gizmo onTransformChange → 读取变换回写 store。
 */
import { useEffect, useRef } from 'react';
import kaoliniteCif from '../../data/kaolinite.cif?raw';
import { createCachedEngine, defaultTubePrebakeRequests, prebake } from '../core/cache';
import { createWorkerEngine } from '../core/worker';
import { RendererService } from '../render/RendererService';
import { hoverStore } from '../render/highlight';
import { bindRenderer } from '../state/rendererBinding';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

export default function SceneCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const svc = new RendererService(host);
    svc.setCifText(kaoliniteCif);
    svc.onSelect = (id) => sceneStore.getState().select(id);
    svc.onTransformChange = (id) => {
      const t = svc.getComponentTransform(id);
      if (t) sceneStore.getState().setTransform(id, t);
    };
    const unbind = bindRenderer(sceneStore, svc);
    rendererRef.current = svc;

    // T-7.1 悬停：pointermove 节流 → BBox 级轻量拾取 → hoverStore（渲染外壳 + 图层面板联动）
    let lastHover = 0;
    const onMove = (e: PointerEvent): void => {
      const now = performance.now();
      if (now - lastHover < 80) return; // ≤12.5Hz，帧率无感
      lastHover = now;
      hoverStore.getState().setHover(svc.pickAt(e.clientX, e.clientY));
    };
    const onLeave = (): void => hoverStore.getState().setHover(null);
    const dom = svc.renderer.domElement;
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', onLeave);
    // 图层面板悬停 → 渲染外壳（双向联动的另一半；面板自身样式由 hoverStore 驱动）
    const unhover = hoverStore.subscribe(({ id }) => svc.setHover(id));
    hoverStore.getState().setHover(null);

    // T-2.9 预烘焙：空闲 4s 后后台预生成常用埃洛石管参数组合进 IndexedDB
    // （每浏览器一次；独立 Worker 引擎，与画布引擎共享磁盘缓存）
    const prebakeTimer = setTimeout(() => {
      if (localStorage.getItem('kaolin_prebake_v1')) return;
      const engine = createCachedEngine(createWorkerEngine());
      void prebake(engine, defaultTubePrebakeRequests(kaoliniteCif))
        .then((n) => {
          if (n > 0) localStorage.setItem('kaolin_prebake_v1', String(n));
        })
        .finally(() => engine.dispose());
    }, 4000);

    return () => {
      clearTimeout(prebakeTimer);
      unbind();
      unhover();
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      rendererRef.current = null;
      svc.dispose();
    };
  }, []);

  return <div ref={hostRef} className="canvas-host" />;
}
