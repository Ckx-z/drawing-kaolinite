/**
 * 模块库面板 —— T-2.3 / T-3.2
 * 「我的模块」：搜索（名称/标签）+ 类型筛选 + 收藏排序 + 卡片网格（缩略图/实例化/删除）
 * + 导入/导出批量备份。
 * 数据源 moduleLibrary（IndexedDB）；实例化 = addComponent（参数全量覆盖，仍可继续修改）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteModule,
  exportModules,
  filterModules,
  importModules,
  listModules,
  toggleFavorite,
  type ModuleFilterType,
} from '../state/moduleLibrary';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import type { ModuleEntry } from '../core/types';

const TYPE_LABELS: Array<[ModuleFilterType, string]> = [
  ['all', '全部'],
  ['kaolinite_sheet', '片层'],
  ['halloysite_tube', '管'],
  ['nanoparticle', '颗粒'],
  ['molecule', '分子'],
  ['rubber_substrate', '基底'],
  ['packed_layers', '密排层'],
  ['combined', '组合'],
];

export default function ModulePanel() {
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ModuleFilterType>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = (): void => {
      listModules().then(setModules);
    };
    refresh();
    window.addEventListener('kaolin-modules-changed', refresh);
    return () => window.removeEventListener('kaolin-modules-changed', refresh);
  }, []);

  // T-3.2：关键词 + 类型筛选 + 收藏优先排序（内存过滤）
  const shown = useMemo(() => filterModules(modules, { query, type }), [modules, query, type]);

  const instantiate = (m: ModuleEntry): void => {
    const s = sceneStore.getState();
    if (m.type === 'combined') {
      // T-3.1 组合模块：逐组件 addComponent（变换原样还原 → 相对位置一致），
      // 实例化后各组件仍独立可选中/调参/删除
      for (const c of m.components) {
        s.addComponent(c.type, {
          name: c.name,
          params: c.params,
          transform: c.transform,
          visible: c.visible,
        });
      }
      rendererRef.current?.frameAll();
      return;
    }
    const id = s.addComponent(m.type, {
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
      {modules.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称/标签"
            style={{ flex: 1, minWidth: 0 }}
          />
          <select value={type} onChange={(e) => setType(e.target.value as ModuleFilterType)}>
            {TYPE_LABELS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {shown.length ? (
        <div className="mod-grid">
          {shown.map((m) => (
            <div key={m.id} className="mod-card" onClick={() => instantiate(m)}>
              <img src={m.thumb} alt="" />
              <div className="n">{m.name}</div>
              <div
                className="fav"
                data-on={m.favorite ? '1' : '0'}
                title={m.favorite ? '取消收藏' : '收藏（置顶显示）'}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleFavorite(m.id);
                }}
              >
                {m.favorite ? '★' : '☆'}
              </div>
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
      ) : modules.length ? (
        <p className="hint">无匹配模块——换个关键词或类型试试。</p>
      ) : (
        <p className="hint">
          暂无模块。选中组件后点顶栏「★ 存为模块」、或点「★ 存组合」保存整景，即可反复复用；半年积累 8–10 个常用模块。
        </p>
      )}
    </>
  );
}
