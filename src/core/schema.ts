/**
 * 数据模型 zod Schema —— T-1.2
 *
 * 唯一依据：DATA_DICT.md（参数范围/默认值与其逐条对应）。
 * 覆盖：五类组件 params、transform、kaolin-scene/v1 场景文档、模块库条目。
 *
 * 兼容性约定（对齐 demo/index.html 的序列化行为）：
 * - demo 保存的组件【没有 id / locked 字段】→ 两者 optional，载入后由 normalizeScene 补齐；
 * - transform.scale 下限 0.05（demo applyTransform 同款钳制）；molecule 默认整体缩放 4；
 * - 全部对象用 strictObject：未知字段（拼写错误）当场拒绝，科研数据正确性优先。
 */
import { z } from 'zod';
import { shapeSchema } from './shapes/schema';

/* ---------- 通用 ---------- */

export const COMPONENT_TYPES = [
  'kaolinite_sheet',
  'halloysite_tube',
  'nanoparticle',
  'molecule',
  'rubber_substrate',
] as const;

export const componentTypeEnum = z.enum(COMPONENT_TYPES);

export const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const transformSchema = z.strictObject({
  position: vec3,
  rotation: vec3,
  scale: z.number().min(0.05).max(100),
});

/** 渲染风格（片层/管共用，molecule 固定球棍不暴露此参数） */
const renderStyle = z.enum(['空间填充', '球棍']);

/**
 * 单原子模式（2026-09-08）：忽略化学组成，全部原子显示为同一种元素球
 * （机理图简化示意画法——"由重复的单一原子堆叠成结构"）。默认 full 完整结构。
 * singleEl 仅在 single 模式下有意义；随场景 JSON 持久化（每实例独立）。
 */
const atomMode = z.enum(['full', 'single']).default('full');
const singleElOf = (fallback: string) =>
  z
    .string()
    .refine((s) => /^[A-Z][a-z]?$/.test(s), '元素符号格式（首大写可选次小写）')
    .default(fallback);

/* ---------- 各类型 params（范围 = DATA_DICT §二~六 = demo PARAM_DEFS） ---------- */

export const sheetParamsSchema = z.strictObject({
  Lx: z.number().min(20).max(150),
  Ly: z.number().min(20).max(150),
  layers: z.number().int().min(1).max(3),
  d001: z.number().min(7.2).max(12),
  shape: z.enum(['矩形', '六角']),
  style: renderStyle,
  edgeH: z.boolean(),
  // T-2.7：晶学严格模式（保留 β/γ 夹角的真实三斜投影）；默认示意正交化（D03）
  strictCell: z.boolean().default(false),
  // 单原子模式（2026-09-08）：全部原子统一为 singleEl（简化示意）
  atomMode,
  singleEl: singleElOf('Si'),
  // D05 预留：showInterlayer（T-2.4 多矿物接入时启用，当前类型不暴露）
});

export const tubeParamsSchema = z.strictObject({
  innerR: z.number().min(8).max(40),
  length: z.number().min(30).max(200),
  walls: z.number().int().min(1).max(3),
  d001: z.number().min(7.4).max(11),
  progress: z.number().min(0.02).max(1),
  taperDeg: z.number().min(-20).max(20),
  style: renderStyle,
  // T-2.6：卷曲方向（'a' 基线 / 'b' 真实轴向美感）与端口噪声幅度（0 = 关）
  curlAxis: z.enum(['a', 'b']).default('a'),
  portNoise: z.number().min(0).max(2).default(0),
  // 单原子模式（2026-09-08）
  atomMode,
  singleEl: singleElOf('Si'),
});

export const particleParamsSchema = z.strictObject({
  radius: z.number().min(4).max(20),
  grains: z.number().int().min(40).max(400),
  seed: z.number().int().min(1).max(99),
  mode: z.enum(['簇装', '光滑']),
  // 单原子模式（2026-09-08）：CeO₂ 团簇 → 单一元素团簇
  atomMode,
  singleEl: singleElOf('Ce'),
});

export const MOLECULE_KINDS = [
  'H₂O',
  'O₂',
  'CO₂',
  'N₂',
  'Ca²⁺',
  'Ce³⁺',
  '·OH (羟基自由基)',
] as const;

