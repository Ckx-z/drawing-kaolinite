/**
 * 模板库面板 —— T-2.3 / T-3.2 / 2026-09-17 统一模板库
 * 「我的模板」：搜索（名称/标签）+ 类型筛选 + 收藏排序 + 卡片网格（缩略图/打开/删除）
 * + 导入/导出批量备份。数据源 moduleLibrary（IndexedDB，统一底座）；
 * 点击卡片 = 作为独立场景打开（moduleToSceneDocument → sceneStore.loadScene
 * 一次性替换：组件/图元/标注/相机/形态/2D 视图，不叠加）。
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
  moduleToSceneDocument,
  placeholderTemplateThumb,
  toggleFavorite,
  type ModuleFilterType,
} from '../state/moduleLibrary';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import type { TemplateEntry } from '../state/templateLibrary';
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

  /**
   * 统一打开模板（2026-09-17：模板 = 独立场景，OPEN/REPLACE）：
   * normalize（moduleToSceneDocument，完整替换语义）→ sceneStore.loadScene
   * 一次性替换（与场景文件打开共用链路：原子 set、清 selection/测量拾取、
   * 恢复相机/形态/2D 视图、锚定按原 id 天然成立）→ 无视角快照的 legacy
   * 条目才 frameAll fallback。校验失败在 set 之前抛错 → 当前场景原样保留。
   * 不调用「清空场景」UI handler，无确认弹窗（点击即表达打开意图）。
   */
  const openTemplate = (m: ModuleEntry): void => {
    try {
      const restored = sceneStore.getState().loadScene(moduleToSceneDocument(m));
      if (!restored) rendererRef.current?.frameAll();
    } catch (err) {
      alert(`模板数据无效，当前场景未改动：${(err as Error).message}`);
    }
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
            <div key={m.id} className="mod-card" onClick={() => openTemplate(m)} title="作为独立场景打开（完整替换当前画布，含图元与视角）">
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
