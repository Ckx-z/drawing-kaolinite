/**
 * 顶部工具栏 —— T-1.6/T-1.7（对齐 demo：示例场景 / 保存场景 / 打开场景 / 导出 PNG / 清空）
 */
import { useRef, useState } from 'react';
import { moduleEntryFromComponent, moduleEntryFromScene, saveModule } from '../state/moduleLibrary';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { loadPresetScene } from './preset';

function download(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
}

export default function TopBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dpi, setDpi] = useState(300);
  const [alpha, setAlpha] = useState(false);
  const [mode, setMode] = useState<'render' | 'toon'>('render');
  const [toast, setToast] = useState('');

  const flash = (msg: string): void => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  const onSaveScene = (): void => {
    const blob = new Blob([JSON.stringify(sceneStore.getState().toSceneDocument(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    download(url, 'kaolin-scene.json');
    setTimeout(() => URL.revokeObjectURL(url), 3000);
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

  const onExportPNG = (): void => {
    const svc = rendererRef.current;
    if (!svc) return;
    const { dataUrl, width, height } = svc.exportPNG({ dpi, alpha });
    download(dataUrl, `kaolin-16cm-${dpi}dpi.png`);
    flash(`已导出 ${width} × ${height} px（16cm @ ${dpi}dpi${alpha ? '，透明底' : ''}）`);
  };

  /** T-5.1：期刊 TIFF（300dpi+ 硬要求，带物理分辨率元数据；超上限自动降级提示） */
  const onExportTIFF = (): void => {
    const svc = rendererRef.current;
    if (!svc) return;
    const { blob, width, height, degraded, effectiveDpi } = svc.exportTIFF({ dpi, alpha });
    const url = URL.createObjectURL(blob);
    download(url, `kaolin-16cm-${Math.round(effectiveDpi)}dpi.tiff`);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
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
