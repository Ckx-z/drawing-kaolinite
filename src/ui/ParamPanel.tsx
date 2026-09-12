/**
 * 参数面板 —— T-1.6（对齐 demo：滑块/下拉/勾选 + 变换数字输入 + gizmo 模式）
 * 参数经 store.updateParams（schema 校验）；变换经 setTransform；重建节流由 bindRenderer 承担。
 */
import { useState } from 'react';
import { useStore } from 'zustand';
import type { PaletteSetting, Transform } from '../core/types';
import { PALETTES, resolveColor } from '../render/palette';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { PARAM_DEFS, type ParamDef } from './paramDefs';

/**
 * 全局色板 + 逐元素取色器（T-4.2）：对整个场景生效，随场景 JSON 持久化。
 * 换色经 setPalette（store 持久化）+ renderer.setPalette（即时重着色，不重建几何）。
 */
function PaletteSection() {
  const palette = useStore(sceneStore, (s) => s.palette);
  const componentCount = useStore(sceneStore, (s) => s.components.length);
  const elements = componentCount ? (rendererRef.current?.elementsInScene() ?? []) : [];
  const set = (p: PaletteSetting): void => {
    sceneStore.getState().setPalette(p);
    rendererRef.current?.setPalette(p);
  };
  const setOverride = (el: string, hex: string): void =>
    set({ ...palette, overrides: { ...palette.overrides, [el]: hex } });
  const clearOverrides = (): void => set({ id: palette.id, overrides: undefined });

  return (
    <>
      <div className="subhead">色 板</div>
      <select
        value={palette.id ?? 'default'}
        onChange={(e) => set({ id: e.target.value, overrides: palette.overrides })}
      >
        {PALETTES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {elements.length > 0 && (
        <div className="grid3" style={{ marginTop: 6 }}>
          {elements.map((el) => (
            <div className="cell" key={el}>
              <label>{el}</label>
              <input
                type="color"
                value={resolveColor(el, palette)}
                onChange={(e) => setOverride(el, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
      {palette.overrides && (
        <div className="btnrow" style={{ marginTop: 6 }}>
          <button className="mini" onClick={clearOverrides}>
            恢复默认配色
          </button>
        </div>
      )}
    </>
  );
}

function RangeControl(props: { compId: string; def: ParamDef; value: number; params: Record<string, unknown> }) {
  const { compId, def, params } = props;
  // 边界可为常量或随其他参数动态（如"单原子层数"上限 = 当前堆叠层数）
  const min = typeof def.min === 'function' ? def.min(params) : (def.min ?? 0);
  const max = typeof def.max === 'function' ? def.max(params) : (def.max ?? 100);
  // 显示值钳制到当前边界（存量值超界时滑块仍可用，store 原值由 builder clamp）
  const value = Math.min(Math.max(props.value, min), max);
  return (
    <div className="ctl">
      <div className="row">
        <label>{def.label}</label>
        <span className="val">{def.disp ? def.disp(value) : `${value}${def.unit ?? ''}`}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={def.step}
        value={value}
        onChange={(e) =>
          sceneStore.getState().updateParams(compId, { [def.key]: parseFloat(e.target.value) } as never)
        }
      />
    </div>
  );
}

function SelectControl(props: { compId: string; def: ParamDef; value: string; params: Record<string, unknown> }) {
  const { compId, def, value, params } = props;
  const [query, setQuery] = useState('');
  const norm = query.trim().toLowerCase();
  // 过滤（符号或显示名包含匹配）；当前选中项即使被过滤掉也保留显示，避免 select 显示错位
  const entries = (def.options ?? []).flatMap((op) => {
    const v = typeof op === 'string' ? op : op.value;
    const label = typeof op === 'string' ? op : op.label;
    return { v, label };
  });
  const filtered = norm
    ? entries.filter((e) => e.v.toLowerCase().includes(norm) || e.label.toLowerCase().includes(norm))
    : entries;
  // 非过滤态：当前选中项即使不在 options 也附加显示（避免 select 显示错位）；
  // 过滤态：不附加（用户正要换值，无关项干扰）
  const shown = norm || filtered.some((e) => e.v === value) ? filtered : [...entries.filter((e) => e.v === value), ...filtered];
  return (
    <div className="ctl">
      <div className="row">
        <label>{def.label}</label>
      </div>
      {def.searchable && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入符号 / 中文名过滤…"
          style={{ width: '100%', marginBottom: 4 }}
        />
      )}
      <select
        value={value}
        onChange={(e) =>
          sceneStore
            .getState()
            .updateParams(compId, { [def.key]: e.target.value, ...def.sideEffect?.(e.target.value, params) } as never)
        }
      >
        {shown.map((e) => (
          <option key={e.v} value={e.v}>
            {e.label}
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

/**
 * packedMask（2026-09-10 密排原子层）：第一层原子 n×n 网格编辑器，
 * 每格 = 一个原子的"参与堆叠"布尔（☑ 参与 / ☐ 仅保留第一层）。
 * 掩码存 '0'/'1' 字符串（缺省位 = 参与），toggle 即改写经 updateParams
 * （自动获得撤销/重做与场景持久化）。
 */
function PackedMaskControl(props: { compId: string; params: Record<string, unknown> }) {
  const { compId, params } = props;
  const n = Number(params.n ?? 7);
  const total = n * n;
  const mask = String(params.mask ?? '');
  const bit = (i: number): boolean => mask.charAt(i) !== '0'; // 缺省/越界 = 参与
  const setMask = (next: string): void => {
    sceneStore.getState().updateParams(compId, { mask: next } as never);
  };
  const toggle = (i: number): void => {
    const arr = Array.from({ length: total }, (_, k) => (bit(k) ? '1' : '0'));
    arr[i] = arr[i] === '1' ? '0' : '1';
    setMask(arr.join(''));
  };
  return (
    <div className="ctl">
      <div className="row">
        <label>参与堆叠（第一层每个原子）</label>
        <span style={{ display: 'flex', gap: 4 }}>
          <button className="mini" onClick={() => setMask('')} title="全部参与堆叠">
            全选
          </button>
          <button
            className="mini"
            onClick={() => setMask('0'.repeat(total))}
            title="全部只保留第一层（上层清空）"
          >
            清空
          </button>
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${n}, 18px)`,
          gap: 2,
          width: 'fit-content',
          padding: 6,
          background: '#f1f5f9',
          borderRadius: 6,
        }}
        title="☑ = 参与堆叠（该原子列向上生长） · ☐ = 仅保留第一层"
      >
        {Array.from({ length: total }, (_, i) => (
          <input
            key={i}
            type="checkbox"
            checked={bit(i)}
            onChange={() => toggle(i)}
            style={{ width: 14, height: 14, margin: 0, cursor: 'pointer' }}
          />
        ))}
      </div>
      <p className="hint">☑ 参与 · ☐ 仅第一层；勾选数：{Array.from({ length: total }, (_, k) => bit(k)).filter(Boolean).length}/{total}；也可按住 Alt 直接点击画布中第一层原子切换</p>
    </div>
  );
}

/** toggle：字符串枚举开关（如 atomMode 'full'/'single' ↔ 勾选态） */
function ToggleControl(props: { compId: string; def: ParamDef; value: string }) {
  const { compId, def, value } = props;
  const on = def.on ?? '';
  const off = def.off ?? '';
  return (
    <div className="ctl">
      <label className="chk">
        <input
          type="checkbox"
          checked={value === on}
          onChange={(e) => sceneStore.getState().updateParams(compId, { [def.key]: e.target.checked ? on : off } as never)}
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

/**
 * 标注层区（T-4.4）：比例尺 / 文本标签（引线锚定选中组件的世界坐标）。
 * 标注存场景 JSON（annotations），交互显示走 SceneCanvas 叠加 canvas。
 */
function AnnotationSection() {
  const annotations = useStore(sceneStore, (s) => s.annotations);
  const selected = useStore(sceneStore, (s) => s.components.find((c) => c.id === s.selectionId) ?? null);
  const [, force] = useState(0);
  const addScalebar = (): void => {
    sceneStore.getState().addAnnotation({ type: 'scalebar' });
    force((n) => n + 1);
  };
  const addLabel = (): void => {
    const s = sceneStore.getState();
    if (!selected) return;
    s.addAnnotation({
      type: 'label',
      text: selected.name,
      target: selected.transform.position,
      offset: [14, -14],
    });
    force((n) => n + 1);
  };
  return (
    <>
      <div className="subhead">标 注</div>
      <div className="btnrow">
        <button className="mini" onClick={addScalebar} title="比例尺（左下角，按当前缩放自动取整刻度，nm 计）">
          + 比例尺
        </button>
        <button
          className="mini"
          onClick={addLabel}
          disabled={!selected}
          title={selected ? '为选中组件添加文本标签（引线锚定其位置）' : '先选中一个组件'}
        >
          + 标签
        </button>
      </div>
      {annotations.map((a, i) => (
        <div className="ctl" key={i}>
          <div className="row">
            <label>{a.type === 'scalebar' ? '比例尺' : `标签：${a.text ?? ''}`}</label>
            <button
              className="mini"
              onClick={() => {
                sceneStore.getState().updateAnnotation(i, { visible: a.visible === false });
              }}
            >
              {a.visible === false ? '显示' : '隐藏'}
            </button>
            <button
              className="mini"
              onClick={() => {
                sceneStore.getState().removeAnnotation(i);
              }}
            >
              删除
            </button>
          </div>
          {a.type === 'label' && (
            <input
              value={a.text ?? ''}
              onChange={(e) => sceneStore.getState().updateAnnotation(i, { text: e.target.value })}
              placeholder="标注文本（如 d₀₀₁ = 1.0 nm）"
            />
          )}
        </div>
      ))}
    </>
  );
}

/**
 * gizmo 吸附控件（T-7.3）：位置网格 / 旋转步进，直接映射 TransformControls
 * 内置 snap（视图态，不持久化）。单选（变换区上方）与多选批量区共用。
 */
function SnapControls(props: { snap: { grid: number | null; angleDeg: number | null }; onChange: (s: { grid: number | null; angleDeg: number | null }) => void }) {
  const { snap, onChange } = props;
  return (
    <>
      <div className="ctl">
        <div className="row">
          <label>吸附：位置网格</label>
        </div>
        <select
          value={snap.grid ?? 'off'}
          onChange={(e) => onChange({ ...snap, grid: e.target.value === 'off' ? null : Number(e.target.value) })}
        >
          <option value="off">关闭</option>
          <option value="1">1 Å</option>
          <option value="2">2 Å</option>
          <option value="5">5 Å</option>
        </select>
      </div>
      <div className="ctl">
        <div className="row">
          <label>吸附：旋转步进</label>
        </div>
        <select
          value={snap.angleDeg ?? 'off'}
          onChange={(e) => onChange({ ...snap, angleDeg: e.target.value === 'off' ? null : Number(e.target.value) })}
        >
          <option value="off">关闭</option>
          <option value="5">5°</option>
          <option value="15">15°</option>
          <option value="45">45°</option>
        </select>
      </div>
    </>
  );
}

/**
 * 组件多选批量操作区（T-7.3，Shift+点击 ≥2 个组件时显示）：
 * 对齐 / 等间距分布 / 统一参数（风格、单原子模式、矿物、缩放——以末位主选为基准，
 * 类型不适用的成员自动跳过）。每个命令一条撤销记录。
 */
function BatchSection(props: { snap: { grid: number | null; angleDeg: number | null }; onSnap: (s: { grid: number | null; angleDeg: number | null }) => void }) {
  const ids = useStore(sceneStore, (s) => s.componentSelectionIds);
  const comps = useStore(sceneStore, (s) => s.components);
  if (ids.length < 2) return null;
  const members = comps.filter((c) => ids.includes(c.id));
  const leader = members.find((c) => c.id === ids[ids.length - 1]) ?? members[members.length - 1];
  if (!leader) return null;
  const st = sceneStore.getState();
  const leaderParams = leader.params as Record<string, unknown>;
  const has = (k: string): boolean => k in leaderParams;
  return (
    <section className="right-section">
      <h3>
        批量操作<span className="tip">（已选 {ids.length} 项 · 主选 {leader.name}）</span>
      </h3>
      <p className="hint">Shift+点击画布可增删选择；Esc 取消。对齐/统一以主选为基准，锁定成员跳过。</p>
      <div className="ctl">
        <div className="row">
          <label>对齐位置（以主选为基准）</label>
        </div>
        <div className="btnrow">
          <button className="mini" onClick={() => st.alignComponents(0)}>对齐 X</button>
          <button className="mini" onClick={() => st.alignComponents(1)}>对齐 Y</button>
          <button className="mini" onClick={() => st.alignComponents(2)}>对齐 Z</button>
        </div>
        {ids.length >= 3 && (
          <div className="btnrow" style={{ marginTop: 4 }}>
            <button className="mini" onClick={() => st.distributeComponents(0)}>等间距 X</button>
            <button className="mini" onClick={() => st.distributeComponents(2)}>等间距 Z</button>
          </div>
        )}
      </div>
      <div className="ctl">
        <div className="row">
          <label>统一参数（类型不适用者自动跳过）</label>
        </div>
        <div className="btnrow">
          <button
            className="mini"
            disabled={!has('style')}
            onClick={() => st.applyParamsToSelection({ style: leaderParams.style })}
          >
            统一渲染风格
          </button>
          <button
            className="mini"
            disabled={!has('atomMode')}
            onClick={() =>
              st.applyParamsToSelection({
                atomMode: leaderParams.atomMode,
                singleEl: leaderParams.singleEl,
                ...(has('singleLayers') ? { singleLayers: leaderParams.singleLayers } : {}),
              })
            }
          >
            统一单原子模式
          </button>
        </div>
        <div className="btnrow" style={{ marginTop: 4 }}>
          <button
            className="mini"
            disabled={!has('mineral')}
            onClick={() =>
              st.applyParamsToSelection({
                mineral: leaderParams.mineral,
                ...(has('d001') ? { d001: leaderParams.d001 } : {}),
              })
            }
          >
            统一矿物
          </button>
          <button className="mini" onClick={() => st.applyScaleToSelection(leader.transform.scale)}>
            统一缩放
          </button>
        </div>
      </div>
      <div className="subhead">吸 附</div>
      <SnapControls snap={props.snap} onChange={props.onSnap} />
    </section>
  );
}

/**
 * 图元样式区（T-11.4）：图元选中时显示（与组件参数区互斥——选择本身互斥）。
 * 文本/字号/颜色/线宽/线型/旋转 + Z 序 + 编组。
 */
function ShapeSection() {
  const shapes = useStore(sceneStore, (s) => s.shapes);
  const selIds = useStore(sceneStore, (s) => s.shapeSelectionIds);
  const shape = shapes.find((s) => s.id === selIds[selIds.length - 1]) ?? null;
  if (!shape) return null;
  const upd = (patch: Partial<typeof shape>): void => sceneStore.getState().updateShape(shape.id, patch as never);
  const isLine = shape.type === 'arrow' || shape.type === 'line';

  return (
    <section className="right-section">
      <h3>
        图元<span className="tip">（{shape.type === 'text' ? shape.text.slice(0, 8) : TYPE_LABEL[shape.type]}{selIds.length > 1 ? ` 等 ${selIds.length} 项` : ''}）</span>
      </h3>

      {shape.type === 'text' && (
        <>
          <div className="ctl">
            <div className="row">
              <label>文本内容</label>
            </div>
            <input
              value={shape.text}
              onChange={(e) => upd({ text: e.target.value } as never)}
              placeholder="双击画布文本也可编辑"
            />
          </div>
          <div className="ctl">
            <div className="row">
              <label>字号</label>
              <span className="val">{shape.fontSize}px</span>
            </div>
            <input type="range" min={8} max={72} step={1} value={shape.fontSize}
              onChange={(e) => upd({ fontSize: parseFloat(e.target.value) } as never)} />
          </div>
          <div className="ctl">
            <div className="row">
              <label>文字颜色</label>
            </div>
            <input type="color" value={shape.color} onChange={(e) => upd({ color: e.target.value } as never)} style={{ width: '100%', height: 26 }} />
          </div>
        </>
      )}

      <div className="ctl">
        <div className="row">
          <label>描边色</label>
        </div>
        <input type="color" value={shape.stroke} onChange={(e) => upd({ stroke: e.target.value })} style={{ width: '100%', height: 26 }} />
      </div>
      {!isLine && shape.type !== 'text' && (
        <div className="ctl">
          <div className="row">
            <label>填充色</label>
            <label className="chk">
              <input type="checkbox" checked={shape.fill !== 'none'}
                onChange={(e) => upd({ fill: e.target.checked ? '#ffffff' : 'none' })} />
              填充
            </label>
          </div>
          {shape.fill !== 'none' && (
            <input type="color" value={shape.fill} onChange={(e) => upd({ fill: e.target.value })} style={{ width: '100%', height: 26 }} />
          )}
        </div>
      )}
      <div className="ctl">
        <div className="row">
          <label>线宽</label>
          <span className="val">{shape.lineWidth}px</span>
        </div>
        <input type="range" min={0.5} max={12} step={0.5} value={shape.lineWidth}
          onChange={(e) => upd({ lineWidth: parseFloat(e.target.value) })} />
      </div>
      <div className="ctl">
        <div className="row">
          <label>线型</label>
        </div>
        <select value={shape.dash} onChange={(e) => upd({ dash: e.target.value as 'solid' | 'dashed' })}>
          <option value="solid">实线</option>
          <option value="dashed">虚线</option>
        </select>
      </div>
      {shape.type === 'arrow' && (
        <>
          <div className="ctl">
            <div className="row">
              <label>弯曲（弓高）</label>
              <span className="val">{Math.round(shape.bow)}px</span>
            </div>
            <input type="range" min={-150} max={150} step={2} value={shape.bow}
              onChange={(e) => upd({ bow: parseFloat(e.target.value) } as never)} />
            <p className="hint">0 = 直线；正负向两侧弯（电子转移弧线）</p>
          </div>
          <div className="ctl">
            <div className="row">
              <label>箭头位置</label>
            </div>
            <select value={shape.heads} onChange={(e) => upd({ heads: e.target.value as 'end' | 'both' | 'none' } as never)}>
              <option value="end">终点单头</option>
              <option value="both">双端（可逆反应）</option>
              <option value="none">无头（仅线）</option>
            </select>
          </div>
        </>
      )}
      {!isLine && (
        <div className="ctl">
          <div className="row">
            <label>旋转</label>
            <span className="val">{Math.round(shape.rotation)}°</span>
          </div>
          <input type="range" min={-180} max={180} step={1} value={shape.rotation}
            onChange={(e) => upd({ rotation: parseFloat(e.target.value) })} />
        </div>
      )}

      <div className="btnrow">
        <button className="mini" onClick={() => sceneStore.getState().moveShapeOrder(shape.id, 'front')}>⤒ 最前</button>
        <button className="mini" onClick={() => sceneStore.getState().moveShapeOrder(shape.id, 'forward')}>↑ 前移</button>
        <button className="mini" onClick={() => sceneStore.getState().moveShapeOrder(shape.id, 'backward')}>↓ 后移</button>
        <button className="mini" onClick={() => sceneStore.getState().moveShapeOrder(shape.id, 'back')}>⤓ 最后</button>
      </div>
      <div className="btnrow" style={{ marginTop: 6 }}>
        {selIds.length > 1 && !shape.group && (
          <button className="mini" onClick={() => sceneStore.getState().groupShapes(selIds)}>编组（{selIds.length} 项）</button>
        )}
        {shape.group && (
          <>
            <span className="hint" style={{ alignSelf: 'center' }}>已编组</span>
            <button className="mini" onClick={() => sceneStore.getState().ungroupShapes(selIds)}>解散编组</button>
          </>
        )}
        <button className="mini" onClick={() => sceneStore.getState().updateShape(shape.id, { locked: !shape.locked })}>
          {shape.locked ? '解锁' : '锁定'}
        </button>
        <button className="mini" onClick={() => sceneStore.getState().removeShape(shape.id)}>删除</button>
      </div>
    </section>
  );
}

const TYPE_LABEL: Record<string, string> = {
  rect: '矩形',
  ellipse: '椭圆',
  arrow: '箭头',
  line: '连线',
  text: '文本',
};

export default function ParamPanel() {
  const selected = useStore(sceneStore, (s) => s.components.find((c) => c.id === s.selectionId) ?? null);
  const multiIds = useStore(sceneStore, (s) => s.componentSelectionIds);
  const hasShapeSel = useStore(sceneStore, (s) => s.shapeSelectionIds.length > 0);
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');

  // T-11.4：图元选中时优先显示图元样式区（选择互斥 → 组件参数区隐藏）
  if (hasShapeSel) {
    return (
      <>
        <ShapeSection />
        <PaletteSection />
        <AnnotationSection />
      </>
    );
  }

  // T-7.3 吸附（视图态；gizmo 平移网格/旋转步进）
  const [snap, setSnap] = useState<{ grid: number | null; angleDeg: number | null }>({ grid: null, angleDeg: null });
  const applySnap = (next: { grid: number | null; angleDeg: number | null }): void => {
    setSnap(next);
    rendererRef.current?.setSnap(next);
  };
  if (multiIds.length >= 2) return <BatchSection snap={snap} onSnap={applySnap} />;

  if (!selected) {
    return (
      <section className="right-section">
        <h3>参数</h3>
        <p className="hint">
          点击画布中的组件，或从左侧素材库添加。
          <br />
          组件之间相互独立，可分层、分步自由组合。
          <br />
          顶栏图元工具（V/R/O/A/L/T）可画机理图箭头与说明。
        </p>
        <PaletteSection />
        <AnnotationSection />
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
        if (def.when && !def.when(selected.params as Record<string, unknown>)) return null; // 条件显隐
        const v = (selected.params as Record<string, unknown>)[def.key];
        if (def.type === 'select')
          return (
            <SelectControl
              key={def.key}
              compId={selected.id}
              def={def}
              value={String(v)}
              params={selected.params as Record<string, unknown>}
            />
          );
        if (def.type === 'toggle') return <ToggleControl key={def.key} compId={selected.id} def={def} value={String(v)} />;
        if (def.type === 'checkbox')
          return <CheckControl key={def.key} compId={selected.id} def={def} checked={Boolean(v)} />;
        if (def.type === 'packedMask')
          return <PackedMaskControl key={def.key} compId={selected.id} params={selected.params as Record<string, unknown>} />;
        return (
          <RangeControl
            key={def.key}
            compId={selected.id}
            def={def}
            value={Number(v)}
            params={selected.params as Record<string, unknown>}
          />
        );
      })}

      <div className="subhead">吸 附</div>
      <SnapControls snap={snap} onChange={applySnap} />

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

      <PaletteSection />
      <AnnotationSection />
    </section>
  );
}
