/**
 * 数据模型类型出口 —— T-1.2
 *
 * 全部类型由 zod schema 推导（单一事实源：src/core/schema.ts），
 * 依据 DATA_DICT.md。修改参数先改 schema，类型自动跟随。
 */
import type { z } from 'zod';
import type {
  componentSchema,
  componentTypeEnum,
  moleculeParamsSchema,
  moduleSchema,
  particleParamsSchema,
  sceneDocumentSchema,
  sheetParamsSchema,
  substrateParamsSchema,
  transformSchema,
  tubeParamsSchema,
} from './schema';

export type ComponentType = z.infer<typeof componentTypeEnum>;

/** 三元数组（position / rotation 复用） */
export type Vec3 = z.infer<typeof transformSchema>['position'];

export type Transform = z.infer<typeof transformSchema>;

/** 各类型 params */
export type SheetParams = z.infer<typeof sheetParamsSchema>;
export type TubeParams = z.infer<typeof tubeParamsSchema>;
export type ParticleParams = z.infer<typeof particleParamsSchema>;
export type MoleculeParams = z.infer<typeof moleculeParamsSchema>;
export type SubstrateParams = z.infer<typeof substrateParamsSchema>;

/** 组件判别联合： narrowing by `type` 字段 */
export type SceneComponent = z.infer<typeof componentSchema>;

/** 场景文档 kaolin-scene/v1 */
export type SceneDocument = z.infer<typeof sceneDocumentSchema>;

/** 模块库条目（单组件模块；组合模块 T-3.1 扩展） */
export type ModuleEntry = z.infer<typeof moduleSchema>;

/** 任意类型 params 的并集（ DEFAULT_PARAMS 索引用） */
export type AnyParams = SheetParams | TubeParams | ParticleParams | MoleculeParams | SubstrateParams;
