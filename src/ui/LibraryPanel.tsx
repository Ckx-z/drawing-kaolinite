/**
 * 素材库面板 —— T-1.6/T-2.3/T-2.8 / 2026-09-17 统一模板库
 * 上：素材库（点击添加组件并取景）+ SMILES 分子导入；「模板」Tab = 我的模板
 * （ModulePanel：模块/组合/完整画面模板统一卡片，IndexedDB 持久化）。
 */
import { useMemo, useRef, useState  } from 'react';
import { useStore } from 'zustand';
import { formulaTo3D, resolveImportPath } from '../core/molecules/formula';
import { parseSdfOrMol } from '../core/molecules/mol';
import { findMineral } from '../core/minerals';
import { resolveCanonicalFormula, resolveMoleculeQuery } from '../core/molecules/registry';
import { smilesTo3D } from '../core/molecules/smiles';
import type { ComponentType } from '../core/types';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { SidebarTabs } from './primitives';
import ModulePanel from './ModulePanel';
import { filterLib, LIB } from './paramDefs';
import { createAssetComponent, searchAssets, type SearchResult } from '../core/assets/assetSearch';

/** 科学资产搜索模式（2026-09-22d）：query 非空 → 具体资产卡（点击直加）；空 → 原分类浏览 */
function AssetSearchResults({ query, onAdd }: { query: string; onAdd: (r: SearchResult) => void }) {
  const results = useMemo(() => searchAssets(query), [query]);
  if (!results.length) {
    return (
      <>
        <p className="hint">未找到内置参考素材</p>
        <p className="hint" style={{ opacity: 0.7 }}>可在下方输入框按 SMILES / 化学式 / MOL 文件导入，或换个关键词</p>
      </>
    );
  }
  return (
    <>
      <p className="hint" style={{ margin: '0 0 6px' }}>找到 {results.length} 个素材</p>
      <div>
        {results.map((r) => (
          <div key={r.id} className="lib-card" onClick={() => onAdd(r)} title={`${r.description} · 点击直接添加`}>
            <div className="t">
              <span className="ic">{r.type === 'molecule' ? '✦' : r.type === 'mineral' ? '◈' : '▣'}</span>
              {r.nameZh}
            </div>
            <div className="d">
              {r.nameEn}{r.formula ? ` · ${r.formula}` : ''} · {r.typeBadge} · {r.quality}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function LibraryPanel() {
  useStore(sceneStore, () => null); // 订阅以随 store 更新（当前卡片为静态列表）
  const [smiles, setSmiles] = useState('');
  // 左栏 Tabs + 素材搜索（2026-09-16）：UI 态本地，不进 store；
  // 2026-09-17 统一模板库：模块/模板两 Tab 合并为「模板」（ModulePanel）
  const [tab, setTab] = useState<'assets' | 'templates'>('assets');
  const [libQuery, setLibQuery] = useState('');

  const [smilesMsg, setSmilesMsg] = useState('');

  const add = (type: ComponentType): void => {
    const id = sceneStore.getState().addComponent(type);
    sceneStore.getState().select(id); // demo 行为：添加后自动选中，参数面板立即可调
    rendererRef.current?.frameComponent(id);
  };

  /**
   * 分子导入（T-2.8 SMILES + 2026-09-08 化学式双路；2026-09-12 分流修正）：
   * "纯化学式形态"（单元素符号 O/Si/Au、两元素二元式 CO/NO/CN）**化学式优先**——
   * 这类输入若被 SMILES 抢先会被隐式氢加成（CO→甲醇、O→水，用户报告 bug）；
   * 其余（CCO=乙醇等真 SMILES）仍 SMILES 优先，失败自动转化学式。
   */
  // T-2.10：MOL/SDF 文件导入（ChemDraw/Materials Studio 等导出；V2000 构象精确）
  // 双入口：📁 按钮选择器 + 拖拽文件到输入框（行为一致）
  const fileRef = useRef<HTMLInputElement>(null);
  const importMolText = (text: string, fallbackName: string): void => {
    try {
      const m = parseSdfOrMol(text); // 预校验（非法即抛错，不入库）
      const name = m.name || fallbackName;
      const id = sceneStore.getState().addComponent('molecule', {
        name,
        params: { mol: text, kind: 'H₂O' },
      });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      setSmilesMsg(`已导入 ${name}（${m.atoms.length} 原子 · MOL 构象）`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解析失败';
      setSmilesMsg(`✕ MOL/SDF 解析失败：${msg}`);
    }
  };
  const onMolFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 同文件可重复导入
    if (f) void f.text().then((t) => importMolText(t, f.name.replace(/\.(mol|sdf)$/i, '')));
  };
  const onDropMol = (e: React.DragEvent): void => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void f.text().then((t) => importMolText(t, f.name.replace(/\.(mol|sdf)$/i, '')));
  };

  const addMolecule = (): void => {
    const s = smiles.trim();
    if (!s) return;
    // 矿物中文名/英文名识别（2026-09-12）：命中 → 直接添加该矿物的 CIF 结构片层
    const mineral = findMineral(s);
    if (mineral) {
      const id = sceneStore.getState().addComponent('kaolinite_sheet', {
        name: mineral.zh[0],
        params: { mineral: mineral.key, d001: mineral.d001Default } as never,
      });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      setSmiles('');
      setSmilesMsg(`已导入 ${mineral.zh[0]}（${mineral.en} · ${mineral.formula} · CIF 晶体结构）`);
      return;
    }
    // canonical 分子别名（2026-09-18）：水/水分子/H2O/H₂O/water 等 → 内置参考几何。
    // 搜索词只解析身份，几何由 buildMolecule(kind) 唯一供给（修复误走团簇生成器）
    const canonical = resolveMoleculeQuery(s);
    if (canonical) {
      const id = sceneStore.getState().addComponent('molecule', {
        name: s,
        params: { kind: canonical },
      });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      setSmiles('');
      setSmilesMsg(`已导入内置分子 ${canonical}（参考几何）`);
      return;
    }
    const formulaFirst = resolveImportPath(s) === 'formula-first';
    if (!formulaFirst) {
      try {
        smilesTo3D(s); // 预校验（非法即抛错，不入库）
        const id = sceneStore.getState().addComponent('molecule', {
          name: s,
          params: { smiles: s, kind: 'H₂O' },
        });
        sceneStore.getState().select(id);
        rendererRef.current?.frameComponent(id);
        setSmiles('');
        setSmilesMsg('已导入 SMILES 分子');
        return;
      } catch {
        // 落入化学式分支
      }
    }
    try {
      // 化学式 → canonical 升级（2026-09-18）：有权威 preset（H2O/CO2…）优先 preset
      const upgraded = resolveCanonicalFormula(s);
      if (upgraded) {
        const id = sceneStore.getState().addComponent('molecule', {
          name: s,
          params: { kind: upgraded },
        });
        sceneStore.getState().select(id);
        rendererRef.current?.frameComponent(id);
        setSmiles('');
        setSmilesMsg(`已导入内置分子 ${upgraded}（参考几何）`);
        return;
      }
      const { canonical } = formulaTo3D(s); // 预校验（非法即抛错，不入库）
      const id = sceneStore.getState().addComponent('molecule', {
        name: canonical,
        params: { formula: canonical, kind: 'H₂O' },
      });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      setSmiles('');
      setSmilesMsg(`已导入化学式 ${canonical}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导入失败';
      setSmilesMsg(`✕ 无法识别为 SMILES 或化学式（${msg}）`);
    }
  };

  return (
    <aside className="panel left">
      <SidebarTabs
        tabs={[
          { value: 'assets', label: '素材' },
          { value: 'templates', label: '模板' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'assets' && (
        <>
          <input
            value={libQuery}
            onChange={(e) => setLibQuery(e.target.value)}
            placeholder="搜索分子、晶体、化学式或素材…"
            style={{ width: '100%', marginBottom: 8 }}
          />
          {libQuery.trim() ? (
            <AssetSearchResults
              query={libQuery}
              onAdd={(r) => {
                // Direct Add（2026-09-22e 修复）：统一走 createAssetComponent 工厂
                // ——搜索/Browse 共一入口；失败明确报错不静默
                try {
                  const spec = createAssetComponent(r.id);
                  if (!spec) throw new Error(`未知资产：${r.id}`);
                  const id = sceneStore.getState().addComponent(spec.componentType, {
                    name: spec.name,
                    params: spec.params as never,
                  });
                  sceneStore.getState().select(id);
                  rendererRef.current?.frameComponent(id);
                } catch (err) {
                  alert(`无法添加该素材：${(err as Error).message}`);
                }
              }}
            />
          ) : (
          <div>
            {filterLib(LIB, '').map((item) => (
              <div
                key={item.type}
                className="lib-card"
                onClick={() => add(item.type)}
                title={item.desc}
              >
                <div className="t">
                  <span className="ic">{item.icon}</span>
                  {item.name}
                </div>
                <div className="d">{item.en ?? item.desc}</div>
              </div>
            ))}
          </div>
          )}
          <div
            style={{ marginTop: 10 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropMol}
            title="也可将 .mol / .sdf 分子文件拖到这里导入"
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={smiles}
                onChange={(e) => {
                  setSmiles(e.target.value);
                  const m = findMineral(e.target.value);
                  setSmilesMsg(m ? `↳ ${m.zh[0]} · ${m.en} · ${m.formula} —— 回车导入 CIF 结构片层` : '');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMolecule();
                }}
                placeholder="SMILES / 化学式 / 矿物名：CCO、CO、高岭石、蒙脱石"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                className="mini"
                onClick={addMolecule}
                title="支持：SMILES（CCO）/ 化学式（CO、fe2o3）/ 矿物中英文名（高岭石、蒙脱石）—— 矿物走对应 CIF 晶体结构"
              >
                导入
              </button>
              <button
                className="mini"
                onClick={() => fileRef.current?.click()}
                title="导入 .mol / .sdf 分子文件（ChemDraw、Materials Studio 等导出，V2000）——使用文件内精确 3D 构象"
              >
                📁 文件
              </button>
              <input ref={fileRef} type="file" accept=".mol,.sdf,text/plain" onChange={onMolFile} style={{ display: 'none' }} />
            </div>
            {smilesMsg && <p className="hint">{smilesMsg}</p>}
          </div>
          <h3 style={{ marginTop: 16 }}>提示</h3>
          <p className="hint">点击卡片添加组件；点击画布选中；Delete 删除、Esc 取消选中；SMILES / 化学式（如 Si、H2O）输入后回车导入。</p>
        </>
      )}
      {tab === 'templates' && <ModulePanel />}
    </aside>
  );
}