export const moleculeParamsSchema = z.strictObject({
  kind: z.enum(MOLECULE_KINDS),
  // T-2.8：SMILES 导入的分子（kind 保留为回退显示）；几何 = smilesTo3D(smiles) 确定性重建
  smiles: z.string().min(1).optional(),
  // 2026-09-08：化学式导入（大小写不敏感，规范化串如 Fe2O3）；几何 = formulaTo3D 紧密团簇
  formula: z.string().min(1).max(64).optional(),
});

export const substrateParamsSchema = z.strictObject({
  Lx: z.number().min(40).max(240),
  Ly: z.number().min(30).max(200),
  thickness: z.number().min(2).max(20),
});

/* ---------- 组件（type 判别联合） ---------- */

const componentCommon = {
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  transform: transformSchema,
  visible: z.boolean().default(true),
  locked: z.boolean().optional(),
  // T-3.3：分组标记（同 groupId 的成员整体变换）；缺省 = 独立组件，向后兼容
  group: z.string().optional(),
};

export const sheetComponentSchema = z.strictObject({
  type: z.literal('kaolinite_sheet'),
  params: sheetParamsSchema,
  ...componentCommon,
});

export const tubeComponentSchema = z.strictObject({
  type: z.literal('halloysite_tube'),
  params: tubeParamsSchema,
  ...componentCommon,
});

export const particleComponentSchema = z.strictObject({
  type: z.literal('nanoparticle'),
  params: particleParamsSchema,
  ...componentCommon,
});

export const moleculeComponentSchema = z.strictObject({
  type: z.literal('molecule'),
  params: moleculeParamsSchema,
  ...componentCommon,
});

export const substrateComponentSchema = z.strictObject({
  type: z.literal('rubber_substrate'),
  params: substrateParamsSchema,
  ...componentCommon,
});

export const componentSchema = z.discriminatedUnion('type', [
  sheetComponentSchema,
  tubeComponentSchema,
  particleComponentSchema,
  moleculeComponentSchema,
  substrateComponentSchema,
]);

/* ---------- 场景文档 kaolin-scene/v1 ---------- */

export const SCENE_FORMAT = 'kaolin-scene/v1' as const;

/** 全局色板设置（T-4.2）：id 指向预设色板，overrides 逐元素覆盖（#RRGGBB） */
export const paletteSettingSchema = z.strictObject({
  id: z.string().optional(),
  overrides: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
});

/** 标注层（T-4.4）：比例尺 / 文本标签（引线锚定世界坐标）；屏幕空间字号恒定 */
export const annotationSchema = z.strictObject({
  type: z.enum(['scalebar', 'label']),
  /** label：文本内容（如 "d₀₀₁ = 1.0 nm"） */
  text: z.string().optional(),
  /** scalebar：刻度长度（Å）；label：锚定的世界坐标 */
  worldLen: z.number().positive().optional(),
  target: z.tuple([z.number(), z.number(), z.number()]).optional(),
  /** label：文本相对锚点的屏幕偏移（px） */
  offset: z.tuple([z.number(), z.number()]).optional(),
  visible: z.boolean().default(true),
});

export const sceneDocumentSchema = z.strictObject({
  format: z.literal(SCENE_FORMAT),
  saved: z.iso.datetime(),
  components: z.array(componentSchema),
  // T-4.2：旧场景文件无此字段 → 缺省合法（向后兼容）
  palette: paletteSettingSchema.optional(),
  // T-4.4：标注层（旧场景缺省合法）
  annotations: z.array(annotationSchema).optional(),
  // T-11.1：机理图图元层（旧场景缺省合法）
  shapes: z.array(shapeSchema).optional(),
});

/* ---------- 模块库条目（单组件模块 + 组合模块 T-3.1） ---------- */

const moduleCommon = {
  id: z.string().min(1),
  name: z.string().min(1),
  transform: transformSchema,
  thumb: z.string().startsWith('data:image/'),
  // T-3.2：检索/分类/版本字段（旧条目缺省均合法 → 向后兼容）
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  moduleVersion: z.number().optional(),
  favorite: z.boolean().optional(),
};

/** 组合模块：一次保存多个组件（含各自变换），实例化时整体复现相对位置 */
export const combinedModuleSchema = z.strictObject({
  type: z.literal('combined'),
  id: z.string().min(1),
  name: z.string().min(1),
  components: z.array(componentSchema).min(1),
  thumb: z.string().startsWith('data:image/'),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  moduleVersion: z.number().optional(),
  favorite: z.boolean().optional(),
});

