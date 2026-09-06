/**
 * 顶部工具栏 —— T-1.6（对齐 demo：示例场景 / 保存场景 / 打开场景 / 清空）
 * 导出 PNG 与模块库按钮由 T-1.7 / 阶段 2 接入。
 */
import { useRef } from 'react';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { loadPresetScene } from './preset';

function download(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

export default function TopBar() {
  const fileRef = useRef<HTMLInputElement>(null);

  const onSaveScene = (): void => {
    download(JSON.stringify(sceneStore.getState().toSceneDocument(), null, 2), 'kaolin-scene.json');
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
      } catch (err) {
        alert(`场景文件解析失败：${(err as Error).message}`);
      }
    };
    reader.readAsText(f);
    e.target.value = '';
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
        <button
          onClick={() => {
            sceneStore.getState().clear();
            rendererRef.current?.frameAll();
          }}
        >
          清空
        </button>
      </div>
      <div className="badge">T-1.6 交互面板就绪</div>
    </header>
  );
}
