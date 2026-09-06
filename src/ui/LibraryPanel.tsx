/**
 * 素材库面板 —— T-1.6
 * 点击添加组件（store.addComponent，schema 拦截非法初值）并取景新组件。
 */
import { useStore } from 'zustand';
import type { ComponentType } from '../core/types';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { LIB } from './paramDefs';

export default function LibraryPanel() {
  useStore(sceneStore, () => null); // 订阅以随 store 更新（当前卡片为静态列表）

  const add = (type: ComponentType): void => {
    const id = sceneStore.getState().addComponent(type);
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
      <h3 style={{ marginTop: 16 }}>提示</h3>
      <p className="hint">
        点击卡片添加组件；点击画布选中；Delete 删除、Esc 取消选中。
        模块库（保存/复用）在阶段 2 接入。
      </p>
    </aside>
  );
}
