/**
 * 顶部工具栏 —— T-1.6/T-1.7（对齐 demo：示例场景 / 保存场景 / 打开场景 / 导出 PNG / 清空）
 * 2026-09-08：全部导出改走 saveFile.ts 统一入口（桌面 = 原生保存对话框 + Rust 写盘，
 * 修复打包版 <a download> 无效；浏览器 = showSaveFilePicker / 传统下载）。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { exportCurlAnimation } from '../export/animation';
import { buildLayerPngs } from '../export/layers';
import { SHAPE_TOOLS, type ShapeTool } from '../core/shapes/schema';
import { placeholderTemplateThumb, saveModule, templateEntryFromScene } from '../state/moduleLibrary';
import { clearAdsorption } from '../state/adsorptionStore';
import { rendererRef } from '../state/rendererRef';
import { sceneHistory, sceneStore } from '../state/sceneStore';
import { shapeViewStore } from './shapes/view';
import { loadPresetScene } from './preset';
import { dataUrlToBlob, saveBlob, saveBlobs, saveText } from './saveFile';
import { DropdownMenu, MenuItem, MenuSep, MenuBlock, SegmentedControl } from './primitives';
import { resolveExportSize } from '../export/tiff';

/** T-11.2 图元工具组（激活态随 store.tool；快捷键 V/R/O/A/L/T 同源） */
const TOOL_LABELS: Record<ShapeTool, string> = {
  select: '➚ 选择',
  rect: '▭ 矩形',
  ellipse: '◯ 椭圆',
  arrow: '→ 箭头',
  line: '— 连线',
  text: 'T 文本',
};

