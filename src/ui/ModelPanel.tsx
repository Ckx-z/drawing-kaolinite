/**
 * 模型素材面板（UI 重构 2026-10-22，参考截图一·重点重构）
 *
 * 数据驱动，两个来源、零硬编码复制：
 *  1. 科学素材 = core/assets ASSET_INDEX 全量（7 类基础组件 + 24 科学资产，
 *     listAssets 只读拷贝）——卡片真实缩略图经 modelThumbs 离屏工作室生成并缓存；
 *  2. 模块库 = Dexie moduleLibrary 非 template 条目（单组件/组合模块），沿用入库
 *     时的真实缩略图与 favorite 字段。
 * 交互：单击 = 原 Direct Add / 模块组件追加（sceneStore.addComponent 原路径）；
 * 按住 = V2 拖放（wireCardDrag，仅素材卡——模块此前无拖拽，保持原交互）。
 * 收藏：素材卡走 modelFavorites（localStorage）；模块卡沿用 Dexie favorite
 * （与模板面板同一数据源，状态天然同步）。
 * 分类下拉选项由真实数据派生（typeBadge 去重 + 模块库），分类 × 关键词可叠加。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createAssetComponent, listAssets, type SearchableAsset } from '../core/assets/assetSearch';
import type { ComponentType } from '../core/types';
import { listModules, toggleFavorite } from '../state/moduleLibrary';
import type { ModuleEntry } from '../core/types';
import { modelFavorites } from '../state/modelFavorites';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { LIB } from './paramDefs';
import {
  consumeDraggedFlag,
  wireCardDrag,
} from './dragPlace';
import { ensureThumbs, getCachedThumb, subscribeThumbs, getThumbVersion } from './modelThumbs';
import { IconSearch, IconStar } from './icons';
import {
  formulaTo3D,
  resolveImportPath,
} from '../core/molecules/formula';
import { findMineral } from '../core/minerals';
import { resolveCanonicalFormula, resolveMoleculeQuery } from '../core/molecules/registry';
import { smilesTo3D } from '../core/molecules/smiles';

/* ---------- 数据模型 ---------- */

interface AssetDef {
  kind: 'asset';
  key: string;
  assetId: string;
  name: string;
  badge: string;
  icon: string;
  spec: { componentType: ComponentType; params: Record<string, unknown> };
}

const assetDefs: AssetDef[] = listAssets().map((a: SearchableAsset) => ({
  kind: 'asset',
  key: `asset:${a.id}`,
  assetId: a.id,
  name: a.nameZh,
  badge: a.typeBadge,
  icon: LIB.find((l) => l.type === a.componentType)?.icon ?? '✦',
  spec: { componentType: a.componentType, params: a.params },
}));

const ASSET_CATEGORIES = [...new Set(assetDefs.map((a) => a.badge))];

/** 模块条目归一（判别联合）：单组件模块 = 扁平形态；组合/模板 = components 数组 */
function partsOf(m: ModuleEntry): Array<{
  name: string;
  type: ComponentType;
  params: Record<string, unknown>;
  transform: { position: [number, number, number]; rotation: [number, number, number]; scale: number };
  visible: boolean;
}> {
  if (m.type === 'combined' || m.type === 'template') {
    return m.components.map((c) => ({
      name: c.name,
      type: c.type as ComponentType,
      params: c.params as Record<string, unknown>,
      transform: c.transform,
      visible: c.visible,
    }));
  }
  return [
    {
      name: m.name,
      type: m.type as ComponentType,
      params: m.params as Record<string, unknown>,
      transform: m.transform,
      visible: true,
    },
  ];
}

/** 面板内小卡片（素材/模块共用骨架） */
function Card({
  name,
  title,
  thumb,
  failed,
  fallbackIcon,
  fav,
  onFav,
  onClick,
  onPointerDown,
}: {
  name: string;
  title: string;
  thumb: string;
  failed: boolean;
  fallbackIcon: string;
  fav: boolean;
  onFav: () => void;
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}): React.ReactElement {
  const v = useSyncExternalStore(subscribeThumbs, getThumbVersion);
  void v; // 订阅版本号：缩略图生成完成 → 重读 getCachedThumb
  const src = thumb === '!' ? '' : thumb;
  return (
    <div className="mp-card" onClick={onClick} onPointerDown={onPointerDown} title={title} role="button" tabIndex={0}>
      <div className={`mp-thumb${src ? '' : failed ? ' mp-thumb-fail' : ' mp-thumb-pending'}`}>
        {src ? (
          <img src={src} alt={name} draggable={false} />
        ) : (
          <span className="mp-ph" aria-label={failed ? '预览不可用' : '预览生成中'}>{fallbackIcon}</span>
        )}
      </div>
      <div className="mp-name">{name}</div>
      <button
        className={`mp-fav${fav ? ' on' : ''}`}
        title={fav ? '取消收藏' : '收藏'}
        aria-label={fav ? '取消收藏' : '收藏'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFav();
        }}
      >
        <IconStar size={15} filled={fav} />
      </button>
    </div>
  );
}

