/**
 * 模板库面板 —— T-2.3 / T-3.2 / 2026-09-17 统一模板库
 * 「我的模板」：搜索（名称/标签）+ 类型筛选 + 收藏排序 + 卡片网格（缩略图/载入/删除）
 * + 导入/导出批量备份。数据源 moduleLibrary（IndexedDB，统一底座）；
 * 三类条目：旧单组件模块 / 旧组合模块（插入当前场景，历史行为）/ 统一模板
 * （type:'template' 完整画面快照——复用 applyTemplate 追加合并 + 视角原样恢复）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import seedTemplates from '../../data/seed-templates.json';
import {
  deleteModule,
  ensureSeededTemplates,
  exportModules,
  filterModules,
  generateMissingThumbnails,
  importModules,
  listModules,
  moduleToTemplate,
  placeholderTemplateThumb,
  toggleFavorite,
  type ModuleFilterType,
} from '../state/moduleLibrary';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { applyTemplate, type TemplateEntry } from '../state/templateLibrary';
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
  ['template', '模板场景'],
];

export default function ModulePanel() {
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ModuleFilterType>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = (): void => {
      // 种子模板注入统一库（稳定 id 幂等）→ 历史占位缩略图回填（纯 2D 模板，
      // 幂等）→ 列表刷新
      void ensureSeededTemplates(seedTemplates as TemplateEntry[])
        .then(() => generateMissingThumbnails())
        .then(() => listModules())
        .then(setModules)
        .catch(() => setModules([])); // 存储不可用时空列表降级
    };
    refresh();
    window.addEventListener('kaolin-modules-changed', refresh);
    return () => window.removeEventListener('kaolin-modules-changed', refresh);
  }, []);

  // T-3.2：关键词 + 类型筛选 + 收藏优先排序（内存过滤）
  const shown = useMemo(() => filterModules(modules, { query, type }), [modules, query, type]);

  const instantiate = (m: ModuleEntry): void => {
    const s = sceneStore.getState();
    if (m.type === 'template') {
      // 统一模板（完整画面快照）：追加合并 + 相机/形态/2D 视图原样恢复，
      // 单命令可撤销——禁止 frameAll/重排类取景（2026-09-13 五原则）
      applyTemplate(sceneStore, moduleToTemplate(m));
      return;
    }
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
        alert(`模板导入完成：${imported} 个成功${skipped ? `，${skipped} 个无效跳过` : ''}`);
      } catch (err) {
        alert(`导入失败：${(err as Error).message}`);
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  return (
    <>
      <h3>
        我的模板
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
              {/* thumb 存在即显示真实缩略图；仅解析失败（损坏数据）才换占位图标 */}
              <img
                src={m.thumb}
                alt=""
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.dataset.fallback) {
                    img.dataset.fallback = '1';
                    img.src = placeholderTemplateThumb();
                  }
                }}
              />
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
                title="删除模板"
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
        <p className="hint">无匹配模板——换个关键词或类型试试。</p>
      ) : (
        <p className="hint">
          暂无模板。点顶栏「🧩 保存为模板」把当前画面（组件 + 图元 + 视角）存成可视化卡片，即可反复复用。
        </p>
      )}
    </>
  );
}
