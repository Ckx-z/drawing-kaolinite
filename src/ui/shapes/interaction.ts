/**
 * 图元交互层 —— T-11.2/T-11.3
 *
 * 事件宿主 = 3D WebGL canvas（overlay canvas 保持 pointerEvents:none）。
 * 分流机制：在 domElement 上挂 **capture 阶段**监听，pointerdown 先做图元/手柄/
 * 端点/工具命中——命中则处理并 stopImmediatePropagation（阻止 OrbitControls 与
 * 3D 拾取）；未命中且工具为 select 则不拦截（事件自然透传 3D 交互）。
 *
 * 状态机：idle → drawing（绘制橡皮筋）/ moving（多选整体移动，组感知）/
 * resizing（8 手柄）/ linking（箭头端点拖拽改锚定，T-11.3）。
 * 文本双击 → 浮层 input 编辑（Enter 提交 / Esc 取消 / blur 提交）。
 */
import type { ShapeTool } from '../../core/shapes/schema';
import { SHAPE_DEFAULTS } from '../../core/shapes/schema';
import { sceneStore } from '../../state/sceneStore';
import { rendererRef } from '../../state/rendererRef';
import { shapeDraft } from './draft';
import { applyHandle, hitEndpoint, hitHandle, hitTest } from './hit';
import { normBox, resolveLineEnds } from './draw';

/* ---------- 坐标换算 ---------- */

