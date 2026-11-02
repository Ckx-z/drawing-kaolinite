/**
 * 共享导入入口（UI 重构 2026-10-22）：顶栏「导入」按钮与模型面板 SMILES 行共用，
 * 逻辑自 TopBar/LibraryPanel 原实现上移（行为逐位保留，不新增格式）。
 */
import { parseSdfOrMol } from '../core/molecules/mol';
import { clearAdsorption } from '../state/adsorptionStore';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

export type Flash = (msg: string) => void;

/** 场景文件（.kaolin-scene.json）：载入即完整替换，含视角快照回退取景（原 TopBar.onFile） */
export function readSceneFile(file: File, flash: Flash): void {
  const reader = new FileReader();
  reader.onload = (): void => {
    try {
      clearAdsorption(); // 场景文件载入清旧预览
      const restored = sceneStore.getState().loadScene(String(reader.result));
      if (!restored) rendererRef.current?.frameAll(); // 旧场景无视角快照 → 回退取景
      flash('场景已载入，所有参数均可继续修改');
    } catch (err) {
      alert(`场景文件解析失败：${(err as Error).message}`);
    }
  };
  reader.readAsText(file);
}

/** MOL/SDF 分子文件（ChemDraw/Materials Studio 导出，V2000 构象）：预校验失败不入库（原 LibraryPanel.importMolText） */
export function readMolFile(file: File, flash: Flash): void {
  const fallbackName = file.name.replace(/\.(mol|sdf)$/i, '');
  void file.text().then((text) => {
    try {
      const m = parseSdfOrMol(text); // 预校验（非法即抛错，不入库）
      const name = m.name || fallbackName;
      const id = sceneStore.getState().addComponent('molecule', {
        name,
        params: { mol: text, kind: 'H₂O' },
      });
      sceneStore.getState().select(id);
      rendererRef.current?.frameComponent(id);
      flash(`已导入 ${name}（${m.atoms.length} 原子 · MOL 构象）`);
    } catch (err) {
      flash(`✕ MOL/SDF 解析失败：${err instanceof Error ? err.message : '解析失败'}`);
    }
  });
}

/** 按扩展名路由（顶栏「导入」统一入口）：.mol/.sdf → 分子，其余 → 场景文件 */
export function importByExtension(file: File, flash: Flash): void {
  if (/\.(mol|sdf)$/i.test(file.name)) readMolFile(file, flash);
  else readSceneFile(file, flash);
}
