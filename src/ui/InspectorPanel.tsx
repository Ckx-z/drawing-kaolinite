/**
 * 右侧检查器（科图网式高保真改造，2026-11-04）
 *
 * 双区结构：顶部 = 场景对象树（LayerPanel 原样复用，独立滚动，高度可拖拽）；
 * 底部 = 「场景 / 材质 / 对象」三 Tab（青蓝激活线，内容独立滚动，Tab 常驻可见）。
 * 切 Tab / 切对象不触碰 WebGLRenderer；所有控件读写单一事实源
 * （sceneStore 组件字段 / RendererService 真实接口），无 defaultChecked 冒充。
 *
 * - 场景：场景配置（线框=材质渲染开关 / 坐标轴=AxesHelper 编辑辅助）+
 *   描边线（选中对象轮廓外壳：开关/颜色/厚度/发光，复用高亮外壳管线）+
 *   更多场景设置（透视网格/背景/阴影/预设视角/重置取景）。
 * - 材质：一键设置 4 圆形视觉预设（金属/玻璃/液体/凝胶，CSS 渐变缩略图，
 *   视觉近似非科学物性）+ 基础属性（整体着色/高光强度=clearcoat/粗糙度）+
 *   高级属性（金属度/不透明度，折叠）。滑块拖动实时预览渲染、释放提交
 *   sceneStore.setAppearance（一次撤销，P2 起随场景持久化）；切换对象时
 *   全部控件从该对象的真实 appearance 回显，无残留。
 * - 对象：ParamPanel 原样（科研参数/吸附/缺陷/测量全功能，浅色主题继承）。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { ComponentAppearance } from '../core/types';
import { APPEARANCE_PRESETS, type AppearancePreset } from '../render/appearance';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import LayerPanel from './LayerPanel';
import ParamPanel from './ParamPanel';

type InspectorTab = 'scene' | 'material' | 'object';

const TABS: Array<[InspectorTab, string]> = [
  ['scene', '场景'],
  ['material', '材质'],
  ['object', '对象'],
];

const PRESET_META: Array<{ key: AppearancePreset; label: string; tip: string; thumb: string }> = [
  { key: 'metal', label: '金属', tip: '高金属度低粗糙的金属光泽（视觉近似）', thumb: 'preset-thumb-metal' },
  { key: 'glass', label: '玻璃', tip: '低粗糙半透明的透明感（视觉近似）', thumb: 'preset-thumb-glass' },
  { key: 'liquid', label: '液体', tip: '低粗糙带透明的液滴感（视觉近似）', thumb: 'preset-thumb-liquid' },
  { key: 'gel', label: '凝胶', tip: '高粗糙半透明的凝胶感（视觉近似）', thumb: 'preset-thumb-gel' },
];

/* ================= 场景 Tab ================= */

