/**
 * 素材库面板 —— T-1.6/T-2.3
 * 上：素材库（点击添加组件并取景）；下：我的模块（IndexedDB 持久化，点击复用）。
 */
import { useStore } from 'zustand';
import type { ComponentType } from '../core/types';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import ModulePanel from './ModulePanel';
import { LIB } from './paramDefs';

export default function LibraryPanel() {
  useStore(sceneStore, () => null); // 订阅以随 store 更新（当前卡片为静态列表）

  const add = (type: ComponentType): void => {
    const id = sceneStore.getState().addComponent(type);
    sceneStore.getState().select(id); // demo 行为：添加后自动选中，参数面板立即可调
    rendererRef.current?.frameComponent(id);
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
      <ModulePanel />
      <h3 style={{ marginTop: 16 }}>提示</h3>
      <p className="hint">点击卡片添加组件；点击画布选中；Delete 删除、Esc 取消选中。</p>
    </aside>
  );
}
