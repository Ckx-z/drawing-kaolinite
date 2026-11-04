/**
 * 右侧检查器（三维工作台升级 P1，2026-11-03，参考科图网录屏 11–14 秒）
 *
 * 结构：顶部 = 场景对象列表（复用 LayerPanel 原样）；下方 = 「场景 / 材质 / 对象」
 * 三 Tab（纯 React 本地态，切换不触碰 WebGLRenderer——录屏验收项）。
 * - 场景：透视网格开关/主次线颜色/不透明度、背景色、接触阴影、预设视角、重置取景
 *   （全部直连 RendererService 现有接口 + P0-A 新增 setViewportGridStyle）；
 * - 材质：会话级视觉外观预设（原图/金属/玻璃/液体/凝胶）+ 粗糙度/金属度/不透明度/
 *   整体着色，作用对象 = 当前选中组件（setComponentAppearance）。视觉外观 ≠ 科学
 *   材料物性；元素色板默认保留；不写入场景文件（P2 持久化）；
 * - 对象：原样承载 ParamPanel（科研参数/吸附/缺陷全功能）。
 */
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import LayerPanel from './LayerPanel';
import ParamPanel from './ParamPanel';
import { APPEARANCE_PRESETS, type AppearancePreset } from '../render/appearance';

type InspectorTab = 'scene' | 'material' | 'object';

const PRESET_LABELS: Array<[AppearancePreset, string, string]> = [
  ['default', '原图', '项目期刊质感（元素色板）'],
  ['metal', '金属', '高金属度低粗糙的金属光泽（视觉近似）'],
  ['glass', '玻璃', '低粗糙半透明的透明感（视觉近似）'],
  ['liquid', '液体', '低粗糙带透明的液滴感（视觉近似）'],
  ['gel', '凝胶', '高粗糙半透明的凝胶感（视觉近似）'],
];

function SceneTab(): React.ReactElement {
  const [, bump] = useState(0);
  const [gridOpacity, setGridOpacity] = useState(0.75);
  const [minor, setMinor] = useState('#c7ced8');
  const [major, setMajor] = useState('#a8b2c0');
  const [bg, setBg] = useState('#f4f5f7');
  const [shadows, setShadows] = useState(false);

  useEffect(() => {
    const svc = rendererRef.current;
    if (!svc) return;
    setShadows(svc.getShadows());
    setBg(svc.getBackground());
    setGridOpacity(svc.getViewportGridStyle().opacity);
  }, []);

  const sync = (fn: () => void): void => {
    fn();
    bump((v) => v + 1);
  };

  return (
    <div className="insp-body">
      <div className="insp-sec">透视网格</div>
      <label className="insp-row">
        <span>显示网格</span>
        <input
          type="checkbox"
          defaultChecked
          onChange={(e) => sync(() => rendererRef.current?.setViewportGridStyle({ visible: e.target.checked }))}
        />
      </label>
      <label className="insp-row">
        <span>细线颜色</span>
        <input type="color" value={minor} onChange={(e) => { setMinor(e.target.value); sync(() => rendererRef.current?.setViewportGridStyle({ minorColor: e.target.value })); }} />
      </label>
      <label className="insp-row">
        <span>主线颜色</span>
        <input type="color" value={major} onChange={(e) => { setMajor(e.target.value); sync(() => rendererRef.current?.setViewportGridStyle({ majorColor: e.target.value })); }} />
      </label>
      <label className="insp-row">
        <span>网格浓度</span>
        <input type="range" min={0.15} max={1} step={0.05} value={gridOpacity} onChange={(e) => { const v = Number(e.target.value); setGridOpacity(v); sync(() => rendererRef.current?.setViewportGridStyle({ opacity: v })); }} />
      </label>

      <div className="insp-sec">画布</div>
      <label className="insp-row">
        <span>背景色</span>
        <input type="color" value={bg} onChange={(e) => { setBg(e.target.value); sync(() => rendererRef.current?.setBackgroundColor(e.target.value)); }} />
      </label>
      <label className="insp-row" title="方向光 shadow map + 接影地板（T-4.3）">
        <span>接触阴影</span>
        <input
          type="checkbox"
          checked={shadows}
          onChange={(e) => { setShadows(e.target.checked); sync(() => rendererRef.current?.setShadows(e.target.checked)); }}
        />
      </label>

      <div className="insp-sec">视角</div>
      <div className="insp-btnrow">
        {(['iso', 'front', 'top'] as const).map((p) => (
          <button key={p} className="mini" onClick={() => rendererRef.current?.setCameraPreset(p)}>
            {p === 'iso' ? '等距' : p === 'front' ? '正视' : '俯视'}
          </button>
        ))}
        <button className="mini" onClick={() => rendererRef.current?.frameAll()} title="适配全场景取景（相机不动任何组件）">
          重置取景
        </button>
      </div>
      <p className="insp-note">网格为视觉参考（间距随视距自适应），不改变任何科学单位。</p>
    </div>
  );
}