function SceneTab(): React.ReactElement {
  const svc = rendererRef.current;
  const [wireframe, setWireframe] = useState(() => svc?.getWireframeAll() ?? false);
  const [axes, setAxes] = useState(() => svc?.getAxesVisible() ?? false);
  const ol = svc?.getSelectionOutlineStyle();
  const [outlineOn, setOutlineOn] = useState(ol?.enabled ?? true);
  const [outlineColor, setOutlineColor] = useState(ol?.color ?? '#e59a20');
  const [strength, setStrength] = useState(Math.round(((ol?.scale ?? 1.15) - 1) * 100));
  const [glow, setGlow] = useState(Math.round((ol?.glow ?? 0.85) * 100));
  const [gridOpacity, setGridOpacity] = useState(() => svc?.getViewportGridStyle().opacity ?? 0.75);
  const [minor, setMinor] = useState('#c7ced8');
  const [major, setMajor] = useState('#a8b2c0');
  const [bg, setBg] = useState(() => svc?.getBackground() ?? '#f4f5f7');
  const [shadows, setShadows] = useState(() => svc?.getShadows() ?? false);
  const [gridOn, setGridOn] = useState(true);

  return (
    <div className="insp-body">
      <div className="insp-group">
        <div className="insp-group-title">场景配置</div>
        <label className="insp-row" title="全部组件的渲染材质切换线框显示（渲染风格，不影响科学几何；随导出呈现）">
          <span>线框</span>
          <Toggle on={wireframe} onChange={(v) => { setWireframe(v); svc?.setWireframeAll(v); }} />
        </label>
        <label className="insp-row" title="世界原点坐标轴辅助（编辑辅助，不进导出）">
          <span>坐标轴</span>
          <Toggle on={axes} onChange={(v) => { setAxes(v); svc?.setAxesVisible(v); }} />
        </label>
      </div>

      <div className="insp-group">
        <div className="insp-group-title">描边线</div>
        <label className="insp-row" title="选中对象的轮廓外壳（反转法线管线，16k 原子兼容；编辑辅助不进导出）">
          <span>描边线</span>
          <Toggle on={outlineOn} onChange={(v) => { setOutlineOn(v); svc?.setSelectionOutlineStyle({ enabled: v }); }} />
        </label>
        <label className="insp-row">
          <span>颜色<span className="insp-rgb">{rgbString(outlineColor)}</span></span>
          <input type="color" value={outlineColor} onChange={(e) => { setOutlineColor(e.target.value); svc?.setSelectionOutlineStyle({ color: e.target.value }); }} />
        </label>
        <div className="insp-row">
          <span>轮廓强度</span>
          <span className="insp-slider">
            <input type="range" min={0} max={40} step={1} value={strength} onChange={(e) => { const v = Number(e.target.value); setStrength(v); svc?.setSelectionOutlineStyle({ scale: 1 + v / 100 }); }} />
            <input className="insp-num" type="number" min={0} max={40} value={strength}
              onChange={(e) => { const v = clampInt(e.target.value, 0, 40); setStrength(v); svc?.setSelectionOutlineStyle({ scale: 1 + v / 100 }); }} />
          </span>
        </div>
        <div className="insp-row">
          <span>轮廓发光</span>
          <span className="insp-slider">
            <input type="range" min={0} max={100} step={1} value={glow} onChange={(e) => { const v = Number(e.target.value); setGlow(v); svc?.setSelectionOutlineStyle({ glow: v / 100 }); }} />
            <input className="insp-num" type="number" min={0} max={100} value={glow}
              onChange={(e) => { const v = clampInt(e.target.value, 0, 100); setGlow(v); svc?.setSelectionOutlineStyle({ glow: v / 100 }); }} />
          </span>
        </div>
      </div>

      <div className="insp-group">
        <div className="insp-group-title">更多场景设置</div>
        <label className="insp-row" title="世界空间透视网格（编辑辅助，不进导出）">
          <span>显示网格</span>
          <Toggle on={gridOn} onChange={(v) => { setGridOn(v); svc?.setViewportGridStyle({ visible: v }); }} />
        </label>
        <label className="insp-row">
          <span>细线颜色</span>
          <input type="color" value={minor} onChange={(e) => { setMinor(e.target.value); svc?.setViewportGridStyle({ minorColor: e.target.value }); }} />
        </label>
        <label className="insp-row">
          <span>主线颜色</span>
          <input type="color" value={major} onChange={(e) => { setMajor(e.target.value); svc?.setViewportGridStyle({ majorColor: e.target.value }); }} />
        </label>
        <div className="insp-row">
          <span>网格浓度</span>
          <span className="insp-slider">
            <input type="range" min={0.15} max={1} step={0.05} value={gridOpacity} onChange={(e) => { const v = Number(e.target.value); setGridOpacity(v); svc?.setViewportGridStyle({ opacity: v }); }} />
            <input className="insp-num" type="number" min={15} max={100} value={Math.round(gridOpacity * 100)}
              onChange={(e) => { const v = clampInt(e.target.value, 15, 100) / 100; setGridOpacity(v); svc?.setViewportGridStyle({ opacity: v }); }} />
          </span>
        </div>
        <label className="insp-row">
          <span>背景色</span>
          <input type="color" value={bg} onChange={(e) => { setBg(e.target.value); svc?.setBackgroundColor(e.target.value); }} />
        </label>
        <label className="insp-row" title="方向光 shadow map + 接影地板（接触阴影随导出呈现）">
          <span>接触阴影</span>
          <Toggle on={shadows} onChange={(v) => { setShadows(v); svc?.setShadows(v); }} />
        </label>
        <div className="insp-btnrow">
          {(['iso', 'front', 'top'] as const).map((p) => (
            <button key={p} className="mini" onClick={() => rendererRef.current?.setCameraPreset(p)}>
              {p === 'iso' ? '等距' : p === 'front' ? '正视' : '俯视'}
            </button>
          ))}
          <button className="mini" onClick={() => rendererRef.current?.frameAll()}>重置取景</button>
        </div>
      </div>
      <p className="insp-note">网格为视觉参考（间距随视距自适应），不改变任何科学单位；坐标轴与描边为编辑辅助，不出现在导出图中。</p>
    </div>
  );
}

