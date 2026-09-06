/**
 * 预览场景 —— T-1.4 验收用：demo「示例场景」（埃洛石@CeO₂）的参数复刻。
 * 经 componentSchema.parse 校验后即为合法 SceneComponent（schema 单一事实源）。
 * 生产版素材库（T-1.6）就位后，本文件由正式的预设/最近文档机制替代。
 */
import { componentSchema } from '../core/schema';
import type { SceneComponent } from '../core/types';

export type PreviewComponent = SceneComponent & { id: string };

export function createPreviewComponents(): PreviewComponent[] {
  const mk = (raw: Record<string, unknown>): PreviewComponent =>
    componentSchema.parse(raw) as PreviewComponent;

  return [
    mk({
      id: 'p1',
      name: '埃洛石管（双层壁）',
      type: 'halloysite_tube',
      params: { innerR: 14, length: 100, walls: 2, d001: 10, progress: 1, taperDeg: 5, style: '空间填充' },
      transform: { position: [10, -6, 0], rotation: [0, 0, 90], scale: 1 },
      visible: true,
    }),
    mk({
      id: 'p2',
      name: 'CeO₂ 颗粒 A',
      type: 'nanoparticle',
      params: { radius: 9, grains: 170, seed: 11, mode: '簇装' },
      transform: { position: [58, 6, 2], rotation: [0, 0, 0], scale: 1 },
      visible: true,
    }),
    mk({
      id: 'p3',
      name: 'CeO₂ 颗粒 B',
      type: 'nanoparticle',
      params: { radius: 6.5, grains: 110, seed: 4, mode: '簇装' },
      transform: { position: [-32, 14, -6], rotation: [0, 0, 0], scale: 1 },
      visible: true,
    }),
    mk({
      id: 'p4',
      name: 'H₂O ×1',
      type: 'molecule',
      params: { kind: 'H₂O' },
      transform: { position: [-8, 26, 10], rotation: [0, 0, 25], scale: 4 },
      visible: true,
    }),
    mk({
      id: 'p5',
      name: 'O₂ ×1',
      type: 'molecule',
      params: { kind: 'O₂' },
      transform: { position: [22, 30, -8], rotation: [0, 0, 0], scale: 4 },
      visible: true,
    }),
    mk({
      id: 'p6',
      name: 'Ca²⁺ ×1',
      type: 'molecule',
      params: { kind: 'Ca²⁺' },
      transform: { position: [-52, -4, 14], rotation: [0, 0, 0], scale: 3 },
      visible: true,
    }),
  ];
}