export const moduleSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('kaolinite_sheet'), params: sheetParamsSchema, ...moduleCommon }),
  z.strictObject({ type: z.literal('halloysite_tube'), params: tubeParamsSchema, ...moduleCommon }),
  z.strictObject({ type: z.literal('nanoparticle'), params: particleParamsSchema, ...moduleCommon }),
  z.strictObject({ type: z.literal('molecule'), params: moleculeParamsSchema, ...moduleCommon }),
  z.strictObject({
    type: z.literal('rubber_substrate'),
    params: substrateParamsSchema,
    ...moduleCommon,
  }),
  combinedModuleSchema,
]);

/* ---------- 默认值（与 DATA_DICT / demo DEFAULTS 一致） ---------- */

export const DEFAULT_PARAMS = {
  kaolinite_sheet: {
    Lx: 70,
    Ly: 60,
    layers: 1,
    d001: 7.4,
    shape: '矩形',
    style: '空间填充',
    edgeH: false,
    strictCell: false,
    atomMode: 'full',
    singleEl: 'Si',
  },
  halloysite_tube: {
    innerR: 14,
    length: 90,
    walls: 1,
    d001: 7.4,
    progress: 1,
    taperDeg: 0,
    style: '空间填充',
    curlAxis: 'a' as const,
    portNoise: 0,
    atomMode: 'full',
    singleEl: 'Si',
  },
  nanoparticle: { radius: 9, grains: 160, seed: 7, mode: '簇装', atomMode: 'full', singleEl: 'Ce' },
  molecule: { kind: 'H₂O' },
  rubber_substrate: { Lx: 140, Ly: 90, thickness: 5 },
} as const;

/** molecule 默认整体缩放 4（太小看不清），其余 1（demo DEFAULT_SCALE） */
export function defaultTransformFor(type: (typeof COMPONENT_TYPES)[number]) {
  return {
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: type === 'molecule' ? 4 : 1,
  };
}

/* ---------- 序列化 / 反序列化 ---------- */

/** 校验失败异常：message 按行列出 `字段路径: 原因`，可直接展示给用户 */
export class SceneValidationError extends Error {
  constructor(
    public readonly kind: 'scene' | 'module',
    public readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(
      `${kind === 'scene' ? '场景' : '模块'}校验失败（${issues.length} 处）：\n` +
        issues.map((i) => `  ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'SceneValidationError';
  }
}

function toIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.join('.') || '(根)', message: i.message }));
}

export function serializeScene(doc: z.infer<typeof sceneDocumentSchema>): string {
  return JSON.stringify(doc, null, 2);
}

/** 解析并校验场景文本；不修改内容（补默认值由 zod default 完成，如 visible） */
export function deserializeScene(text: string): z.infer<typeof sceneDocumentSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SceneValidationError('scene', [
      { path: '(根)', message: `JSON 语法错误：${(e as Error).message}` },
    ]);
  }
  const res = sceneDocumentSchema.safeParse(raw);
  if (!res.success) throw new SceneValidationError('scene', toIssues(res.error));
  return res.data;
}

/** 解析并校验模块条目（localStorage / IndexedDB 中的 JSON 对象或文本均可） */
export function deserializeModule(entry: unknown | string): z.infer<typeof moduleSchema> {
  const raw = typeof entry === 'string' ? (JSON.parse(entry) as unknown) : entry;
  const res = moduleSchema.safeParse(raw);
  if (!res.success) throw new SceneValidationError('module', toIssues(res.error));
  return res.data;
}

/* ---------- 规范化（应用层载入时调用） ---------- */

let normalizeSeq = 0;

/**
 * 为缺失 id 的组件补唯一 id（demo 保存文件无 id），并确保 visible/locked 完整。
 * 不改动 params/transform（已由 schema 保证合法）。
 */
export function normalizeScene(doc: z.infer<typeof sceneDocumentSchema>): z.infer<
  typeof sceneDocumentSchema
> {
  return {
    ...doc,
    components: doc.components.map((c) => ({
      ...c,
      id: c.id ?? `c${Date.now().toString(36)}-${normalizeSeq++}`,
      locked: c.locked ?? false,
    })),
  };
}
