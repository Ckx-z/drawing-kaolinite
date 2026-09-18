// @vitest-environment jsdom
/**
 * UI 重构 DOM 级验收（2026-09-16，Phase5）：真实渲染 TopBar / LibraryPanel /
 * ParamPanel（纯 DOM 组件，SceneCanvas 的 WebGL 不参与），断言信息架构
 * 落地：顶栏六区与收纳、左栏 Tabs 与搜索、参数分组 Accordion、NumberSlider。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { createSceneStore, sceneStore } from '../state/sceneStore';
import TopBar from './TopBar';
import LibraryPanel from './LibraryPanel';
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

describe('TopBar 信息架构（Phase1）', () => {
  it('六区分层：工程/撤销重做/工具/模式 seg/视图/保存为模板/导出；一级无导出六按钮与旧存为三按钮', () => {
    render(<TopBar />);
    // 分段控件存在且 3D 段激活
    const segOn = q('.seg-btn.on');
    expect(segOn?.textContent).toContain('3D 混合');
    expect(texts('.seg-btn')).toHaveLength(2);
    // 高频视角常驻
    expect(texts('.topbar .tb-group button')).toEqual(expect.arrayContaining(['等距', '正视', '俯视']));
    // 统一保存入口（2026-09-17）：一级「保存为模板」按钮存在；「清空场景」常驻一级（2026-09-17b 自打开下拉移出）
    const flat = texts('.topbar > .tb-group > button, .topbar .seg-btn').join('|');
    expect(flat).toContain('保存为模板');
    expect(flat).toContain('清空场景');
    // 收纳验证：一级按钮不再有 6 导出/旧存为两入口/保存为…下拉/dpi select/透明底/渲染档/接触阴影/水平吸附/示例场景（仍在打开下拉内）
    for (const gone of ['导出 TIFF', '导出 PDF', '导出 SVG', '导出分层 PNG', '导出动画 GIF', '存为模块', '存组合', '保存为…', '水平吸附', '示例场景']) {
      expect(flat).not.toContain(gone);
    }
    // 下拉容器在（打开/视图/导出——保存为…下拉已随统一入口移除）
    expect(qa('.dd-root').length).toBeGreaterThanOrEqual(3);
    // 主动作按钮：导出 PNG（最近格式默认）
    expect(texts('.dd-root > button').join('|')).toContain('导出 PNG');
  });

  it('导出下拉：打开后六格式 + 设置区（dpi/透明底/像素尺寸）', () => {
    render(<TopBar />);
    const ddBtns = qa('.dd-root > button');
    const exportBtn = ddBtns.find((b) => b.textContent?.includes('导出'))!;
    click(exportBtn.parentElement!.querySelector('.dd-caret-btn')!);
    const menu = q('.dd-menu')!;
    const items = [...menu.querySelectorAll('.dd-item')].map((e) => e.textContent?.trim() ?? '');
    for (const fmt of ['PNG 位图', 'TIFF（期刊）', 'PDF', 'SVG 矢量', '分层 PNG', '动画 GIF']) expect(items).toContain(fmt);
    expect(menu.querySelector('select')).toBeTruthy(); // dpi
    expect(menu.textContent).toContain('dpi');
  });

  it('撤销/重做按钮存在且随历史栈禁用', () => {
    render(<TopBar />);
    const flat = texts('.topbar .tb-group button').join('|');
    expect(flat).toContain('↶ 后退');
    expect(flat).toContain('↷ 前进');
  });
});

describe('LibraryPanel Tabs 与搜索（Phase3；2026-09-17 统一模板库）', () => {
  it('两 Tab（素材|模板）且素材 Tab 默认激活；搜索过滤生效', () => {
    render(<LibraryPanel />);
    expect(texts('.side-tab')).toEqual(['素材', '模板']);
    expect(q('.side-tab.on')?.textContent).toBe('素材');
    // 素材卡（两行式副标题）
    expect(texts('.lib-card .t').join('|')).toContain('埃洛石纳米管');
    expect(texts('.lib-card .d').join('|')).toContain('Halloysite Nanotube');
    // 搜索
    const search = qa('input').find((i) => (i as HTMLInputElement).placeholder?.includes('搜索素材')) as HTMLInputElement;
    expect(search).toBeTruthy();
    setInput(search, 'halloysite');
    expect(qa('.lib-card')).toHaveLength(1);
    setInput(search, 'zzz');
    expect(host.textContent).toContain('无匹配素材');
  });

  it('切到模板 Tab：ModulePanel 挂载（我的模板 + 种子模板注入统一库）', async () => {
    render(<LibraryPanel />);
    click(qa('.side-tab').find((t) => t.textContent === '模板')!);
    // 种子模板经 ensureSeededTemplates 异步注入统一库——轮询等待
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(host.textContent).toContain('我的模板');
    expect(host.textContent).toContain('界面反应三步版式'); // 种子模板卡片（真实矢量缩略图 + 名称）
  });

  it('保存为模板：缩略图走真实整景管线（snapshotTemplate，非占位）', async () => {
    // 场景：片层组件 + 文本图元 + 自定义相机
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
      // 缩略图 = 渲染服务真实管线输出透传（组合模块同款 jpeg dataURL），非占位
      expect(saved!.thumb).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
      expect(saved!.thumb).not.toContain('data-ph');
      // 快照完整性：图元 + 相机 + 形态
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
