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
import { trace } from '../crashTrace';
import { drawAnnotations } from './annotations/draw';
import { drawDraft, drawGrid, drawGuides, drawShapes } from './shapes/draw';
import { createShapeInteraction } from './shapes/interaction';
import { shapeViewStore } from './shapes/view';
import { RendererService } from '../render/RendererService';
import { hoverStore } from '../render/highlight';
import { bindRenderer } from '../state/rendererBinding';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

/** 叠加 canvas：随渲染画布同尺寸；rAF 重绘标注 + 图元（与渲染同步即可） */
function AnnotationOverlay(): React.ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      const cv = ref.current;
      const svc = rendererRef.current;
      if (cv && svc) {
        if (cv.width !== svc.renderer.domElement.width || cv.height !== svc.renderer.domElement.height) {
          cv.width = svc.renderer.domElement.width;
          cv.height = svc.renderer.domElement.height;
        }
        const ctx = cv.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, cv.width, cv.height);
          const s = sceneStore.getState();
          const dpr = svc.renderer.getPixelRatio();
          const W = cv.clientWidth || cv.width / dpr;
          const H = cv.clientHeight || cv.height / dpr;
          ctx.scale(dpr, dpr);
          if (s.mode === 'diagram') {
            // T-11.6 纯示意图：浅格点背景（图元层坐标网格，随 view 变换）+ 图元视图变换
            const v = shapeViewStore.getState();
            drawGrid(ctx, W, H, v.zoom, v.panX, v.panY);
            ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.panX, dpr * v.panY);
            drawShapes({
              ctx,
              width: W / v.zoom,
              height: H / v.zoom,
              shapes: s.shapes,
              components: [],
              project: () => ({ x: 0, y: 0, visible: false }),
              selectionId: s.shapeSelectionIds.at(-1) ?? null,
            });
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawDraft(ctx); // 橡皮筋在屏幕空间
            drawGuides(ctx, v.zoom, v.panX, v.panY);
          } else {
            drawAnnotations({
              ctx,
              width: W,
              height: H,
              annotations: s.annotations,
              project: (p) => svc.projectToScreen(p, W, H),
              pxPerAAtTarget: svc.pxPerAAtTarget(H),
            });
            // T-11.1 机理图图元层（画在标注之上；图元层坐标 == 视口逻辑像素）
            drawShapes({
              ctx,
              width: W,
              height: H,
              shapes: s.shapes,
              components: s.components,
              project: (p) => svc.projectToScreen(p, W, H),
              selectionId: s.shapeSelectionIds.at(-1) ?? null,
            });
            drawDraft(ctx);
            drawGuides(ctx);
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}

export default function SceneCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const svc = new RendererService(host);
    svc.setCifText(kaoliniteCif);
    svc.onSelect = (id, additive) => {
      // T-7.3：Shift+点击 = 组件多选切换；普通点击 = 单选（清多选）
      if (additive && id) sceneStore.getState().toggleComponentSelection(id);
      else sceneStore.getState().select(id);
    };
    // Alt+点击原子（2026-09-12）：密排原子层 → 切换该原子所在列的"参与堆叠"掩码位。
    // 视角下命中的常是顶层原子——按水平最近归属到第一层格点（与 builder 掩码归属同规则）
    svc.onAtomClick = (compId, atom) => {
      const s = sceneStore.getState();
      const comp = s.components.find((c) => c.id === compId);
      if (!comp || comp.type !== 'packed_layers') return;
      const n = comp.params.n ?? 7;
      const mesh = svc.atomMeshOf(compId);
      if (!mesh) return;
      const layer0 = mesh.userData.atoms.filter((a) => a.layer === 0);
      let target = atom;
      if (atom.layer !== 0) {
        let bd = Infinity;
        for (const a of layer0) {
          const d = (a.x - atom.x) ** 2 + (a.y - atom.y) ** 2;
          if (d < bd) {
            bd = d;
            target = a;
          }
        }
      }
      const idx = layer0.indexOf(target);
      if (idx < 0 || idx >= n * n) return;
      const bits = Array.from({ length: n * n }, (_, k) => (String(comp.params.mask ?? '').charAt(k) === '0' ? '0' : '1'));
      bits[idx] = bits[idx] === '1' ? '0' : '1';
      sceneStore.getState().updateParams(compId, { mask: bits.join('') } as never);
    };
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

    // T-11.2 图元交互：capture 阶段挂在 3D canvas 上（命中即拦截，空白透传 3D）
    const disposeShapes = createShapeInteraction(dom);
    // 图层面板悬停 → 渲染外壳（双向联动的另一半；面板自身样式由 hoverStore 驱动）
    const unhover = hoverStore.subscribe(({ id }) => svc.setHover(id));
    hoverStore.getState().setHover(null);

    // T-2.9 预烘焙：空闲 4s 后后台预生成常用埃洛石管参数组合进 IndexedDB
    // （每浏览器一次；独立 Worker 引擎，与画布引擎共享磁盘缓存。
    //   Worker 加载失败（ready=false）时跳过——主线程同步预烘焙会造成明显卡顿）
    const prebakeTimer = setTimeout(() => {
      trace('prebake-timer');
      if (localStorage.getItem('kaolin_prebake_v2')) return;
      trace('prebake-start');
      const inner = createWorkerEngine();
      const engine = createCachedEngine(inner);
      void (inner.ready ?? Promise.resolve(true))
        .then((ok) =>
          ok ? prebake(engine, defaultTubePrebakeRequests(kaoliniteCif)) : Promise.resolve(0),
        )
        .then((n) => {
          trace(`prebake-done n=${n}`);
          if (n > 0) localStorage.setItem('kaolin_prebake_v2', String(n));
        })
        .catch((err: unknown) => trace(`prebake-error ${String(err)}`))
        .finally(() => {
          trace('prebake-engine-dispose');
          engine.dispose();
        });
    }, 4000);

    return () => {
      clearTimeout(prebakeTimer);
      unbind();
      unhover();
      disposeShapes();
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      rendererRef.current = null;
      svc.dispose();
    };
  }, []);

  return (
    <div ref={hostRef} className="canvas-host">
      <AnnotationOverlay />
    </div>
  );
}
