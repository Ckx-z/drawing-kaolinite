import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { sceneStore } from './state/sceneStore';
import { rendererRef } from './state/rendererRef';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// T-6.1 桌面端（Tauri）：双击 .kaolin-scene.json → Rust 读取内容 → 此处载入场景。
// 浏览器（npm run dev）无 Tauri 上下文，自动跳过。
if ('__TAURI_INTERNALS__' in window) {
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<string>('scene-open-content', (e) => {
      try {
        sceneStore.getState().loadScene(e.payload);
        rendererRef.current?.frameAll();
      } catch (err) {
        alert(`场景文件解析失败：${(err as Error).message}`);
      }
    }),
  );
}