/* ================= 材质 Tab ================= */

function MaterialTab(): React.ReactElement {
  const selectedId = useStore(sceneStore, (s) => s.selectionId);
  const comp = useStore(sceneStore, (s) => s.components.find((c) => c.id === s.selectionId) ?? null);
  const appearance = comp?.appearance;
  const selId: string = selectedId ?? ''; // 运行时由下方守卫保证非空

  // 回显：切换对象 / 撤销重做 / 载入 → 全部控件从对象真实 appearance 恢复（无残留）
  const [preset, setPreset] = useState<AppearancePreset>('default');
  const [tintOn, setTintOn] = useState(false);
  const [tint, setTint] = useState('#8fb8c9');
  const [clearcoat, setClearcoat] = useState<number | null>(null);
  const [roughness, setRoughness] = useState<number | null>(null);
  const [metalness, setMetalness] = useState<number | null>(null);
  const [opacity, setOpacity] = useState<number | null>(null);

  useEffect(() => {
    setPreset(appearance?.preset ?? 'default');
    setTintOn(Boolean(appearance?.colorOverride));
    setTint(appearance?.colorOverride ?? '#8fb8c9');
    setClearcoat(appearance?.clearcoat ?? null);
    setRoughness(appearance?.roughness ?? null);
    setMetalness(appearance?.metalness ?? null);
    setOpacity(appearance?.opacity ?? null);
  }, [selectedId, appearance]);

  /** 提交（一次撤销）；preset 恒有；undefined 微调项 = 预设基值 */
  const commit = (patch: ComponentAppearance): void => {
    sceneStore.getState().setAppearance(selId, patch);
  };

  /** 滑块拖动：实时渲染预览（不进历史）；释放（pointerup/keyup/blur）提交 store = 一次撤销 */
  const preview = (partial: Partial<ComponentAppearance>): void => {
    const merged: ComponentAppearance = {
      preset: partial.preset ?? preset,
      colorOverride: partial.colorOverride !== undefined ? partial.colorOverride : tintOn ? tint : null,
      roughness: partial.roughness ?? roughness ?? undefined,
      metalness: partial.metalness ?? metalness ?? undefined,
      opacity: partial.opacity ?? opacity ?? undefined,
      clearcoat: partial.clearcoat ?? clearcoat ?? undefined,
      ...partial,
    };
    rendererRef.current?.setComponentAppearance(selId, merged);
  };

  const commitFromState = (): void => {
    commit({
      preset,
      colorOverride: tintOn ? tint : null,
      roughness: roughness ?? undefined,
      metalness: metalness ?? undefined,
      opacity: opacity ?? undefined,
      clearcoat: clearcoat ?? undefined,
    });
  };

  if (!selectedId || !comp) {
    return (
      <div className="insp-body">
        <div className="insp-empty">未选中对象——点击画布或对象列表后可调整视觉外观。</div>
      </div>
    );
  }

  return (
    <div className="insp-body">
      <div className="insp-group">
        <div className="insp-group-title">一键设置<span className="insp-tip">（{comp.name}）</span></div>
        <div className="insp-presets">
          {PRESET_META.map((p) => (
            <button
              key={p.key}
              className={`insp-preset${preset === p.key ? ' on' : ''}`}
              title={p.tip}
              onClick={() => {
                setPreset(p.key);
                commit({ preset: p.key, colorOverride: tintOn ? tint : null });
              }}
            >
              <span className={`insp-thumb ${p.thumb}`} />
              <span className="insp-preset-label">{p.label}</span>
            </button>
          ))}
        </div>
        <div className="insp-btnrow">
          <button
            className="mini"
            onClick={() => {
              setPreset('default'); setTintOn(false); setClearcoat(null); setRoughness(null); setMetalness(null); setOpacity(null);
              sceneStore.getState().setAppearance(selId, null);
            }}
            title="恢复元素色板的科学材质（外观清空）"
          >
            恢复科研材质
          </button>
        </div>
      </div>

      <div className="insp-group">
        <div className="insp-group-title">基础属性</div>
        <div className="insp-row">
          <span>颜色</span>
          <span className="insp-colorset">
            <span className="insp-rgb" style={tintOn ? { background: tint, color: '#fff', borderColor: 'transparent' } : undefined}>{tintOn ? rgbString(tint) : '元素配色'}</span>
            <input
              type="checkbox"
              checked={tintOn}
              title="整体着色（关闭 = 保留元素色板的科学辨识性）"
              onChange={(e) => {
                setTintOn(e.target.checked);
                commit({ preset, colorOverride: e.target.checked ? tint : null, roughness: roughness ?? undefined, metalness: metalness ?? undefined, opacity: opacity ?? undefined, clearcoat: clearcoat ?? undefined });
              }}
            />
            <input
              type="color"
              value={tint}
              disabled={!tintOn}
              onChange={(e) => { setTint(e.target.value); if (tintOn) commit({ preset, colorOverride: e.target.value, roughness: roughness ?? undefined, metalness: metalness ?? undefined, opacity: opacity ?? undefined, clearcoat: clearcoat ?? undefined }); }}
            />
          </span>
        </div>
        <div className="insp-row">
          <span title="材质高光强度（clearcoat 清漆层，0–100 映射 0–1）">高光强度</span>
          <span className="insp-slider">
            <input
              type="range" min={0} max={100} step={1}
              value={Math.round((clearcoat ?? APPEARANCE_PRESETS[preset].clearcoat) * 100)}
              onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setClearcoat(v / 100); preview({ clearcoat: v / 100 }); }}
              onPointerUp={commitFromState}
              onKeyUp={commitFromState}
              onBlur={commitFromState}
            />
            <input className="insp-num" type="number" min={0} max={100}
              value={Math.round((clearcoat ?? APPEARANCE_PRESETS[preset].clearcoat) * 100)}
              onChange={(e) => { const v = clampInt(e.target.value, 0, 100); setClearcoat(v / 100); preview({ clearcoat: v / 100 }); }}
              onBlur={commitFromState}
            />
          </span>
        </div>
        <div className="insp-row">
          <span title="表面粗糙程度（0–100 映射 three.js roughness 0–1）">粗糙度</span>
          <span className="insp-slider">
            <input
              type="range" min={0} max={100} step={1}
              value={Math.round((roughness ?? APPEARANCE_PRESETS[preset].roughness) * 100)}
              onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setRoughness(v / 100); preview({ roughness: v / 100 }); }}
              onPointerUp={commitFromState}
              onKeyUp={commitFromState}
              onBlur={commitFromState}
            />
            <input className="insp-num" type="number" min={0} max={100}
              value={Math.round((roughness ?? APPEARANCE_PRESETS[preset].roughness) * 100)}
              onChange={(e) => { const v = clampInt(e.target.value, 0, 100); setRoughness(v / 100); preview({ roughness: v / 100 }); }}
              onBlur={commitFromState}
            />
          </span>
        </div>
      </div>

      <details className="insp-adv">
        <summary className="insp-group-title">高级属性</summary>
        <div className="insp-row">
          <span>金属度</span>
          <span className="insp-slider">
            <input type="range" min={0} max={100} step={1}
              value={Math.round((metalness ?? APPEARANCE_PRESETS[preset].metalness) * 100)}
              onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setMetalness(v / 100); preview({ metalness: v / 100 }); }}
              onPointerUp={commitFromState} onKeyUp={commitFromState} onBlur={commitFromState}
            />
            <input className="insp-num" type="number" min={0} max={100}
              value={Math.round((metalness ?? APPEARANCE_PRESETS[preset].metalness) * 100)}
              onChange={(e) => { const v = clampInt(e.target.value, 0, 100); setMetalness(v / 100); preview({ metalness: v / 100 }); }}
              onBlur={commitFromState}
            />
          </span>
        </div>
        <div className="insp-row">
          <span>不透明度</span>
          <span className="insp-slider">
            <input type="range" min={5} max={100} step={1}
              value={Math.round((opacity ?? APPEARANCE_PRESETS[preset].opacity) * 100)}
              onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setOpacity(v / 100); preview({ opacity: v / 100 }); }}
              onPointerUp={commitFromState} onKeyUp={commitFromState} onBlur={commitFromState}
            />
            <input className="insp-num" type="number" min={5} max={100}
              value={Math.round((opacity ?? APPEARANCE_PRESETS[preset].opacity) * 100)}
              onChange={(e) => { const v = clampInt(e.target.value, 5, 100); setOpacity(v / 100); preview({ opacity: v / 100 }); }}
              onBlur={commitFromState}
            />
          </span>
        </div>
      </details>

      <p className="insp-note">
        视觉预设为渲染质感近似，不代表真实金属光学/凝胶流变/分子动力学性质；外观随场景保存（撤销/重做/模板一致），元素配色默认保留科学辨识性。
      </p>
    </div>
  );
}

