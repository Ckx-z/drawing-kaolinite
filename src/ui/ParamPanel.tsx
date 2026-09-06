/**
 * 参数面板 —— T-1.6（对齐 demo：滑块/下拉/勾选 + 变换数字输入 + gizmo 模式）
 * 参数经 store.updateParams（schema 校验）；变换经 setTransform；重建节流由 bindRenderer 承担。
 */
import { useState } from 'react';
import { useStore } from 'zustand';
import type { Transform } from '../core/types';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { PARAM_DEFS, type ParamDef } from './paramDefs';

function RangeControl(props: { compId: string; def: ParamDef; value: number }) {
  const { compId, def, value } = props;
  return (
    <div className="ctl">
      <div className="row">
        <label>{def.label}</label>
        <span className="val">{def.disp ? def.disp(value) : `${value}${def.unit ?? ''}`}</span>
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) =>
          sceneStore.getState().updateParams(compId, { [def.key]: parseFloat(e.target.value) } as never)
        }
      />
    </div>
  );
}

function SelectControl(props: { compId: string; def: ParamDef; value: string }) {
  const { compId, def, value } = props;
  return (
    <div className="ctl">
      <div className="row">
        <label>{def.label}</label>
      </div>
      <select
        value={value}
        onChange={(e) => sceneStore.getState().updateParams(compId, { [def.key]: e.target.value } as never)}
      >
        {def.options?.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckControl(props: { compId: string; def: ParamDef; checked: boolean }) {
  const { compId, def, checked } = props;
  return (
    <div className="ctl">
      <label className="chk">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => sceneStore.getState().updateParams(compId, { [def.key]: e.target.checked } as never)}
        />
        {def.label}
      </label>
    </div>
  );
}

function NumCell(props: { label: string; value: number; step: number; onSet: (v: number) => void }) {
  const { label, value, step, onSet } = props;
  return (
    <div className="cell">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onSet(v);
        }}
      />
    </div>
  );
}

export default function ParamPanel() {
  const selected = useStore(sceneStore, (s) => s.components.find((c) => c.id === s.selectionId) ?? null);
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');

  if (!selected) {
    return (
      <section className="right-section">
        <h3>参数</h3>
        <p className="hint">
          点击画布中的组件，或从左侧素材库添加。
          <br />
          组件之间相互独立，可分层、分步自由组合。
        </p>
        <h3>图层</h3>
        <p className="hint">画布为空。</p>
      </section>
    );
  }

  const setT = (part: Partial<Transform>): void => {
    const t = selected.transform;
    sceneStore.getState().setTransform(selected.id, {
      position: [...t.position],
      rotation: [...t.rotation],
      scale: t.scale,
      ...part,
    } as Transform);
  };

  return (
    <section className="right-section">
      <h3>
        参数<span className="tip">（{selected.name}）</span>
      </h3>
      {PARAM_DEFS[selected.type].map((def) => {
        const v = (selected.params as Record<string, unknown>)[def.key];
        if (def.type === 'select') return <SelectControl key={def.key} compId={selected.id} def={def} value={String(v)} />;
        if (def.type === 'checkbox')
          return <CheckControl key={def.key} compId={selected.id} def={def} checked={Boolean(v)} />;
        return <RangeControl key={def.key} compId={selected.id} def={def} value={Number(v)} />;
      })}

      <div className="subhead">变 换</div>
      <div className="grid3">
        <NumCell label="位置 X" value={selected.transform.position[0]} step={1} onSet={(v) => setT({ position: [v, selected.transform.position[1], selected.transform.position[2]] })} />
        <NumCell label="位置 Y" value={selected.transform.position[1]} step={1} onSet={(v) => setT({ position: [selected.transform.position[0], v, selected.transform.position[2]] })} />
        <NumCell label="位置 Z" value={selected.transform.position[2]} step={1} onSet={(v) => setT({ position: [selected.transform.position[0], selected.transform.position[1], v] })} />
      </div>
      <div className="grid3" style={{ marginTop: 6 }}>
        <NumCell label="旋转 X°" value={selected.transform.rotation[0]} step={5} onSet={(v) => setT({ rotation: [v, selected.transform.rotation[1], selected.transform.rotation[2]] })} />
        <NumCell label="旋转 Y°" value={selected.transform.rotation[1]} step={5} onSet={(v) => setT({ rotation: [selected.transform.rotation[0], v, selected.transform.rotation[2]] })} />
        <NumCell label="旋转 Z°" value={selected.transform.rotation[2]} step={5} onSet={(v) => setT({ rotation: [selected.transform.rotation[0], selected.transform.rotation[1], v] })} />
      </div>
      <div className="grid3" style={{ marginTop: 6 }}>
        <NumCell label="整体缩放" value={selected.transform.scale} step={0.1} onSet={(v) => setT({ scale: Math.max(0.05, v) })} />
      </div>

      <div className="btnrow" style={{ marginTop: 10 }}>
        <button className={`mini${gizmoMode === 'translate' ? ' on' : ''}`} onClick={() => { setGizmoMode('translate'); rendererRef.current?.setGizmoMode('translate'); }}>
          移动
        </button>
        <button className={`mini${gizmoMode === 'rotate' ? ' on' : ''}`} onClick={() => { setGizmoMode('rotate'); rendererRef.current?.setGizmoMode('rotate'); }}>
          旋转
        </button>
        <button className="mini" onClick={() => rendererRef.current?.frameComponent(selected.id)}>
          适配视角
        </button>
      </div>
    </section>
  );
}
