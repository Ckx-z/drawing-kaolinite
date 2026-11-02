/**
 * 素材拖放三维画布（V2 交互升级 P1）
 *
 * 工作流：资产卡 pointerdown → 位移超阈值进入拖放会话 → 半透明预览
 * （几何经内容寻址缓存预构建一次，指针移动只改组位置，绝不重复解析 CIF）
 * → 画布内松手 = addComponent 落地（一次 Undo）→ 选中。
 * 取消路径全安全：Esc / 拖出画布 / 几何构建失败 / 快速连续拖拽（会话号作废旧响应）。
 * 预览全程隔离：不进 sceneStore / Undo / 模板 / 正式拾取 / 导出（RendererService 专用预览组）。
 */
import { createAssetComponent } from '../core/assets/assetSearch';
import { mineralOf } from '../core/minerals';
import { defaultTransformFor } from '../core/schema';
import type { ComponentType } from '../core/types';
import type { GeometryRequest } from '../core/worker';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

interface DragSession {
  /** 会话号：快速连续拖拽时旧会话的异步几何响应作废 */
  seq: number;
  assetId: string;
  componentType: ComponentType;
  params: Record<string, unknown>;
  name?: string;
  /** 最近一次有效放置点（画布内才有） */
  lastPoint: [number, number, number] | null;
  /** 几何已就绪（预览组已建） */
  ready: boolean;
}

let session: DragSession | null = null;
let sessionSeq = 0;
/** 本次拖放是否实际发生（卡片 click 分发前判断，避免拖放结束又触发 Direct Add） */
let draggedFlag = false;

export function isAssetDragging(): boolean {
  return session !== null;
}

/** 刚结束的一次拖放（卡片 onClick 消费一次即清除，抑制拖放尾随点击的 Direct Add） */
export function consumeDraggedFlag(): boolean {
  const v = draggedFlag;
  draggedFlag = false;
  return v;
}

/** 指针是否在 3D 画布上方（混合模式才可放置；纯 2D 模式 3D 不可见） */
function overCanvas(clientX: number, clientY: number): boolean {
  const svc = rendererRef.current;
  if (!svc || sceneStore.getState().mode !== 'mixed') return false;
  const r = svc.renderer.domElement.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** 与 RendererService.requestBuild 同款请求构造（CIF 类型按组件矿物参数取；缓存键一致 → 落地时命中缓存）。基底不走引擎（调用方已排除） */
function geometryRequestOf(
  componentType: Exclude<ComponentType, 'rubber_substrate'>,
  params: Record<string, unknown>,
): GeometryRequest {
  const cif =
    componentType === 'kaolinite_sheet' || componentType === 'halloysite_tube' || componentType === 'crystal_surface'
      ? mineralOf((params as { mineral?: string }).mineral).cifText
      : '';
  return { kind: componentType, cifText: cif, params };
}

/** 拖放目标规格（资产卡 / 基础类型卡共用） */
export interface DragSpec {
  componentType: ComponentType;
  params: Record<string, unknown>;
  name?: string;
}

/** 进入拖放会话（核心）：异步预构建几何（内容寻址缓存；失败静默取消） */
export function beginSpecDrag(spec: DragSpec): void {
  cancelAssetDrag();
  const svc = rendererRef.current;
  if (!svc) return;
  const seq = ++sessionSeq;
  session = {
    seq,
    assetId: `${spec.componentType}`,
    componentType: spec.componentType,
    params: spec.params,
    name: spec.name,
    lastPoint: null,
    ready: false,
  };
  // 橡胶基底不走几何引擎（主线程 THREE 挤出几何，无原子数据）：
  // 拖放无 3D 预览，放置点/落地照常
  if (spec.componentType === 'rubber_substrate') return;
  void svc
    .previewGeometry(geometryRequestOf(spec.componentType, spec.params))
    .then((geo) => {
      if (!session || session.seq !== seq) return; // 会话已换/已取消
      if (!geo) {
        cancelAssetDrag(); // 几何构建失败：静默取消（不放置，任务书 3.2 放置失败路径）
        return;
      }
      const scale = defaultTransformFor(session.componentType).scale;
      svc.setPlacementPreview(geo.atoms, geo.bonds, scale);
      session.ready = true;
      if (session.lastPoint) svc.movePlacementPreview(session.lastPoint);
    })
    .catch(() => cancelAssetDrag());
}

/** 进入拖放会话（资产卡入口）：解析资产注册表后走 beginSpecDrag */
export function beginAssetDrag(assetId: string): void {
  const asset = createAssetComponent(assetId);
  if (asset) beginSpecDrag(asset);
}

/** 拖动中跟随指针：画布内 = 表面/工作平面放置点；画布外 = 仅隐藏预览（会话保留） */
export function updateAssetDrag(clientX: number, clientY: number): void {
  const svc = rendererRef.current;
  if (!session || !svc) return;
  if (!overCanvas(clientX, clientY)) {
    session.lastPoint = null;
    svc.hidePlacementPreview();
    return;
  }
  const p = svc.pickPlacementPoint(clientX, clientY);
  if (!p) {
    session.lastPoint = null;
    svc.hidePlacementPreview();
    return;
  }
  session.lastPoint = p;
  if (session.ready) svc.movePlacementPreview(p);
}

/**
 * 松手放置：画布内且有点 → addComponent（position = 放置点，默认旋转/缩放）+ 选中，
 * 返回新组件 id；否则取消返回 null。放置 = 一次历史记录（addComponent 既有语义）。
 */
export function finishAssetDrag(): string | null {
  const svc = rendererRef.current;
  const s = session;
  session = null;
  svc?.clearPlacementPreview();
  if (!s || !s.lastPoint) return null;
  draggedFlag = true;
  const id = sceneStore.getState().addComponent(s.componentType, {
    name: s.name,
    params: s.params as never,
    transform: { position: s.lastPoint },
  });
  sceneStore.getState().select(id);
  return id;
}

/** 取消拖放（Esc / pointercancel / 卡片 pointerup 未拖动等）：无任何场景变更 */
export function cancelAssetDrag(): void {
  session = null;
  rendererRef.current?.clearPlacementPreview();
}

/**
 * 资产卡拖放会话（V2 交互升级，模型面板卡片共用）：pointerdown 记起点，
 * 位移 >4px 进入拖放（半透明预览跟随，几何仅构建一次）；画布内松手放置、
 * 画布外/pointercancel 取消。未移动即松手 = 普通点击（Direct Add 原路径不变；
 * 拖放结束后由 consumeDraggedFlag 抑制尾随点击）。
 */
export function wireCardDrag(
  e: ReactPointerEvent,
  resolveSpec: () => DragSpec | null,
): void {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  const onMove = (ev: PointerEvent): void => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 4) return;
      dragging = true;
      const spec = resolveSpec();
      if (spec) beginSpecDrag(spec);
      return;
    }
    updateAssetDrag(ev.clientX, ev.clientY);
  };
  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };
  const onUp = (): void => {
    cleanup();
    if (dragging) void finishAssetDrag(); // 画布内 → 放置（一条 Undo）；否则内部静默取消
  };
  const onCancel = (): void => {
    cleanup();
    if (dragging) cancelAssetDrag();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/** Esc 取消入口：拖放会话存在时消费事件（返回 true = 已处理，调用方停止传播） */
export function handleEscapeDuringDrag(): boolean {
  if (!session) return false;
  cancelAssetDrag();
  return true;
}
