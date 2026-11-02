// @vitest-environment jsdom
/**
 * UI 重构 DOM 级验收（2026-09-16，Phase5）：真实渲染 TopBar / ModelPanel /
 * ParamPanel（纯 DOM 组件，SceneCanvas 的 WebGL 不参与），断言信息架构
 * 落地：顶栏六区与收纳、左栏 Tabs 与搜索、参数分组 Accordion、NumberSlider。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { createSceneStore, sceneStore } from '../state/sceneStore';
import TopBar from './TopBar';
import ModelPanel from './ModelPanel';
import { resetModelFavorites } from '../state/modelFavorites';
import ModulePanel from './ModulePanel';
import ParamPanel from './ParamPanel';

let host: HTMLDivElement;
let root: Root;

const render = (el: React.ReactElement): void => {
  act(() => {
    root.render(el);
  });
};
const q = (sel: string): Element | null => host.querySelector(sel);
const qa = (sel: string): Element[] => [...host.querySelectorAll(sel)];
const texts = (sel: string): string[] => qa(sel).map((e) => e.textContent?.trim() ?? '');
const click = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const setInput = (el: HTMLInputElement, v: string): void => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  resetModelFavorites();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  // 画布清空（不影响其他用例）
  const s = sceneStore.getState();
  for (const c of [...s.components]) sceneStore.getState().removeComponent(c.id);
});

describe('TopBar 信息架构（UI 重构 2026-10-22：图标+Tooltip 六按钮）', () => {
  it('核心六按钮严格按 导入→保存→后退→前进→清空→全屏 排序（图标 + data-tip 深色 Tooltip）', () => {
    render(<TopBar />);
    const tips = qa('.topbar .tbi').map((b) => b.getAttribute('data-tip'));
    expect(tips).toEqual(['导入', '保存', '后退', '前进', '清空', '全屏']);
    // Tooltip 文案属性存在（CSS :hover/:focus-visible 显示，DOM 层锁定文案）
    for (const b of qa('.topbar .tbi')) expect(b.getAttribute('data-tip')!.length).toBeGreaterThan(0);
  });

  it('后退/前进随历史栈禁用；点击后退真实回退（非空按钮）', () => {
    sceneStore.getState().addComponent('kaolinite_sheet');
    render(<TopBar />);
    const undoBtn = qa('.topbar .tbi').find((b) => b.getAttribute('data-tip') === '后退') as HTMLButtonElement;
    const redoBtn = qa('.topbar .tbi').find((b) => b.getAttribute('data-tip') === '前进') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);
    click(undoBtn);
    expect(sceneStore.getState().components).toHaveLength(0);
    expect(redoBtn.disabled).toBe(false);
  });

  it('其余功能组保留：分段模式/视角三钮/示例场景/保存为模板/视图与导出下拉', () => {
    render(<TopBar />);
    const segOn = q('.seg-btn.on');
    expect(segOn?.textContent).toContain('3D 混合');
    expect(texts('.seg-btn')).toHaveLength(2);
    expect(texts('.topbar .tb-group button')).toEqual(expect.arrayContaining(['等距', '正视', '俯视']));
    const flat = texts('.topbar > .tb-group > button, .topbar .seg-btn').join('|');
    expect(flat).toContain('保存为模板');
    for (const gone of ['导出 TIFF', '导出 PDF', '导出 SVG', '导出分层 PNG', '导出动画 GIF', '存为模块', '存组合', '保存为…']) {
      expect(flat).not.toContain(gone);
    }
    // 下拉容器（视图/导出）；主动作按钮 = 导出 PNG；示例场景收纳于视图下拉
    expect(qa('.dd-root').length).toBeGreaterThanOrEqual(2);
    expect(texts('.dd-root > button').join('|')).toContain('导出 PNG');
    const viewBtn = qa('.dd-root > button').find((b) => b.textContent?.includes('视图'))!;
    click(viewBtn);
    expect(q('.dd-menu')!.textContent).toContain('示例场景');
  });

  it('导出下拉：打开后六格式 + 设置区（dpi/透明底/像素尺寸）', () => {
    render(<TopBar />);
    const ddBtns = qa('.dd-root > button');
    const exportBtn = ddBtns.find((b) => b.textContent?.includes('导出'))!;
    click(exportBtn.parentElement!.querySelector('.dd-caret-btn')!);
    const menu = q('.dd-menu')!;
    const items = [...menu.querySelectorAll('.dd-item')].map((e) => e.textContent?.trim() ?? '');
    for (const fmt of ['PNG 位图', 'TIFF（期刊）', 'PDF', 'SVG 矢量', '分层 PNG', '动画 GIF']) expect(items).toContain(fmt);
    expect(menu.querySelector('select')).toBeTruthy();
    expect(menu.textContent).toContain('dpi');
  });
});

describe('ModelPanel（UI 重构 2026-10-22：分类+搜索一行 / 两列卡片 / 收藏）', () => {
  it('全量素材数据驱动渲染：分类选项来自真实 typeBadge；默认含基础组件与具体分子卡', () => {
    render(<ModelPanel mode="all" />);
    const opts = qa('.mp-cat option').map((o) => o.textContent?.trim() ?? '');
    expect(opts[0]).toBe('全部');
    expect(opts).toContain('分子');
    expect(opts).toContain('模块库');
    // 两列网格卡片：24 素材卡（ASSET_INDEX 全量），名称含基础组件与具体分子
    const names = texts('.mp-card .mp-name').join('|');
    expect(names).toContain('埃洛石纳米管');
    expect(names).toContain('甲苯');
    expect(qa('.mp-card').length).toBeGreaterThanOrEqual(24);
    // 搜索框 placeholder + 搜索图标
    const search = qa('input').find((i) => (i as HTMLInputElement).placeholder === '请输入关键字搜索') as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(q('.mp-search-ic')).toBeTruthy();
  });

  it('搜索过滤：甲苯直出；无匹配 → 简洁空状态', () => {
    render(<ModelPanel mode="all" />);
    const search = qa('input').find((i) => (i as HTMLInputElement).placeholder === '请输入关键字搜索') as HTMLInputElement;
    setInput(search, '甲苯');
    const names = texts('.mp-card .mp-name');
    expect(names).toContain('甲苯');
    expect(names.length).toBeLessThanOrEqual(3);
    setInput(search, 'zzz');
    expect(host.textContent).toContain('未找到匹配的素材');
  });

  it('收藏：卡片 ☆ 点击 → 收藏态持久；收藏视图同步；取消后消失', () => {
    render(<ModelPanel mode="all" />);
    const star = qa('.mp-card .mp-fav')[0] as HTMLButtonElement;
    click(star);
    expect(star.className).toContain('on');
    // 收藏视图（同一 store 单源）
    render(<ModelPanel mode="fav" />);
    expect(qa('.mp-card').length).toBe(1);
    // 取消收藏 → 收藏视图空
    click(qa('.mp-card .mp-fav')[0]);
    render(<ModelPanel mode="fav" />);
    expect(host.textContent).toContain('还没有收藏');
  });

  it('点击卡片 = 原 Direct Add 路径（组件 +1 且选中）', () => {
    render(<ModelPanel mode="all" />);
    const before = sceneStore.getState().components.length;
    click(qa('.mp-card')[0]);
    expect(sceneStore.getState().components.length).toBe(before + 1);
    expect(sceneStore.getState().selectionId).toBeTruthy();
  });

  it('分类筛选：选「模块库」→ 素材网格隐藏（渲染层验证分类×搜索叠加的数据分流）', () => {
    render(<ModelPanel mode="all" />);
    const cat = q('.mp-cat') as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(cat, '模块库');
      cat.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(texts('.mp-card .mp-name').join('|')).not.toContain('埃洛石纳米管');
  });
});

describe('保存为模板（真实缩略图管线，2026-09-17）', () => {
  it('缩略图走真实整景管线（snapshotTemplate，非占位）', async () => {
    const id = sceneStore.getState().addComponent('kaolinite_sheet');
    const shapeId = sceneStore.getState().addShape({ type: 'text', x: 10, y: 10, w: 60, h: 24, text: 'A' } as never);
    const { rendererRef } = await import('../state/rendererRef');
    const prev = rendererRef.current;
    rendererRef.current = {
      camera: { position: { toArray: () => [11, 22, 33] } },
      orbit: { target: { toArray: () => [1, 2, 3] } },
      snapshotTemplate: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      renderer: { domElement: { clientWidth: 800, clientHeight: 600 }, capabilities: { maxTextureSize: 8192 } },
    } as never;
    try {
      render(<TopBar />);
      const btn = qa('button').find((b) => b.textContent?.includes('保存为模板'))!;
      expect(btn).toBeTruthy();
      click(btn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 80));
      });
      const { listModules } = await import('../state/moduleLibrary');
      const saved = (await listModules()).find((m) => m.type === 'template' && m.name.startsWith('我的模板'));
      expect(saved).toBeTruthy();
      expect(saved!.thumb).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
      expect(saved!.thumb).not.toContain('data-ph');
      const tpl = saved as { shapes?: unknown[]; camera?: unknown; mode?: string };
      expect(tpl.shapes).toHaveLength(1);
      expect(tpl.camera).toEqual({ position: [11, 22, 33], target: [1, 2, 3] });
      expect(tpl.mode).toBe('mixed');
    } finally {
      rendererRef.current = prev;
      sceneStore.getState().removeComponent(id);
      sceneStore.getState().removeShape(shapeId);
    }
  });
});

describe('模板重命名（2026-09-17 修复：内联编辑替代 prompt，Tauri 打包版可用）', () => {
  it('点击 ✎ 进入编辑态且不触发打开模板；Enter 保存后卡片立即显示新名', async () => {
    // spy openTemplate 的底层调用（loadScene）
    const { sceneStore: store } = await import('../state/sceneStore');
    const loads: unknown[] = [];
    const origLoad = store.getState().loadScene;
    (store as unknown as { setState: (p: unknown) => void }).setState({
      loadScene: (raw: unknown) => {
        loads.push(raw);
        return origLoad(raw);
      },
    });
    try {
      render(<ModulePanel />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
      const card = qa('.mod-card')[0];
      expect(card).toBeTruthy();
      const before = card.querySelector('.n')?.textContent;

      const pencil = card.querySelector('.ren') as HTMLElement;
      expect(pencil).toBeTruthy();
      click(pencil);
      // Test 1：进入编辑态（input 出现并聚焦）
      const input = card.querySelector('.mod-rename') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe(before);
      // Test 9：点击 ✎ 没有触发 openTemplate（loadScene 零调用）
      expect(loads).toHaveLength(0);

      // 输入新名 + Enter 保存
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, '实验一：莫来石-CeO₂');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      // UI 立即刷新：卡片显示新名
      expect(card.querySelector('.mod-rename')).toBeNull(); // 编辑态关闭
      expect(card.querySelector('.n')?.textContent).toBe('实验一：莫来石-CeO₂');
      // 数据层持久（Dexie 重读）
      const { listModules } = await import('../state/moduleLibrary');
      const all = await listModules();
      const renamed = all.find((m) => m.name === '实验一：莫来石-CeO₂');
      expect(renamed).toBeTruthy();
      // 全程未打开模板
      expect(loads).toHaveLength(0);
    } finally {
      (store as unknown as { setState: (p: unknown) => void }).setState({ loadScene: origLoad });
    }
  });

  it('空名保存被拒绝且保持编辑态；Esc 取消恢复原名', async () => {
    render(<ModulePanel />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const card = qa('.mod-card')[0];
    const before = card.querySelector('.n')?.textContent;
    click(card.querySelector('.ren') as HTMLElement);
    const input = card.querySelector('.mod-rename') as HTMLInputElement;

    // 空名 → 拒绝，编辑态保持
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '   ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(card.querySelector('.mod-rename')).toBeTruthy(); // 未关闭
    expect((card.querySelector('.mod-rename') as HTMLInputElement).style.borderColor).toBe('rgb(229, 115, 95)'); // 红框提示（#e5735f）

    // Esc → 取消，恢复原名
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(card.querySelector('.mod-rename')).toBeNull();
    expect(card.querySelector('.n')?.textContent).toBe(before);
  });
});

describe('ParamPanel 分组与 NumberSlider（Phase2）', () => {
  it('选中片层 → 分组 Accordion：基础默认展开、高级折叠；滑块+数字输入双向存在', () => {
    const id = sceneStore.getState().addComponent('kaolinite_sheet');
    sceneStore.getState().select(id);
    render(<ParamPanel />);
    const heads = texts('.acc-head');
    expect(heads[0]).toContain('基础');
    const headsJoined = heads.join('|');
    for (const g of ['晶体结构', '显示', '高级']) expect(headsJoined).toContain(g);
    // 基础展开：Lx 的数字输入可见；高级折叠：strictCell 不可见
    expect(host.textContent).toContain('横向尺寸');
    expect(host.textContent).not.toContain('晶学严格模式');
    // 展开高级
    click(qa('.acc-head').find((h) => h.textContent?.includes('高级'))!);
    expect(host.textContent).toContain('晶学严格模式');
    // NumberSlider：数值输入 + 单位独立
    const num = qa('.numin')[0] as HTMLInputElement;
    expect(num).toBeTruthy();
    const wrap = num.closest('.numwrap')!;
    expect(wrap.querySelector('.unit')?.textContent).toBe('Å');
  });

  it('NumberSlider 数字输入提交钳制到 [min,max]', () => {
    const id = sceneStore.getState().addComponent('kaolinite_sheet');
    sceneStore.getState().select(id);
    render(<ParamPanel />);
    const num = qa('.numin').find((i) => (i as HTMLInputElement).value === '60') as HTMLInputElement; // Ly 默认 60
    expect(num).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(num, '999');
      num.dispatchEvent(new Event('input', { bubbles: true }));
      num.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      num.dispatchEvent(new FocusEvent('blur'));
    });
    const comp = sceneStore.getState().components.find((c) => c.id === id)!;
    expect((comp.params as { Ly: number }).Ly).toBe(150); // max 150
  });

  it('多选 ≥2 → 批量区（BatchSection）接管面板', () => {
    const a = sceneStore.getState().addComponent('kaolinite_sheet');
    const b = sceneStore.getState().addComponent('nanoparticle');
    sceneStore.getState().selectComponentIds([a, b]);
    render(<ParamPanel />);
    expect(host.textContent).toContain('对齐');
  });
});

describe('独立 store 工厂（防御回归）', () => {
  it('createSceneStore 仍可独立创建（不因 UI 重构破坏）', () => {
    const store = createSceneStore();
    expect(store.getState().components).toHaveLength(0);
  });
});
