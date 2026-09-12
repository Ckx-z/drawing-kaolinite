/**
 * 素材库面板 —— T-1.6/T-2.3/T-2.8
 * 上：素材库（点击添加组件并取景）+ SMILES 分子导入；下：我的模块（IndexedDB 持久化，点击复用）。
 */
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import seedTemplates from '../../data/seed-templates.json';
import { formulaTo3D, resolveImportPath } from '../core/molecules/formula';
import { smilesTo3D } from '../core/molecules/smiles';
import type { ComponentType } from '../core/types';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { applyTemplate, ensureSeeded, listTemplates, type TemplateEntry } from '../state/templateLibrary';
import ModulePanel from './ModulePanel';
import { LIB } from './paramDefs';

/** T-11.8 机理图模板分区：种子 + 自存模板，点击追加载入（可 Ctrl+Z 撤销） */
function TemplateSection() {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [msg, setMsg] = useState('');
  /** 存/删模板后 bump → 重新拉列表（新卡片立即出现） */
  const templateSeq = useStore(sceneStore, (s) => s.templateSeq);

  useEffect(() => {
    void ensureSeeded(seedTemplates as TemplateEntry[]).then(() =>
      void listTemplates().then((all) => setTemplates(all.filter((t) => t.shapes.length || t.components?.length))),
    );
  }, [templateSeq]);

  if (!templates.length) return null;
  return (
    <>
      <h3 style={{ marginTop: 16 }}>机理图模板</h3>
      <div>
        {templates.map((t) => (
          <div
            key={t.id}
            className="lib-card"
            title="点击载入模板（追加到当前画布，Ctrl+Z 可撤销）；顶栏「存为模板」可把当前场景存成自己的模板"
            onClick={() => {
              applyTemplate(sceneStore, t);
              setMsg(`已载入「${t.name}」（双击文本修改内容）`);
              setTimeout(() => setMsg(''), 2600);
            }}
          >
            <div className="t">
              <span className="ic">{t.builtin ? '🧩' : '⭐'}</span>
              {t.name}
            </div>
            {t.desc && <div className="d">{t.desc}</div>}
          </div>
        ))}
      </div>
      {msg && <p className="hint">{msg}</p>}
    </>
  );
}

export default function LibraryPanel() {
  useStore(sceneStore, () => null); // 订阅以随 store 更新（当前卡片为静态列表）
  const [smiles, setSmiles] = useState('');
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
  const addMolecule = (): void => {
    const s = smiles.trim();
    if (!s) return;
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
      <h3>素材库</h3>
      <div>
        {LIB.map((item) => (
          <div key={item.type} className="lib-card" onClick={() => add(item.type)}>
            <div className="t">
              <span className="ic">{item.icon}</span>
              {item.name}
            </div>
            <div className="d">{item.desc}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={smiles}
            onChange={(e) => {
              setSmiles(e.target.value);
              setSmilesMsg('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMolecule();
            }}
            placeholder="SMILES / 化学式：CCO 乙醇、CO 一氧化碳、fe2o3"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            className="mini"
            onClick={addMolecule}
            title="先按 SMILES 解析（如 CCO 乙醇）；失败自动转化学式（大小写不敏感：si/SI → Si，fe2o3 → Fe2O3）"
          >
            导入
          </button>
        </div>
        {smilesMsg && <p className="hint">{smilesMsg}</p>}
      </div>
      <ModulePanel />
      <TemplateSection />
      <h3 style={{ marginTop: 16 }}>提示</h3>
      <p className="hint">点击卡片添加组件；点击画布选中；Delete 删除、Esc 取消选中；SMILES / 化学式（如 Si、H2O）输入后回车导入。</p>
    </aside>
  );
}