export default function ModelPanel(props: { mode: 'all' | 'fav' }): React.ReactElement {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('全部');
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [smiles, setSmiles] = useState('');
  const [hint, setHint] = useState('');
  const favs = useSyncExternalStore(modelFavorites.subscribe, () => modelFavorites.getState().favs);

  // 模块库装载（与 ModulePanel 同款事件驱动刷新：收藏/保存/删除即时同步）
  useEffect(() => {
    const refresh = (): void => {
      void listModules()
        .then((all) => setModules(all.filter((m) => m.type !== 'template')))
        .catch(() => setModules([]));
    };
    refresh();
    window.addEventListener('kaolin-modules-changed', refresh);
    return () => window.removeEventListener('kaolin-modules-changed', refresh);
  }, []);

  // 真实缩略图：面板挂载即后台队列生成（缓存命中零成本）
  useEffect(() => {
    ensureThumbs(assetDefs.map((d) => ({ key: d.key, spec: d.spec })));
  }, []);

  const q = query.trim().toLowerCase();
  const matchText = (...fields: Array<string | undefined>): boolean =>
    !q || fields.some((f) => f?.toLowerCase().includes(q));

  const showModulesSection = cat === '全部' || cat === '模块库';
  const showAssets = cat !== '模块库';

  const catOptions = useMemo(
    () => ['全部', ...ASSET_CATEGORIES, '模块库'],
    [], // 类目源自静态素材索引，模块存在与否不影响选项完整性
  );

  const assetHits = assetDefs.filter(
    (d) =>
      (props.mode === 'fav' ? Boolean(favs[d.key]) : true) &&
      cat !== '模块库' &&
      (cat === '全部' || d.badge === cat) &&
      matchText(d.name, d.assetId),
  );
  const moduleHits = modules.filter(
    (m) =>
      (props.mode === 'fav' ? Boolean(m.favorite) : true) &&
      (showModulesSection || cat === '模块库') &&
      matchText(m.name, ...(m.tags ?? [])),
  );
  const empty = assetHits.length === 0 && moduleHits.length === 0;

  /* ---------- 添加路径（原有逻辑原样：Direct Add / 模块组件追加） ---------- */

  const addAsset = (assetId: string): void => {
    try {
      const spec = createAssetComponent(assetId);
      if (!spec) throw new Error(`未知资产：${assetId}`);
      const id = sceneStore.getState().addComponent(spec.componentType, {
        name: spec.name,
        params: spec.params as never,
      });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
    } catch (err) {
      setHint(`无法添加该素材：${(err as Error).message}`);
    }
  };

  const addModuleToScene = (m: ModuleEntry): void => {
    try {
      const parts = partsOf(m);
      let last = '';
      for (const c of parts) {
        last = sceneStore.getState().addComponent(c.type, {
          name: c.name,
          params: c.params as never,
          transform: {
            position: [...c.transform.position] as [number, number, number],
            rotation: [...c.transform.rotation] as [number, number, number],
            scale: c.transform.scale,
          },
          visible: c.visible,
        });
      }
      if (last) {
        sceneStore.getState().select(last);
        if (parts.length > 1) rendererRef.current?.frameAll();
        else rendererRef.current?.frameComponent(last);
      }
      setHint(`已添加「${m.name}」（${parts.length} 组件，可继续编辑参数）`);
    } catch (err) {
      setHint(`✕ 添加失败：${(err as Error).message}`);
    }
  };

  /* ---------- SMILES / 化学式 / 矿物名导入（原 LibraryPanel 逻辑原样上移） ---------- */

  const addMolecule = (): void => {
    const s = smiles.trim();
    if (!s) return;
    const mineral = findMineral(s);
    if (mineral) {
      const id = sceneStore.getState().addComponent('kaolinite_sheet', {
        name: mineral.zh[0],
        params: { mineral: mineral.key, d001: mineral.d001Default } as never,
      });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      setSmiles('');
      setHint(`已导入 ${mineral.zh[0]}（${mineral.en} · ${mineral.formula} · CIF 晶体结构）`);
      return;
    }
    const canonical = resolveMoleculeQuery(s);
    if (canonical) {
      const id = sceneStore.getState().addComponent('molecule', { name: s, params: { kind: canonical } });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      setSmiles('');
      setHint(`已导入内置分子 ${canonical}（参考几何）`);
      return;
    }
    const formulaFirst = resolveImportPath(s) === 'formula-first';
    if (!formulaFirst) {
      try {
        smilesTo3D(s); // 预校验（非法即抛错，不入库）
        const id = sceneStore.getState().addComponent('molecule', { name: s, params: { smiles: s, kind: 'H₂O' } });
        sceneStore.getState().select(id);
        rendererRef.current?.frameComponent(id);
        setSmiles('');
        setHint('已导入 SMILES 分子');
        return;
      } catch {
        // 落入化学式分支
      }
    }
    try {
      const upgraded = resolveCanonicalFormula(s);
      if (upgraded) {
        const id = sceneStore.getState().addComponent('molecule', { name: s, params: { kind: upgraded } });
        sceneStore.getState().select(id);
        rendererRef.current?.frameComponent(id);
        setSmiles('');
        setHint(`已导入内置分子 ${upgraded}（参考几何）`);
        return;
      }
      const { canonical } = formulaTo3D(s);
      const id = sceneStore.getState().addComponent('molecule', { name: canonical, params: { formula: canonical, kind: 'H₂O' } });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      setSmiles('');
      setHint(`已导入化学式 ${canonical}`);
    } catch (err) {
      setHint(`✕ 无法识别为 SMILES 或化学式（${err instanceof Error ? err.message : '导入失败'}）`);
    }
  };

  return (
    <div className="mp">
      {/* 分类 + 搜索（同一行，参考截图一） */}
      <div className="mp-top">
        <select
          className="mp-cat"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          title="按素材类型筛选"
          aria-label="素材分类"
        >
          {catOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="mp-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="请输入关键字搜索"
            aria-label="搜索素材"
          />
          <span className="mp-search-ic">
            <IconSearch size={15} />
          </span>
        </div>
      </div>

      <div className="mp-body">
      {props.mode === 'fav' && <div className="mp-sec">收藏的素材</div>}
      {empty ? (
        <div className="mp-empty">
          <span className="mp-empty-ic">⌀</span>
          {props.mode === 'fav' ? '还没有收藏——在卡片右上角 ☆ 一键收藏' : '未找到匹配的素材'}
        </div>
      ) : (
        <>
          {showAssets && cat !== '模块库' && (
            <>
              {props.mode !== 'fav' && <div className="mp-sec">科学素材（{assetHits.length}）</div>}
              <div className="mp-grid">
                {assetHits.map((d) => (
                  <Card
                    key={d.key}
                    name={d.name}
                    title={`${d.name}（${d.badge}）· 点击添加，或按住拖入画布`}
                    thumb={getCachedThumb(d.key)}
                    failed={getCachedThumb(d.key) === '!'}
                    fallbackIcon={d.icon}
                    fav={Boolean(favs[d.key])}
                    onFav={() => modelFavorites.getState().toggle(d.key)}
                    onClick={() => {
                      if (consumeDraggedFlag()) return;
                      addAsset(d.assetId);
                    }}
                    onPointerDown={(e) => wireCardDrag(e, () => createAssetComponent(d.assetId))}
                  />
                ))}
              </div>
            </>
          )}
          {showModulesSection && moduleHits.length > 0 && (
            <>
              <div className="mp-sec">模块库（{moduleHits.length}）</div>
              <div className="mp-grid">
                {moduleHits.map((m) => (
                  <Card
                    key={m.id}
                    name={m.name}
                    title={`${m.name} · 点击添加到当前画布（${partsOf(m).length} 组件）`}
                    thumb={m.thumb.includes('data-ph') ? '' : m.thumb}
                    failed={false}
                    fallbackIcon="🧩"
                    fav={Boolean(m.favorite)}
                    onFav={() => {
                      void toggleFavorite(m.id).catch(() => setHint('✕ 收藏失败（存储不可用）'));
                    }}
                    onClick={() => addModuleToScene(m)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* SMILES / 化学式 / 矿物名导入（原素材库入口保留） */}
      {props.mode === 'all' && (
        <div className="mp-smiles">
          <input
            value={smiles}
            onChange={(e) => setSmiles(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMolecule();
            }}
            placeholder="SMILES / 化学式 / 矿物名"
            title="支持：SMILES（CCO）/ 化学式（CO、fe2o3）/ 矿物中英文名（高岭石、蒙脱石）——回车导入"
            aria-label="SMILES 导入"
          />
          <button
            className="mp-go"
            onClick={addMolecule}
            title="导入（回车同效）"
          >
            导入
          </button>
        </div>
      )}
      {hint && (
        <p className="mp-hint">{hint}</p>
      )}
      </div>
    </div>
  );
}

