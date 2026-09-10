/**
 * 数据模型类型出口 —— T-1.2
 *
 * 全部类型由 zod schema 推导（单一事实源：src/core/schema.ts），
 * 依据 DATA_DICT.md。修改参数先改 schema，类型自动跟随。
 */
import type { z } from 'zod';
import type {
  annotationSchema,
  componentSchema,
  componentTypeEnum,
  moleculeParamsSchema,
  moduleSchema,
  packedLayerParamsSchema,
  paletteSettingSchema,
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

/** 各类型 params（sheet/tube 用 z.input：singleLayers 等带默认值的新增键可选，字面量构造零负担；运行时由 builder 容错） */
export type SheetParams = z.input<typeof sheetParamsSchema>;
export type TubeParams = z.input<typeof tubeParamsSchema>;
export type ParticleParams = z.input<typeof particleParamsSchema>;
export type MoleculeParams = z.input<typeof moleculeParamsSchema>;
export type SubstrateParams = z.input<typeof substrateParamsSchema>;
export type PackedLayerParams = z.input<typeof packedLayerParamsSchema>;

/** 组件判别联合： narrowing by `type` 字段 */
export type SceneComponent = z.infer<typeof componentSchema>;

/** 场景文档 kaolin-scene/v1 */
export type SceneDocument = z.infer<typeof sceneDocumentSchema>;

/** 全局色板设置（T-4.2） */
export type PaletteSetting = z.infer<typeof paletteSettingSchema>;

/** 标注（T-4.4）：比例尺 / 文本标签 */
export type Annotation = z.infer<typeof annotationSchema>;

/** 模块库条目（单组件模块；组合模块 T-3.1 扩展） */
export type ModuleEntry = z.infer<typeof moduleSchema>;

/** 任意类型 params 的并集（ DEFAULT_PARAMS 索引用） */
export type AnyParams = SheetParams | TubeParams | ParticleParams | MoleculeParams | SubstrateParams | PackedLayerParams;
