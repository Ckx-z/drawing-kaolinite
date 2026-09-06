/**
 * 顶部工具栏 —— T-1.6/T-1.7（对齐 demo：示例场景 / 保存场景 / 打开场景 / 导出 PNG / 清空）
 */
import { useRef, useState } from 'react';
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
      </div>
      <div className="tb-group">
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
