/**
 * 三维画布 —— T-1.6
 * 挂载 RendererService，接入两条回路：
 *  渲染同步：bindRenderer(store → service)（T-1.5）；
 *  交互回写：画布拾取 onSelect → store.select；gizmo onTransformChange → 读取变换回写 store。
 */
import { useEffect, useRef } from 'react';
import kaoliniteCif from '../../data/kaolinite.cif?raw';
import { RendererService } from '../render/RendererService';
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
    return () => {
      unbind();
      rendererRef.current = null;
      svc.dispose();
    };
  }, []);

  return <div ref={hostRef} className="canvas-host" />;
}
