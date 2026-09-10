/**
 * 顶部工具栏 —— T-1.6/T-1.7（对齐 demo：示例场景 / 保存场景 / 打开场景 / 导出 PNG / 清空）
 * 2026-09-08：全部导出改走 saveFile.ts 统一入口（桌面 = 原生保存对话框 + Rust 写盘，
 * 修复打包版 <a download> 无效；浏览器 = showSaveFilePicker / 传统下载）。
 */
import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import { exportCurlAnimation } from '../export/animation';
import { buildLayerPngs } from '../export/layers';
import { SHAPE_TOOLS, type ShapeTool } from '../core/shapes/schema';
import { moduleEntryFromComponent, moduleEntryFromScene, saveModule } from '../state/moduleLibrary';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { shapeViewStore } from './shapes/view';
import { loadPresetScene } from './preset';
import { dataUrlToBlob, saveBlob, saveBlobs, saveText } from './saveFile';

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

/** T-11.6 画布形态切换（3D 混合 / 纯示意图）+ T-11.7 磁吸开关 + 视图缩放显示 */
function ModeGroup() {
  const mode = useStore(sceneStore, (s) => s.mode);
  const snap = useStore(shapeViewStore, (s) => s.snap);
  const zoom = useStore(shapeViewStore, (s) => s.zoom);
  return (
    <div className="tb-group" title="示意图模式：无 3D 的无限画布（空格/中键拖拽平移，滚轮缩放）；图元数据两模式共享">
      <button
        className={`mini${mode === 'mixed' ? ' on' : ''}`}
        onClick={() => sceneStore.getState().setMode('mixed')}
      >
        🧊 3D 混合
      </button>
      <button
        className={`mini${mode === 'diagram' ? ' on' : ''}`}
        onClick={() => sceneStore.getState().setMode('diagram')}
      >
        ✏️ 示意图
      </button>
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

  const flash = (msg: string): void => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
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
        sceneStore.getState().loadScene(String(reader.result));
        rendererRef.current?.frameAll();
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
    const { dataUrl, width, height } = svc.exportPNG({ dpi, alpha, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes });
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
    const svg = svc.exportSVG({ background: alpha ? undefined : '#F4F5F7', strokeWidth: 1, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes });
    const ok = await saveText('kaolin-scene.svg', svg, 'image/svg+xml');
    if (ok) flash('已导出分组 SVG（每组件一个分组，PPT 转形状后可逐组件编辑）');
  };

  /** T-5.2：PDF 导出（页面物理尺寸 = 设定 cm 数，位图满幅嵌入） */
  const onExportPDF = async (): Promise<void> => {
    const svc = rendererRef.current;
    if (!svc) return;
    const { blob, widthCM, heightCM } = svc.exportPDF({ dpi, alpha, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes });
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
    const { blob, width, height, degraded, effectiveDpi } = svc.exportTIFF({ dpi, alpha, annotations: sceneStore.getState().annotations, shapes: sceneStore.getState().shapes });
    const ok = await saveBlob(`kaolin-16cm-${Math.round(effectiveDpi)}dpi.tiff`, blob);
    if (!ok) return;
    flash(
      degraded
        ? `分辨率超 GPU 上限，已降级 ${width} × ${height} px（有效 ${Math.round(effectiveDpi)}dpi）`
        : `已导出 TIFF ${width} × ${height} px（16cm @ ${dpi}dpi${alpha ? '，透明底' : ''}）`,
    );
  };

  const onSaveModule = async (): Promise<void> => {
    const s = sceneStore.getState();
    if (!s.selectionId) {
      flash('请先在画布中点选一个组件，再保存为模块');
      return;
    }
    const comp = s.components.find((c) => c.id === s.selectionId);
    const svc = rendererRef.current;
    if (!comp || !svc) return;
    const thumb = svc.snapshotComponent(comp.id);
    await saveModule(moduleEntryFromComponent(comp, thumb));
    flash(`已存为模块「${comp.name}」，以后一键复用`);
  };

  /** T-3.1：整景存为组合模块（组件各自变换入库，实例化时相对位置整体复现） */
  const onSaveCombined = async (): Promise<void> => {
    const s = sceneStore.getState();
    const svc = rendererRef.current;
    if (!svc) return;
    if (!s.components.length) {
      flash('场景为空，先添加组件再存组合模块');
      return;
    }
    const thumb = svc.snapshotScene();
    const name = `组合模块（${s.components.length} 组件）`;
    await saveModule(moduleEntryFromScene(s.components, thumb, name));
    flash(`已存组合模块「${name}」，实例化后各组件仍独立可调`);
  };

  /** T-11.8：当前场景存为机理图模板（组件+图元+标注快照，一键复用） */
  const onSaveTemplate = async (): Promise<void> => {
    const s = sceneStore.getState();
    if (!s.shapes.length && !s.components.length) {
      flash('场景为空，先画点内容再存模板');
      return;
    }
    const name = `我的模板（${s.shapes.length} 图元${s.components.length ? ` + ${s.components.length} 组件` : ''}）`;
    const { saveTemplate } = await import('../state/templateLibrary');
    await saveTemplate({
      id: `tpl-user-${Date.now()}`,
      name,
      desc: '自存模板',
      components: s.components.map((c) => ({ ...c })) as never,
      shapes: structuredClone(s.shapes) as never,
      annotations: structuredClone(s.annotations) as never,
      createdAt: new Date().toISOString(),
    });
    sceneStore.getState().bumpTemplates(); // 模板分区立即出现新卡片
    flash(`已存为模板「${name}」，左侧模板分区可一键载入`);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◈</span> Kaolin-Assets
        <em>高岭土机理图绘制软件 · 生产工程 v0.1.0</em>
      </div>
      <div className="tb-group">
        <button onClick={loadPresetScene} title="一键组合：埃洛石@CeO₂ 复合材料场景">
          示例场景
        </button>
      </div>
      <ShapeToolGroup />
      <ModeGroup />
      <div className="tb-group">
        <button onClick={onSaveScene}>保存场景</button>
        <button onClick={onOpenScene}>打开场景</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
        <button
          className="primary"
          onClick={() => {
            void onSaveModule();
          }}
          title="把选中的组件存入左侧「我的模块」，可反复复用"
        >
          ★ 存为模块
        </button>
        <button
          onClick={() => {
            void onSaveCombined();
          }}
          title="把整景存为一个组合模块（管+颗粒+分子…整体复用，实例化后各组件仍独立可调）"
        >
          ★ 存组合
        </button>
        <button
          onClick={() => {
            void onSaveTemplate();
          }}
          title="把当前场景（含图元/箭头/文字）存为机理图模板，左侧「机理图模板」分区一键复用（T-11.8）"
        >
          🧩 存为模板
        </button>
      </div>
      <div className="tb-group">
        <select
          value={dpi}
          onChange={(e) => setDpi(Number(e.target.value))}
          title="导出分辨率（按 16cm 版面宽度折算像素）"
        >
          <option value={96}>96 dpi 预览</option>
          <option value={300}>300 dpi 期刊</option>
          <option value={600}>600 dpi 高清</option>
        </select>
        <label className="chk" title="透明底便于 PPT 叠放">
          <input type="checkbox" checked={alpha} onChange={(e) => setAlpha(e.target.checked)} />
          透明底
        </label>
        <button className="primary" onClick={onExportPNG}>
          导出 PNG
        </button>
        <button onClick={onExportTIFF} title="期刊投稿格式（300dpi+ 硬要求，含物理分辨率元数据）">
          导出 TIFF
        </button>
        <button onClick={onExportPDF} title="PDF：页面物理尺寸 = 设定 cm 数（位图满幅嵌入）">
          导出 PDF
        </button>
        <button
          onClick={() => {
            void onExportAnimation();
          }}
          title={'卷曲动画 GIF：选中埃洛石管后导出「片→管」动画（20 帧）'}
        >
          导出动画 GIF
        </button>
        <button
          onClick={onExportSVG}
          title={'矢量图（线稿档画风）：PPT 插入后右键「转换为形状」可逐组件编辑'}
        >
          导出 SVG
        </button>
        <button onClick={onExportLayeredPNG} title="每可见组件一张透明底 PNG（远→近序号命名），PPT 中按序叠放即还原整图">
          导出分层 PNG
        </button>
      </div>
      <div className="tb-group">
        <button
          onClick={() => {
            const next = mode === 'render' ? 'toon' : 'render';
            setMode(next);
            rendererRef.current?.setRenderMode(next);
          }}
          title="双轨渲染（T-4.1）：渲染档 = PBR 质感（宣讲/PPT）；线稿档 = 三阶色阶+描边（期刊示意/矢量导出用）"
        >
          {mode === 'render' ? '🎨 渲染档' : '✏️ 线稿档'}
        </button>
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
        <span style={{ opacity: 0.6, alignSelf: 'center', fontSize: 12 }}>视角</span>
        {(['iso', 'front', 'top'] as const).map((p) => (
          <button
            key={p}
            onClick={() => rendererRef.current?.setCameraPreset(p)}
            title="构图预设（T-4.3）：保持视距只转方位"
          >
            {p === 'iso' ? '等距' : p === 'front' ? '正视' : '俯视'}
          </button>
        ))}
        <button onClick={() => rendererRef.current?.snapHorizon()} title="水平线吸附：视线降到水平（地平线水平）">
          水平吸附
        </button>
        <button
          onClick={() => {
            sceneStore.getState().clear();
            rendererRef.current?.frameAll();
          }}
        >
          清空
        </button>
      </div>
      {toast ? <div className="badge">{toast}</div> : null}
    </header>
  );
}
