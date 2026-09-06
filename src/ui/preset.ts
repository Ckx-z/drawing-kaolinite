/**
 * 预设场景 —— demo「示例场景」（埃洛石@CeO₂）经 store 正规途径装配（T-1.6）
 * 全部经 addComponent 的 schema 校验，参数与 demo loadPreset 一致。
 */
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';

export function loadPresetScene(): void {
  const s = sceneStore.getState();
  s.clear();
  s.addComponent('halloysite_tube', {
    name: '埃洛石管（双层壁）',
    params: { innerR: 14, length: 100, walls: 2, d001: 10, taperDeg: 5 },
    transform: { position: [10, -6, 0], rotation: [0, 0, 90] },
  });
  s.addComponent('nanoparticle', {
    name: 'CeO₂ 颗粒 A',
    params: { radius: 9, grains: 170, seed: 11 },
    transform: { position: [58, 6, 2] },
  });
  s.addComponent('nanoparticle', {
    name: 'CeO₂ 颗粒 B',
    params: { radius: 6.5, grains: 110, seed: 4 },
    transform: { position: [-32, 14, -6] },
  });
  s.addComponent('molecule', {
    name: 'H₂O ×1',
    transform: { position: [-8, 26, 10], rotation: [0, 0, 25] },
  });
  s.addComponent('molecule', {
    name: 'O₂ ×1',
    transform: { position: [22, 30, -8] },
  });
  s.addComponent('molecule', {
    name: 'Ca²⁺ ×1',
    params: { kind: 'Ca²⁺' },
    transform: { position: [-52, -4, 14], scale: 3 },
  });
  s.select(null);
  rendererRef.current?.frameAll();
}
