/**
 * 素材库面板 —— T-1.6/T-2.3/T-2.8
 * 上：素材库（点击添加组件并取景）+ SMILES 分子导入；下：我的模块（IndexedDB 持久化，点击复用）。
 */
import { useState } from 'react';
import { useStore } from 'zustand';
import { formulaTo3D } from '../core/molecules/formula';
import { smilesTo3D } from '../core/molecules/smiles';
import type { ComponentType } from '../core/types';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import ModulePanel from './ModulePanel';
import { LIB } from './paramDefs';

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
   * 分子导入（T-2.8 SMILES + 2026-09-08 化学式双路）：先按 SMILES 解析
   * （CCO=乙醇），失败自动转化学式（大小写不敏感：si/SI → Si，fe2o3 → Fe2O3），
   * 生成紧密团簇模型。两路都失败才报错。
   */
  const addMolecule = (): void => {
    const s = smiles.trim();
    if (!s) return;
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
            placeholder="SMILES / 化学式：CCO、Si、fe2o3"
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
      <h3 style={{ marginTop: 16 }}>提示</h3>
      <p className="hint">点击卡片添加组件；点击画布选中；Delete 删除、Esc 取消选中；SMILES / 化学式（如 Si、H2O）输入后回车导入。</p>
    </aside>
  );
}