/* ================= 工具 ================= */

function Toggle(props: { on: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <button
      type="button"
      className={`insp-toggle${props.on ? ' on' : ''}`}
      role="switch"
      aria-checked={props.on}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="knob" />
    </button>
  );
}

function clampInt(raw: string, lo: number, hi: number): number {
  const v = Math.round(Number(raw));
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function rgbString(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}

/* ================= 面板骨架（白色双区：对象树 + 三 Tab） ================= */

export default function InspectorPanel(): React.ReactElement {
  const [tab, setTab] = useState<InspectorTab>('object');
  const treeRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(220);

  /** 对象树高度拖拽分隔：clamp 120px–60% */
  const startDrag = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = treeHeight;
    const host = treeRef.current?.parentElement;
    const maxH = host ? host.clientHeight * 0.6 : 420;
    const onMove = (ev: PointerEvent): void => {
      setTreeHeight(Math.min(maxH, Math.max(120, startH + ev.clientY - startY)));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside className="panel right insp">
      <div className="insp-tree" ref={treeRef} style={{ height: treeHeight }}>
        <LayerPanel />
      </div>
      <div className="insp-vdrag" onPointerDown={startDrag} title="拖拽调整对象列表高度" />
      <div className="insp-bottom">
        <div className="insp-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`insp-tab${tab === key ? ' on' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="insp-content">
          {tab === 'scene' && (
            <div className="insp-scroll">
              <SceneTab />
            </div>
          )}
          {tab === 'material' && (
            <div className="insp-scroll">
              <MaterialTab />
            </div>
          )}
          {tab === 'object' && (
            <div className="insp-scroll">
              <ParamPanel />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