function MaterialTab(): React.ReactElement | null {
  const selectedId = useStore(sceneStore, (s) => s.selectionId);
  const selName = useStore(sceneStore, (s) => s.components.find((c) => c.id === s.selectionId)?.name ?? null);
  const [preset, setPreset] = useState<AppearancePreset>('default');
  const [roughness, setRoughness] = useState<number | null>(null);
  const [metalness, setMetalness] = useState<number | null>(null);
  const [opacity, setOpacity] = useState<number | null>(null);
  const [tint, setTint] = useState('#8fb8c9');
  const [tintOn, setTintOn] = useState(false);

  if (!selectedId) {
    return (
      <div className="insp-body">
        <p className="insp-note">选中画布中的组件后，可在此调整其视觉外观（预设为渲染质感近似，非科学材料物性；会话级，不写入场景文件）。</p>
      </div>
    );
  }

  const apply = (next: Partial<{ preset: AppearancePreset; roughness: number | null; metalness: number | null; opacity: number | null; colorOverride: string | null; tintEnabled: boolean }>): void => {
    const p = next.preset ?? preset;
    const r = next.roughness !== undefined ? next.roughness : roughness;
    const m = next.metalness !== undefined ? next.metalness : metalness;
    const o = next.opacity !== undefined ? next.opacity : opacity;
    const useTint = next.tintEnabled !== undefined ? next.tintEnabled : tintOn;
    const color = next.colorOverride !== undefined ? next.colorOverride : tint;
    setPreset(p);
    setRoughness(r);
    setMetalness(m);
    setOpacity(o);
    if (next.tintEnabled !== undefined) setTintOn(next.tintEnabled);
    rendererRef.current?.setComponentAppearance(selectedId, {
      preset: p,
      roughness: r ?? undefined,
      metalness: m ?? undefined,
      opacity: o ?? undefined,
      colorOverride: useTint ? color : null,
    });
  };

  return (
    <div className="insp-body">
      <div className="insp-sec">视觉预设<span className="insp-tip">（{selName}）</span></div>
      <div className="insp-presets">
        {PRESET_LABELS.map(([key, label, tip]) => (
          <button
            key={key}
            className={`insp-preset${preset === key ? ' on' : ''}`}
            title={tip}
            onClick={() => apply({ preset: key, roughness: null, metalness: null, opacity: null })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="insp-sec">微调</div>
      <label className="insp-row">
        <span>粗糙度</span>
        <input type="range" min={0} max={1} step={0.02} value={roughness ?? APPEARANCE_PRESETS[preset].roughness}
          onChange={(e) => apply({ roughness: Number(e.target.value) })} />
      </label>
      <label className="insp-row">
        <span>金属度</span>
        <input type="range" min={0} max={1} step={0.02} value={metalness ?? APPEARANCE_PRESETS[preset].metalness}
          onChange={(e) => apply({ metalness: Number(e.target.value) })} />
      </label>
      <label className="insp-row">
        <span>不透明度</span>
        <input type="range" min={0.15} max={1} step={0.02} value={opacity ?? APPEARANCE_PRESETS[preset].opacity}
          onChange={(e) => apply({ opacity: Number(e.target.value) })} />
      </label>
      <div className="insp-row" title="整体着色（可选）——默认保留元素色板的科学辨识性">
        <span>整体着色</span>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={tintOn}
            onChange={(e) => apply({ tintEnabled: e.target.checked, colorOverride: e.target.checked ? tint : null })}
          />
          <input
            type="color"
            value={tint}
            disabled={!tintOn}
            onChange={(e) => { setTint(e.target.value); if (tintOn) apply({ colorOverride: e.target.value }); }}
          />
        </span>
      </div>
      <div className="insp-btnrow">
        <button
          className="mini"
          onClick={() => {
            setPreset('default');
            setRoughness(null);
            setMetalness(null);
            setOpacity(null);
            setTintOn(false);
            rendererRef.current?.setComponentAppearance(selectedId, null);
          }}
        >
          恢复科研材质
        </button>
      </div>
      <p className="insp-note">视觉外观为渲染质感近似，不代表真实材料物性；当前为会话级调整（保存场景不携带）。</p>
    </div>
  );
}

const TABS: Array<[InspectorTab, string]> = [
  ['scene', '场景'],
  ['material', '材质'],
  ['object', '对象'],
];

export default function InspectorPanel(): React.ReactElement {
  const [tab, setTab] = useState<InspectorTab>('object');
  return (
    <aside className="panel right insp">
      <LayerPanel />
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
        {tab === 'scene' && <SceneTab />}
        {tab === 'material' && <MaterialTab />}
        {tab === 'object' && <ParamPanel />}
      </div>
    </aside>
  );
}
