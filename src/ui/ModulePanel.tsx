/**
 * 模块库面板 —— T-2.3
 * 「我的模块」：卡片网格（缩略图/实例化/删除）+ 导入/导出批量备份。
 * 数据源 moduleLibrary（IndexedDB）；实例化 = addComponent（参数全量覆盖，仍可继续修改）。
 */
import { useEffect, useRef, useState } from 'react';
import {
  deleteModule,
  exportModules,
  importModules,
  listModules,
} from '../state/moduleLibrary';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import type { ModuleEntry } from '../core/types';

export default function ModulePanel() {
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = (): void => {
      listModules().then(setModules);
    };
    refresh();
    window.addEventListener('kaolin-modules-changed', refresh);
    return () => window.removeEventListener('kaolin-modules-changed', refresh);
  }, []);

  const instantiate = (m: ModuleEntry): void => {
    const id = sceneStore.getState().addComponent(m.type, {
      name: `${m.name} 副本`,
      params: m.params,
      transform: m.transform,
    });
    rendererRef.current?.frameComponent(id);
  };

  const onExport = async (): Promise<void> => {
    const text = await exportModules();
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kaolin-modules.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { imported, skipped } = await importModules(String(reader.result));
        alert(`模块导入完成：${imported} 个成功${skipped ? `，${skipped} 个无效跳过` : ''}`);
      } catch (err) {
        alert(`导入失败：${(err as Error).message}`);
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  return (
    <>
      <h3 style={{ marginTop: 16 }}>
        我的模块
        <span className="tip">
          <button className="mini" onClick={onExport} title="导出 .kaolin-modules.json 批量备份">
            导出
          </button>{' '}
          <button className="mini" onClick={() => fileRef.current?.click()} title="从备份文件导入">
            导入
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImportFile} />
        </span>
      </h3>
      {modules.length ? (
        <div className="mod-grid">
          {modules.map((m) => (
            <div key={m.id} className="mod-card" onClick={() => instantiate(m)}>
              <img src={m.thumb} alt="" />
              <div className="n">{m.name}</div>
              <div
                className="x"
                title="删除模块"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteModule(m.id);
                }}
              >
                ✕
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">
          暂无模块。选中组件后点顶栏「★ 存为模块」，即可反复复用；半年积累 8–10 个常用模块。
        </p>
      )}
    </>
  );
}
