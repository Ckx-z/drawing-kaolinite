/**
 * 快捷键体系测试 —— T-7.2
 *
 * 验收：速查表所列快捷键全部生效且无冲突。注册表为单一事实源，
 * 单测覆盖：无键位冲突、分发行为、needsSelection 门控、粘贴偏移、速查去重。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHORTCUTS,
  cheatsheetEntries,
  clearShortcutClipboard,
  handleShortcut,
  type ShortcutHost,
} from './shortcuts';
import { attachHistory, type History } from '../state/history';
import { createSceneStore, type SceneStore } from '../state/sceneStore';

function fakeHost(store: SceneStore, cheat: () => void = () => undefined): ShortcutHost {
  const history: History = attachHistory(store, { mergeWindowMs: 0 });
  return {
    getState: () => store.getState(),
    history,
    toggleCheatSheet: cheat,
  };
}

const ev = (key: string, mods: { mod?: boolean; shift?: boolean } = {}): KeyboardEvent =>
  ({
    key,
    ctrlKey: !!mods.mod && !/Mac/i.test(''),
    metaKey: false,
    shiftKey: !!mods.shift,
    altKey: false,
    preventDefault: vi.fn(),
  }) as unknown as KeyboardEvent;

beforeEach(() => clearShortcutClipboard());

describe('注册表完整性', () => {
  it('所有快捷键（含 mod+shift 组合）无键位冲突', () => {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      const id = `${s.mod ?? 'none'}+${s.shift ? 'shift+' : ''}${s.key}`;
      // Del/Backspace 重复标签合法（同义）；y 与 shift+z 重做同义但键不同
      if (seen.has(id) && s.label !== SHORTCUTS.find((x) => `${x.mod ?? 'none'}+${x.shift ? 'shift+' : ''}${x.key}` === id)?.label) {
        expect.fail(`键位冲突：${id}`);
      }
      seen.set(id, s.label);
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it('速查条目去重且覆盖 undo/redo/复制/粘贴', () => {
    const entries = cheatsheetEntries();
    const labels = entries.map((e) => e.label);
    expect(labels).toContain('撤销');
    expect(labels).toContain('重做');
    expect(labels).toContain('复制选中组件');
    expect(labels).toContain('粘贴副本（偏移 +12Å）');
    // 重做有 shift+z 与 y 两种键位，各占一行（速查表如实展示注册表）
    expect(labels.filter((l) => l === '重做')).toHaveLength(2);
  });
});

describe('分发行为', () => {
  it('Delete 删除选中；无选中时不触发 needsSelection 项', () => {
    const store = createSceneStore();
    const host = fakeHost(store);
    const id = store.getState().addComponent('molecule');
    store.getState().select(id);

    handleShortcut(ev('Delete'), host);
    expect(store.getState().components).toHaveLength(0);

    // 无选中：Delete 不再动作（removeComponent 幂等，无异常）
    expect(() => handleShortcut(ev('Delete'), host)).not.toThrow();
  });

  it('Ctrl/Cmd+Z 撤销、Ctrl+Shift+Z 重做（经历史栈）', () => {
    const store = createSceneStore();
    const host = fakeHost(store);
    store.getState().addComponent('molecule');
    handleShortcut(ev('z', { mod: true }), host);
    expect(store.getState().components).toHaveLength(0); // 撤销
    handleShortcut(ev('z', { mod: true, shift: true }), host);
    expect(store.getState().components).toHaveLength(1); // 重做
  });

  it('H 切换显隐；Esc 取消选中', () => {
    const store = createSceneStore();
    const host = fakeHost(store);
    const id = store.getState().addComponent('molecule');
    store.getState().select(id);
    handleShortcut(ev('h'), host);
    expect(store.getState().components[0].visible).toBe(false);
    handleShortcut(ev('h'), host);
    expect(store.getState().components[0].visible).toBe(true);
    handleShortcut(ev('Escape'), host);
    expect(store.getState().selectionId).toBeNull();
  });

  it('? 打开速查浮层（toggleCheatSheet 被调）', () => {
    const store = createSceneStore();
    const cheat = vi.fn();
    const host = fakeHost(store, cheat);
    handleShortcut(ev('?', { shift: true }), host);
    expect(cheat).toHaveBeenCalled();
  });

  it('未注册按键不消费', () => {
    const store = createSceneStore();
    const host = fakeHost(store);
    const e = ev('q');
    expect(handleShortcut(e, host)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('复制 / 粘贴', () => {
  it('Ctrl+C 复制选中 → Ctrl+V 粘贴副本（参数一致、位置 +12Å、自动选中、入撤销栈）', () => {
    const store = createSceneStore();
    const host = fakeHost(store);
    const id = store.getState().addComponent('halloysite_tube', {
      name: '原管',
      params: { innerR: 18, length: 80, walls: 2, d001: 10, progress: 1, taperDeg: 5, style: '空间填充', curlAxis: 'b', portNoise: 0.5 },
      transform: { position: [10, -6, 0], rotation: [0, 0, 90], scale: 1 },
    });
    store.getState().select(id);

    handleShortcut(ev('c', { mod: true }), host);
    handleShortcut(ev('v', { mod: true }), host);

    const comps = store.getState().components;
    expect(comps).toHaveLength(2);
    const dup = comps[1];
    expect(dup.name).toBe('原管 副本');
    expect(dup.params).toEqual(comps[0].params);
    expect(dup.transform.position).toEqual([22, 6, 0]); // +12Å 偏移
    expect(store.getState().selectionId).toBe(dup.id);  // 自动选中
  });

  it('Ctrl+D 原地副本（位置不变）；剪贴板空时 Ctrl+V 无动作', () => {
    const store = createSceneStore();
    const host = fakeHost(store);
    const id = store.getState().addComponent('molecule');
    store.getState().select(id);
    handleShortcut(ev('d', { mod: true }), host);
    expect(store.getState().components).toHaveLength(2);
    expect(store.getState().components[1].transform.position).toEqual([0, 0, 0]); // 原地

    clearShortcutClipboard();
    const n0 = store.getState().components.length;
    handleShortcut(ev('v', { mod: true }), host);
    expect(store.getState().components).toHaveLength(n0);
  });
});