function ShapeToolGroup() {
  const tool = useStore(sceneStore, (s) => s.tool);
  return (
    <div className="tb-group" title="机理图图元工具（快捷键 V/R/O/A/L/T；绘制后自动回选择工具）">
      {SHAPE_TOOLS.map((t) => (
        <button
          key={t}
          className={`mini${tool === t ? ' on' : ''}`}
          onClick={() => sceneStore.getState().setTool(t)}
        >
          {TOOL_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

/** T-11.6 画布形态切换：segmented control（工作模式视觉权重高于普通工具）；
 * 2D 段激活时相邻显示磁吸开关 + 缩放（T-11.7，逻辑原样） */
function ModeGroup() {
  const mode = useStore(sceneStore, (s) => s.mode);
  const snap = useStore(shapeViewStore, (s) => s.snap);
  const zoom = useStore(shapeViewStore, (s) => s.zoom);
  return (
    <div className="tb-group" title="工作模式——示意图模式：无 3D 的无限画布（空格/中键拖拽平移，滚轮缩放）；图元数据两模式共享">
      <SegmentedControl
        options={[
          { value: 'mixed', label: '🧊 3D 混合', title: '3D 场景 + 图元叠加' },
          { value: 'diagram', label: '✏️ 2D 示意', title: '纯 2D 无限画布' },
        ]}
        value={mode}
        onChange={(v) => sceneStore.getState().setMode(v)}
      />
      {mode === 'diagram' && (
        <>
          <label className="chk" title="拖拽图元时自动对齐网格与其他图元边缘/中心（洋红参考线提示）">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => shapeViewStore.getState().setSnap(e.target.checked)}
            />
            磁吸
          </label>
          <span style={{ opacity: 0.6, alignSelf: 'center', fontSize: 12 }}>{Math.round(zoom * 100)}%</span>
        </>
      )}
    </div>
  );
}

export default function TopBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dpi, setDpi] = useState(300);
  const [alpha, setAlpha] = useState(false);
  const [mode, setMode] = useState<'render' | 'toon'>('render');
  const [shadows, setShadows] = useState(false);
  const [toast, setToast] = useState('');
  // 后退/前进按钮禁用态：订阅历史栈变化（入栈/撤销/重做/清空都触发）
  const [, bumpHistory] = useState(0);
  useEffect(() => sceneHistory.subscribe(() => bumpHistory((v) => v + 1)), []);

  const flash = (msg: string): void => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  // 导出格式表（2026-09-16 顶栏收纳）：主按钮 = 最近使用格式（默认 PNG）
  const [lastFmt, setLastFmt] = useState<'png' | 'tiff' | 'pdf' | 'svg' | 'layers' | 'gif'>('png');
  const exportRunner: Record<typeof lastFmt, () => void> = {
    png: () => void onExportPNG(),
    tiff: () => void onExportTIFF(),
    pdf: () => void onExportPDF(),
    svg: () => void onExportSVG(),
    layers: () => void onExportLayeredPNG(),
    gif: () => void onExportAnimation(),
  };
  const FMT_LABEL: Record<typeof lastFmt, string> = {
    png: 'PNG', tiff: 'TIFF', pdf: 'PDF', svg: 'SVG', layers: '分层 PNG', gif: '动画 GIF',
  };
  const runFmt = (f: typeof lastFmt): void => {
    setLastFmt(f);
    exportRunner[f]();
  };
  /** 导出设置区的实时像素尺寸（复用导出链路同一 resolveExportSize，不复制算法） */
  const exportPx = (): string => {
    const svc = rendererRef.current;
    if (!svc) return '';
    const cvs = svc.renderer.domElement;
    const { w, h } = resolveExportSize(dpi, 16, cvs.clientWidth, cvs.clientHeight, svc.renderer.capabilities.maxTextureSize);
    return `${w} × ${h} px`;
  };

  const onSaveScene = async (): Promise<void> => {
    const json = JSON.stringify(sceneStore.getState().toSceneDocument(), null, 2);
    if (await saveText('kaolin-scene.json', json, 'application/json')) flash('场景已保存');
  };

  const onOpenScene = (): void => fileRef.current?.click();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        clearAdsorption(); // 场景文件载入清旧预览
        const restored = sceneStore.getState().loadScene(String(reader.result));
        if (!restored) rendererRef.current?.frameAll(); // 旧场景无视角快照 → 回退取景
        flash('场景已载入，所有参数均可继续修改');
      } catch (err) {
        alert(`场景文件解析失败：${(err as Error).message}`);
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const onExportPNG = async (): Promise<void> => {
    const svc = rendererRef.current;
    if (!svc) return;
    const { dataUrl, width, height } = svc.exportPNG({ dpi, alpha, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes, measurements: sceneStore.getState().measurements });
    const ok = await saveBlob(`kaolin-16cm-${dpi}dpi.png`, await dataUrlToBlob(dataUrl));
    if (ok) flash(`已导出 ${width} × ${height} px（16cm @ ${dpi}dpi${alpha ? '，透明底' : ''}）`);
  };

  /** T-5.4：分层透明 PNG（每可见组件一张，按远→近叠放序；供 PPT 叠放编辑） */
  const onExportLayeredPNG = async (): Promise<void> => {
    const svc = rendererRef.current;
    if (!svc) return;
    const layers = buildLayerPngs(svc, { dpi, widthCM: 16 });
    if (!layers.length) {
      flash('画布为空，先添加组件再导出分层 PNG');
      return;
    }
    const ok = await saveBlobs(
      await Promise.all(layers.map((l) => dataUrlToBlob(l.dataUrl).then((blob) => ({ filename: l.filename, blob })))),
    );
    if (ok) flash(`已导出 ${layers.length} 张分层 PNG（远→近序号命名，PPT 按序叠放即还原）`);
  };

  /** T-5.3：分组 SVG 矢量导出（线稿档画风，PPT 转形状/取消组合逐组件编辑） */
  const onExportSVG = async (): Promise<void> => {
    const svc = rendererRef.current;
    if (!svc) return;
    const svg = svc.exportSVG({ background: alpha ? undefined : '#F4F5F7', strokeWidth: 1, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes, measurements: sceneStore.getState().measurements });
    const ok = await saveText('kaolin-scene.svg', svg, 'image/svg+xml');
    if (ok) flash('已导出分组 SVG（每组件一个分组，PPT 转形状后可逐组件编辑）');
  };

  /** T-5.2：PDF 导出（页面物理尺寸 = 设定 cm 数，位图满幅嵌入） */
  const onExportPDF = async (): Promise<void> => {
    const svc = rendererRef.current;
    if (!svc) return;
    const { blob, widthCM, heightCM } = svc.exportPDF({ dpi, alpha, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes, measurements: sceneStore.getState().measurements });
    const ok = await saveBlob(`kaolin-${widthCM}x${heightCM}cm.pdf`, blob);
    if (ok) flash(`已导出 PDF（页面 ${widthCM} × ${heightCM} cm @ ${dpi}dpi 位图${alpha ? '，透明底' : ''}）`);
  };

  /** T-10.1：卷曲动画 GIF（选中埃洛石管，progress 0→1 均匀取帧） */
  const onExportAnimation = async (): Promise<void> => {
    const svc = rendererRef.current;
    if (!svc) return;
    const sel = sceneStore.getState().selectionId;
    const comp = sel ? sceneStore.getState().components.find((c) => c.id === sel) : null;
    if (!comp || comp.type !== 'halloysite_tube') {
      flash('请先在画布中选中一个埃洛石管，再导出卷曲动画');
      return;
    }
    flash('正在生成卷曲动画（逐帧构建几何，约几秒）…');
    const result = await exportCurlAnimation(svc, comp.id, {
      frames: 20,
      dpi: 96,
      onProgress: (p) => {
        if (Math.abs(p - 1) < 1e-9) return;
      },
    });
    if (!result) {
      flash('动画导出失败');
      return;
    }
    const ok = await saveBlob('kaolin-curl-animation.gif', await dataUrlToBlob(result.dataUrl));
    if (ok) flash(`已导出卷曲动画 GIF（${result.frames} 帧，片→管）`);
  };

  /** T-5.1：期刊 TIFF（300dpi+ 硬要求，带物理分辨率元数据；超上限自动降级提示） */
  const onExportTIFF = async (): Promise<void> => {
    const svc = rendererRef.current;
    if (!svc) return;
    const { blob, width, height, degraded, effectiveDpi } = svc.exportTIFF({ dpi, alpha, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes, measurements: sceneStore.getState().measurements });
    const ok = await saveBlob(`kaolin-16cm-${Math.round(effectiveDpi)}dpi.tiff`, blob);
    if (!ok) return;
    flash(
      degraded
        ? `分辨率超 GPU 上限，已降级 ${width} × ${height} px（有效 ${Math.round(effectiveDpi)}dpi）`
        : `已导出 TIFF ${width} × ${height} px（16cm @ ${dpi}dpi${alpha ? '，透明底' : ''}）`,
    );
  };

  /**
   * 保存为模板（2026-09-17 统一模板库）：当前完整可复现画面 → 统一模板条目
   * （components + shapes + annotations + 相机 + 形态 + 2D 视图 + 整景缩略图），
   * 一次性构造落库（moduleLibrary 底座），不进 scene undo。
   */
  const onSaveTemplate = async (): Promise<void> => {
    const s = sceneStore.getState();
    if (!s.shapes.length && !s.components.length) {
      flash('场景为空，先画点内容再存模板');
      return;
    }
    const svc = rendererRef.current;
    const name = `我的模板（${s.components.length} 组件${s.shapes.length ? ` + ${s.shapes.length} 图元` : ''}）`;
    await saveModule(
      templateEntryFromScene(
        {
          components: s.components,
          shapes: s.shapes,
          annotations: s.annotations,
          mode: s.mode,
          camera: svc
            ? { position: svc.camera.position.toArray() as [number, number, number], target: svc.orbit.target.toArray() as [number, number, number] }
            : undefined,
          view: { zoom: shapeViewStore.getState().zoom, panX: shapeViewStore.getState().panX, panY: shapeViewStore.getState().panY },
        },
        // 真实整景缩略图：snapshotTemplate = snapshotWithOverlay 管线（3D 当前帧
        // + 图元 + 标注），150×110 jpeg 0.8 与组合模块卡片同规格；用保存时相机
        // 当前帧（不取景不重排）→ 缩略图 ≡ 保存画面 ≡ 恢复画面。渲染服务不可用才占位
        svc ? svc.snapshotTemplate(150, 110, s.shapes, s.annotations) : placeholderTemplateThumb(),
        name,
      ),
    );
    flash(`已存为模板「${name}」，左侧「模板」Tab 可一键复用`);
  };

  /**
   * 清空画布（2026-09-17 自「打开」下拉移为顶栏常驻按钮，逻辑原样）：
   * 二次确认 → store.clear() → frameAll 取景复位。不可撤销（不进 undo）。
   */
  const onClearScene = (): void => {
    clearAdsorption(); // 清空场景同时清吸附预览（任务书八十九）
    if (window.confirm('确定清空画布？此操作不可撤销——建议先「保存场景」。')) {
      sceneStore.getState().clear();
      rendererRef.current?.frameAll();
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◈</span> Kaolin-Assets
        <em>高岭土机理图绘制软件 · v0.2.0</em>
      </div>
      {/* ── 工程区：保存 / 打开（下拉含示例场景）/ 清空场景（危险操作常驻入口） ── */}
      <div className="tb-group" title="场景文件：保存为 .kaolin-scene.json（含视角快照），双击可直接打开">
        <button onClick={onSaveScene}>保存场景</button>
        <DropdownMenu
          label="打开"
          title="打开场景文件（.kaolin-scene.json）；下拉含示例场景"
          onMainClick={onOpenScene}
        >
          <MenuItem onClick={onOpenScene} title="打开 .kaolin-scene.json（含视角快照，原样恢复）">
            打开场景…
          </MenuItem>
          <MenuItem onClick={loadPresetScene} title="一键组合：埃洛石@CeO₂ 复合材料场景">
            示例场景
          </MenuItem>
        </DropdownMenu>
        <button className="tb-clear" onClick={onClearScene} title="清空当前画布（不可撤销，建议先保存场景）">
          清空场景
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
      </div>
      {/* ── 撤销 / 重做 ── */}
      <div className="tb-group" title="撤销/重做（快捷键 ⌘Z / ⇧⌘Z）——覆盖组件、参数、图元、标注、色板的全部编辑">
        <button
          disabled={!sceneHistory.canUndo()}
          onClick={() => {
            sceneHistory.undo();
          }}
          title="撤回上一步编辑（⌘Z）"
        >
          ↶ 后退
        </button>
        <button
          disabled={!sceneHistory.canRedo()}
          onClick={() => {
            sceneHistory.redo();
          }}
          title="重做被撤回的一步（⇧⌘Z）"
        >
          ↷ 前进
        </button>
      </div>
      {/* ── 编辑工具 ── */}
      <ShapeToolGroup />
      {/* ── 工作模式 ── */}
      <ModeGroup />
      {/* ── 视图区：高频视角常驻 + 视图选项下拉 ── */}
      <div className="tb-group" title="构图预设（T-4.3）：保持视距只转方位">
        {(['iso', 'front', 'top'] as const).map((p) => (
          <button
            key={p}
            onClick={() => rendererRef.current?.setCameraPreset(p)}
            title="构图预设（T-4.3）：保持视距只转方位"
          >
            {p === 'iso' ? '等距' : p === 'front' ? '正视' : '俯视'}
          </button>
        ))}
        <DropdownMenu label="视图" title="视角与渲染选项">
          <MenuItem onClick={() => rendererRef.current?.snapHorizon()} title="水平线吸附：视线降到水平（地平线水平）">
            水平吸附
          </MenuItem>
          <MenuSep />
          <MenuBlock>
            <label className="chk" title="接触阴影（T-4.3）：方向光 shadow map + 接影地板，低成本立体感">
              <input
                type="checkbox"
                checked={shadows}
                onChange={(e) => {
                  setShadows(e.target.checked);
                  rendererRef.current?.setShadows(e.target.checked);
                }}
              />
              接触阴影
            </label>
          </MenuBlock>
          <MenuBlock>
            <button
              onClick={() => {
                const next = mode === 'render' ? 'toon' : 'render';
                setMode(next);
                rendererRef.current?.setRenderMode(next);
              }}
              title="双轨渲染（T-4.1）：渲染档 = PBR 质感（宣讲/PPT）；线稿档 = 三阶色阶+描边（期刊示意/矢量导出用）"
            >
              {mode === 'render' ? '🎨 渲染档（点击切线稿）' : '✏️ 线稿档（点击切渲染）'}
            </button>
          </MenuBlock>
        </DropdownMenu>
      </div>
      <div className="tb-spacer" />
      {/* ── 保存为模板（2026-09-17 统一模板库：唯一保存入口，完整画面快照） ── */}
      <div className="tb-group">
        <button
          className="primary"
          onClick={() => {
            void onSaveTemplate();
          }}
          title="把当前完整画面（组件 + 图元 + 视角 + 2D 视图）存为可视化模板卡片，左侧「模板」Tab 一键复用"
        >
          🧩 保存为模板
        </button>
      </div>
      {/* ── 导出区：主按钮 = 最近格式；下拉 = 全部格式 + 导出设置 ── */}
      <div className="tb-group">
        <DropdownMenu
          label={`导出 ${FMT_LABEL[lastFmt]}`}
          btnClass="primary"
          title={`导出为 ${FMT_LABEL[lastFmt]}（点击 ▼ 换格式 / 调分辨率）`}
          onMainClick={() => exportRunner[lastFmt]()}
          width={250}
        >
          <MenuItem onClick={() => runFmt('png')} title="通用插图位图">
            PNG 位图
          </MenuItem>
          <MenuItem onClick={() => runFmt('tiff')} title="期刊投稿格式（300dpi+ 硬要求，含物理分辨率元数据）">
            TIFF（期刊）
          </MenuItem>
          <MenuItem onClick={() => runFmt('pdf')} title="PDF：页面物理尺寸 = 设定 cm 数（位图满幅嵌入）">
            PDF
          </MenuItem>
          <MenuItem onClick={() => runFmt('svg')} title="矢量图（线稿档画风）：PPT 插入后右键「转换为形状」可逐组件编辑">
            SVG 矢量
          </MenuItem>
          <MenuItem onClick={() => runFmt('layers')} title="每可见组件一张透明底 PNG（远→近序号命名），PPT 中按序叠放即还原整图">
            分层 PNG
          </MenuItem>
          <MenuItem onClick={() => runFmt('gif')} title="卷曲动画 GIF：选中埃洛石管后导出「片→管」动画（20 帧）">
            动画 GIF
          </MenuItem>
          <MenuSep />
          <MenuBlock>
            <div className="dd-row">
              <span>分辨率</span>
              <select
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
                title="导出分辨率（按 16cm 版面宽度折算像素）"
              >
                <option value={96}>96 dpi</option>
                <option value={300}>300 dpi</option>
                <option value={600}>600 dpi</option>
              </select>
            </div>
            <div className="dd-row">
              <span>背景</span>
              <label className="chk" title="透明底便于 PPT 叠放">
                <input type="checkbox" checked={alpha} onChange={(e) => setAlpha(e.target.checked)} />
                透明底
              </label>
            </div>
            <div className="dd-row dim">
              16 cm @ {dpi} dpi → {exportPx()}
            </div>
          </MenuBlock>
        </DropdownMenu>
      </div>
      {toast ? <div className="badge">{toast}</div> : null}
    </header>
  );
}