interface CtxInfo {
  W: number;
  H: number;
}
const toLocal = (dom: HTMLElement, e: PointerEvent | MouseEvent): { x: number; y: number } => {
  const r = dom.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

/* ---------- 交互工厂 ---------- */

export function createShapeInteraction(dom: HTMLCanvasElement): () => void {
  type Mode =
    | { t: 'idle' }
    | { t: 'draw' }
    | { t: 'move'; ids: string[]; ox: number; oy: number; origins: Map<string, { x: number; y: number }> }
    | { t: 'resize'; id: string; handle: string }
    | { t: 'link'; id: string; end: 'start' | 'end' };

  let mode: Mode = { t: 'idle' };
  const store = sceneStore;

  const dims = (): CtxInfo => ({ W: dom.clientWidth, H: dom.clientHeight });
  const proj = (p: [number, number, number]) => {
    const { W, H } = dims();
    return rendererRef.current?.projectToScreen(p, W, H) ?? { x: 0, y: 0, visible: true };
  };

  const consume = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** 落点吸附判定（绘制完成与端点拖拽共用）：图元优先 → 组件投影 16px → free */
  const snapAnchor = (
    x: number,
    y: number,
    excludeId?: string,
  ): { kind: 'free' } | { kind: 'shape'; id: string } | { kind: 'component'; id: string } => {
    const s = store.getState();
    const { W, H } = dims();
    const hitCtx = { shapes: s.shapes, components: s.components, project: proj, width: W, height: H };
    const target = hitTest(hitCtx, x, y);
    if (target && target.id !== excludeId) return { kind: 'shape', id: target.id };
    let bestComp: string | null = null;
    let bestD = 16;
    for (const c of s.components) {
      const p = proj(c.transform.position);
      if (!p.visible) continue;
      const dd = Math.hypot(p.x - x, p.y - y);
      if (dd < bestD) {
        bestD = dd;
        bestComp = c.id;
      }
    }
    return bestComp ? { kind: 'component', id: bestComp } : { kind: 'free' };
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // 右键/中键留给 3D pan/zoom
    const s = store.getState();
    const { x, y } = toLocal(dom, e);
    const { W, H } = dims();
    const hitCtx = { shapes: s.shapes, components: s.components, project: proj, width: W, height: H };

    // 绘制工具：进入 drawing
    if (s.tool !== 'select') {
      shapeDraft.current = { tool: s.tool, x0: x, y0: y, x1: x, y1: y };
      mode = { t: 'draw' };
      dom.setPointerCapture(e.pointerId);
      consume(e);
      return;
    }

    // 选中集操作：手柄缩放（主选图元）
    const primary = s.shapeSelectionIds.at(-1);
    if (primary) {
      const sel = s.shapes.find((sh) => sh.id === primary);
      if (sel) {
        const handle = hitHandle(sel, x, y);
        if (handle) {
          mode = { t: 'resize', id: primary, handle };
          dom.setPointerCapture(e.pointerId);
          consume(e);
          return;
        }
        // 箭头/连线端点拖拽（改锚定）
        const end = hitEndpoint(sel, x, y, hitCtx);
        if (end) {
          mode = { t: 'link', id: primary, end };
          dom.setPointerCapture(e.pointerId);
          consume(e);
          return;
        }
      }
    }

    // 图元命中：选中并准备移动（shift/ctrl 累加多选）
    const hit = hitTest(hitCtx, x, y);
    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        store.getState().toggleShapeSelection(hit.id);
        consume(e);
        return;
      }
      const ids = s.shapeSelectionIds.includes(hit.id)
        ? s.shapeSelectionIds
        : [hit.id];
      if (!s.shapeSelectionIds.includes(hit.id)) store.getState().selectShape(hit.id);
      const origins = new Map<string, { x: number; y: number }>();
      // 组感知：选中图元所在组的成员一起移动
      const group = hit.group;
      const moveIds = group
        ? s.shapes.filter((sh) => sh.group === group).map((sh) => sh.id)
        : ids;
      for (const id of moveIds) {
        const sh = s.shapes.find((x2) => x2.id === id);
        if (sh && !sh.locked) origins.set(id, { x: sh.x, y: sh.y });
      }
      mode = { t: 'move', ids: moveIds, ox: x, oy: y, origins };
      dom.setPointerCapture(e.pointerId);
      consume(e);
      return;
    }

    // 空白（select 工具）：清图元选择，事件透传 3D
    if (s.shapeSelectionIds.length) store.getState().selectShape(null);
  };

  const onMove = (e: PointerEvent): void => {
    if (mode.t === 'idle') return;
    const { x, y } = toLocal(dom, e);
    if (mode.t === 'draw') {
      if (shapeDraft.current) {
        shapeDraft.current.x1 = x;
        shapeDraft.current.y1 = y;
      }
      consume(e);
      return;
    }
    if (mode.t === 'move') {
      const m = mode; // const 定格窄化（后续函数调用不再重置）
      const dx = x - m.ox;
      const dy = y - m.oy;
      for (const [id, o] of m.origins) {
        store.getState().updateShape(id, { x: o.x + dx, y: o.y + dy });
      }
      consume(e);
      return;
    }
    if (mode.t === 'resize') {
      const m = mode;
      const sh = store.getState().shapes.find((s2) => s2.id === m.id);
      if (sh) {
        const b = applyHandle(sh, m.handle, x, y);
        store.getState().updateShape(m.id, { x: b.x, y: b.y, w: b.w, h: b.h });
      }
      consume(e);
      return;
    }
    if (mode.t === 'link') {
      const m = mode;
      // 拖端点：实时更新几何端点（free）；松手时按落点决定锚定（onUp）
      const sh = store.getState().shapes.find((s2) => s2.id === m.id);
      if (sh && (sh.type === 'arrow' || sh.type === 'line')) {
        if (m.end === 'start') store.getState().updateShape(m.id, { x, y });
        else store.getState().updateShape(m.id, { w: x - sh.x, h: y - sh.y });
      }
      consume(e);
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (mode.t === 'draw') {
      const d = shapeDraft.current;
      shapeDraft.current = null;
      if (d) {
        const w = d.x1 - d.x0;
        const h = d.y1 - d.y0;
        const minSize = 5;
        const base = SHAPE_DEFAULTS[d.tool === 'select' ? 'rect' : d.tool];
        const geo = Math.abs(w) < minSize && Math.abs(h) < minSize
          ? { x: d.x0, y: d.y0, w: base.w, h: base.h } // 单击放置：默认尺寸
          : { x: d.x0, y: d.y0, w, h };
        const id = store.getState().addShape({ ...base, ...geo } as never);
        // 绘制即连接（T-11.3）：arrow/line 两端落点在图元/组件上时自动锚定
        if (d.tool === 'arrow' || d.tool === 'line') {
          store.getState().updateShape(id, {
            anchors: { start: snapAnchor(d.x0, d.y0, id), end: snapAnchor(d.x1, d.y1, id) },
          } as never);
        }
        store.getState().selectShape(id);
        store.getState().setTool('select'); // 画完自动回选择工具（PPT 习惯）
      }
      mode = { t: 'idle' };
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        /* 已释放 */
      }
      return;
    }
    if (mode.t === 'link') {
      const m = mode;
      // 落点吸附（共享 snapAnchor：图元 → 组件投影 → free）
      const { x, y } = toLocal(dom, e);
      const sh = store.getState().shapes.find((s2) => s2.id === m.id);
      if (sh && (sh.type === 'arrow' || sh.type === 'line')) {
        const anchors = { ...sh.anchors, [m.end]: snapAnchor(x, y, m.id) };
        store.getState().updateShape(m.id, { anchors } as never);
      }
      mode = { t: 'idle' };
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        /* 已释放 */
      }
      return;
    }
    if (mode.t !== 'idle') {
      mode = { t: 'idle' };
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        /* 已释放 */
      }
    }
  };

  const onDblClick = (e: MouseEvent): void => {
    const s = store.getState();
    const { x, y } = toLocal(dom, e);
    const { W, H } = dims();
    const hit = hitTest({ shapes: s.shapes, components: s.components, project: proj, width: W, height: H }, x, y);
    if (hit) {
      consume(e);
      if (hit.type === 'text') openTextEditor(hit.id, dom);
      else if (hit.type === 'arrow' || hit.type === 'line') {
        // 双击连线：翻转起点/终点锚定（快速调头）
        const anchors = { start: hit.anchors.end, end: hit.anchors.start };
        store.getState().updateShape(hit.id, { anchors } as never);
      }
    }
  };

  // 绘制工具时光标提示（crosshair）
  let lastTool: ShapeTool = 'select';
  const unsub = store.subscribe((st) => {
    if (st.tool !== lastTool) {
      lastTool = st.tool;
      dom.style.cursor = st.tool === 'select' ? '' : 'crosshair';
      if (st.tool !== 'select' && st.shapeSelectionIds.length) sceneStore.getState().selectShape(null);
    }
  });

  dom.addEventListener('pointerdown', onDown, { capture: true });
  dom.addEventListener('pointermove', onMove, { capture: true });
  dom.addEventListener('pointerup', onUp, { capture: true });
  dom.addEventListener('dblclick', onDblClick, { capture: true });
  return () => {
    dom.removeEventListener('pointerdown', onDown, { capture: true });
    dom.removeEventListener('pointermove', onMove, { capture: true });
    dom.removeEventListener('pointerup', onUp, { capture: true });
    dom.removeEventListener('dblclick', onDblClick, { capture: true });
    unsub();
    shapeDraft.current = null;
    dom.style.cursor = '';
  };
}

