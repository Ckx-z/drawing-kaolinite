/**
 * 快捷键体系 —— T-7.2
 *
 * 统一注册表（声明式）：key/mod/label/action/when 单一事实源，
 * 速查浮层（? 键）由同一注册表渲染 → 快捷键与说明永不脱节。
 * 剪贴板：模块级单槽（复制 = 选中组件的 type/name/params/transform 快照），
 * 粘贴经 addComponent（schema 校验 + 撤销栈入历史），位置偏移 +12Å 避免完全重叠。
 */

import type { SceneState } from '../state/sceneStore';

export interface ShortcutDef {
  /** 键名（e.key 小写或 'delete'/'escape'） */
  key: string;
  /** 'mod' = Ctrl/Cmd；'shift' 仅标注显示用 */
  mod?: 'mod' | 'none';
  /** Shift 修饰 */
  shift?: boolean;
  label: string;
  /** 无选中时是否可用 */
  needsSelection?: boolean;
  run: (ctx: ShortcutContext) => void;
}

export interface ShortcutContext {
  host: ShortcutHost;
  selectionId: string | null;
  toggleCheatSheet: () => void;
}

export interface ShortcutHost {
  getState: () => SceneState;
  history: { undo(): boolean; redo(): boolean };
  /** 请求切换速查浮层（App 设置 React 状态） */
  toggleCheatSheet: () => void;
  /** T-11：切换图元工具（工具快捷键 V/R/O/A/L/T） */
  setShapeTool?: (tool: SceneState['tool']) => void;
}

/* ---------- 剪贴板（模块级双槽：组件 / 图元） ---------- */

interface ComponentClip {
  kind: 'component';
  type: string;
  name: string;
  params: Record<string, unknown>;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  };
}

interface ShapeClip {
  kind: 'shape';
  shapes: Array<Record<string, unknown>>; // 同组多选拷贝（组标记清除）
}

let clip: ComponentClip | ShapeClip | null = null;

/** 测试辅助：清空剪贴板 */
export function clearShortcutClipboard(): void {
  clip = null;
}

function copySelected(host: ShortcutHost): void {
  const s = host.getState();
  // 图元优先（图元选中时 Ctrl+C 拷图元）
  if (s.shapeSelectionIds.length) {
    const picked = s.shapes.filter((sh) => s.shapeSelectionIds.includes(sh.id) && !sh.locked);
    if (!picked.length) return;
    clip = {
      kind: 'shape',
      shapes: picked.map((sh) => {
        const copy: Record<string, unknown> = structuredClone({ ...sh });
        delete copy.id;
        delete copy.group; // 副本脱离原组
        return copy;
      }),
    };
    return;
  }
  const sel = s.components.find((c) => c.id === s.selectionId);
  if (!sel) return;
  clip = {
    kind: 'component',
    type: sel.type,
    name: sel.name,
    params: structuredClone(sel.params),
    transform: structuredClone(sel.transform as ComponentClip['transform']),
  };
}

function pasteClipboard(host: ShortcutHost, offset: boolean): void {
  if (!clip) return;
  const s = host.getState();
  if (clip.kind === 'shape') {
    const ids: string[] = [];
    for (const sh of clip.shapes) {
      const d = offset ? 12 : 0;
      const id = s.addShape({ ...sh, x: (sh.x as number) + d, y: (sh.y as number) + d } as never);
      ids.push(id);
    }
    s.selectShapes(ids);
    return;
  }
  const t = clip.transform;
  const pos: [number, number, number] = offset
    ? [t.position[0] + 12, t.position[1] + 12, t.position[2]]
    : [...t.position];
  const newId = s.addComponent(clip.type as Parameters<SceneState['addComponent']>[0], {
    name: `${clip.name} 副本`,
    params: structuredClone(clip.params) as never,
    transform: { position: pos, rotation: [...t.rotation] as [number, number, number], scale: t.scale },
  });
  s.select(newId);
}

/* ---------- 注册表（速查浮层同源渲染） ---------- */