/* ---------- 文本编辑浮层 ---------- */

let editorEl: HTMLInputElement | null = null;

export function openTextEditor(shapeId: string, dom: HTMLElement): void {
  closeTextEditor();
  const s = sceneStore.getState();
  const shape = s.shapes.find((x) => x.id === shapeId);
  if (!shape || shape.type !== 'text') return;
  const r = dom.getBoundingClientRect();
  const el = document.createElement('input');
  el.value = shape.text;
  el.style.position = 'fixed';
  el.style.left = `${r.left + normBox(shape).x}px`;
  el.style.top = `${r.top + normBox(shape).y - 26}px`;
  el.style.zIndex = '1000';
  el.style.background = '#fff';
  el.style.border = '1px solid #3b82f6';
  el.style.borderRadius = '4px';
  el.style.padding = '3px 8px';
  el.style.fontSize = '13px';
  el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
  el.spellcheck = false;
  document.body.appendChild(el);
  editorEl = el;
  el.focus();
  el.select();
  const commit = (): void => {
    const v = el.value.trim();
    if (v) sceneStore.getState().updateShape(shapeId, { text: v });
  };
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      commit();
      closeTextEditor();
    } else if (ev.key === 'Escape') {
      closeTextEditor();
    }
  });
  el.addEventListener('blur', () => {
    commit();
    closeTextEditor();
  });
}

export function closeTextEditor(): void {
  if (editorEl) {
    editorEl.remove();
    editorEl = null;
  }
}

/* ---------- 键盘辅助（App.tsx 分发调用） ---------- */

/** 方向键微调选中图元（±step px；返回 true 表示已消费） */
export function nudgeSelectedShapes(dx: number, dy: number, step: number): boolean {
  const s = sceneStore.getState();
  if (!s.shapeSelectionIds.length) return false;
  for (const sh of s.shapes) {
    if (!s.shapeSelectionIds.includes(sh.id) || sh.locked) continue;
    sceneStore.getState().updateShape(sh.id, { x: sh.x + dx * step, y: sh.y + dy * step });
  }
  return true;
}

/** 删除全部选中图元（返回删除数） */
export function deleteSelectedShapes(): number {
  const s = sceneStore.getState();
  const n = s.shapeSelectionIds.length;
  for (const id of [...s.shapeSelectionIds]) sceneStore.getState().removeShape(id);
  return n;
}

/** 连线两端点解析快捷出口（外部吸附件复用） */
export { resolveLineEnds };