export const SHORTCUTS: ShortcutDef[] = [
  {
    key: 'z', mod: 'mod', label: '撤销',
    run: ({ host }) => host.history.undo(),
  },
  {
    key: 'z', mod: 'mod', shift: true, label: '重做',
    run: ({ host }) => host.history.redo(),
  },
  {
    key: 'y', mod: 'mod', label: '重做',
    run: ({ host }) => host.history.redo(),
  },
  {
    key: 'c', mod: 'mod', needsSelection: true, label: '复制选中组件',
    run: (ctx) => copySelected(ctx.host),
  },
  {
    key: 'v', mod: 'mod', label: '粘贴副本（偏移 +12Å）',
    run: (ctx) => pasteClipboard(ctx.host, true),
  },
  {
    key: 'd', mod: 'mod', needsSelection: true, label: '原地创建副本',
    run: (ctx) => {
      copySelected(ctx.host);
      pasteClipboard(ctx.host, false);
    },
  },
  {
    key: 'delete', needsSelection: true, label: '删除选中组件 / 图元',
    run: ({ host }) => {
      const id = host.getState().selectionId;
      if (id) host.getState().removeComponent(id);
    },
  },
  {
    key: 'backspace', needsSelection: true, label: '删除选中组件 / 图元',
    run: ({ host }) => {
      const id = host.getState().selectionId;
      if (id) host.getState().removeComponent(id);
    },
  },
  {
    key: 'h', needsSelection: true, label: '显示/隐藏选中组件',
    run: ({ host }) => {
      const s = host.getState();
      const sel = s.components.find((c) => c.id === s.selectionId);
      if (sel) s.setVisibility(sel.id, !sel.visible);
    },
  },
  {
    key: 'escape', label: '取消选中（含组件多选）/ 关闭浮层 / 回选择工具',
    run: ({ host, toggleCheatSheet }) => {
      host.getState().select(null);
      host.getState().selectShape(null);
      host.getState().selectComponentIds([]); // T-7.3 清组件多选
      host.getState().setTool('select');
      toggleCheatSheet();
    },
  },
  {
    key: '?', mod: 'none', shift: true, label: '快捷键速查',
    run: ({ toggleCheatSheet }) => toggleCheatSheet(),
  },
  // T-11.2 图元工具快捷键（无修饰单字母，输入框聚焦时由分发守卫拦截）
  { key: 'v', mod: 'none', label: '选择工具', run: ({ host }) => host.setShapeTool?.('select') },
  { key: 'r', mod: 'none', label: '绘制矩形', run: ({ host }) => host.setShapeTool?.('rect') },
  { key: 'o', mod: 'none', label: '绘制椭圆', run: ({ host }) => host.setShapeTool?.('ellipse') },
  { key: 'a', mod: 'none', label: '绘制箭头', run: ({ host }) => host.setShapeTool?.('arrow') },
  { key: 'l', mod: 'none', label: '绘制连线', run: ({ host }) => host.setShapeTool?.('line') },
  { key: 't', mod: 'none', label: '绘制文本', run: ({ host }) => host.setShapeTool?.('text') },
];

/** 去重显示（delete/backspace 与 y/z 重做合并展示用） */
export function cheatsheetEntries(): Array<{ keys: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ keys: string; label: string }> = [];
  for (const s of SHORTCUTS) {
    const keys = `${s.mod === 'mod' ? 'Ctrl/' : ''}${s.shift ? 'Shift+' : ''}${s.key === 'delete' || s.key === 'backspace' ? 'Del' : s.key === '?' ? '?' : s.key.toUpperCase()}`;
    const dedupe = `${keys}|${s.label}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ keys, label: s.label });
  }
  return out;
}

/**
 * 键盘事件分发（App keydown 调用）。返回 true 表示已消费。
 * 输入框聚焦时跳过（调用方负责）。
 */
export function handleShortcut(e: KeyboardEvent, host: ShortcutHost): boolean {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
  for (const def of SHORTCUTS) {
    const modOk = def.mod === 'mod' ? mod : !mod;
    const shiftOk = def.shift ? e.shiftKey : !e.shiftKey; // 未声明 shift 的键不允许 Shift 按下（防 Shift+Z 错触 undo）
    if (def.key !== k || !modOk || !shiftOk) continue;
    if (def.needsSelection && !host.getState().selectionId) continue;
    e.preventDefault();
    def.run({ host, selectionId: host.getState().selectionId, toggleCheatSheet: host.toggleCheatSheet });
    return true;
  }
  return false;
}
