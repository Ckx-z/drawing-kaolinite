/**
 * 机理图图元数据模型 —— T-11.1（2026-09-10）
 *
 * 图元层（Shape Layer）：画在 3D 场景之上的屏幕空间 2D 图元（方框/椭圆/箭头/
 * 连线/文本），与组件/标注并列随场景 JSON 持久化。坐标空间：叠加形态下图元层
 * 坐标 == 视口逻辑像素（导出时按离屏尺寸换算，与标注同一机制）；纯 2D 形态
 * （T-11.6）由渲染侧 view 变换承担 pan/zoom，数据不变。
 *
 * 设计（与 componentSchema 同款判别联合模式）：
 *  - 统一包围盒 x/y/w/h：rect/ellipse/text 为框；arrow/line 为端点向量
 *    （起点 (x,y) → 终点 (x+w, y+h)，w/h 允许负值=拖拽方向）；
 *  - Z 序 = shapes 数组顺序（置前/置后 = 数组移动，无独立 z 字段）；
 *  - 编组复用组件组模式（group 字符串标记，组内整体移动）；
 *  - 箭头/连线端点 anchors：free（用几何端点）/ shape（吸附图元边缘）/
 *    component（锚定 3D 组件，随视角实时投影跟随）——端点解析见 ui/shapes/draw.ts。
 */
import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** fill 允许 'none'（透明，只有描边的框/圈） */
const fillStyle = z.union([hexColor, z.literal('none')]);

/** 连线/箭头端点锚定（T-11.3）：kind=free 时端点取几何坐标 */
export const anchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('free') }),
  /** 吸附图元边缘（side 缺省 = 最近边） */
  z.strictObject({ kind: z.literal('shape'), id: z.string().min(1), side: z.enum(['left', 'right', 'top', 'bottom']).optional() }),
  /** 锚定 3D 组件（包围盒中心投影，随视角跟随；被裁剪时端点夹到视口边缘） */
  z.strictObject({ kind: z.literal('component'), id: z.string().min(1) }),
]);
export type ShapeAnchor = z.infer<typeof anchorSchema>;

const shapeCommon = {
  id: z.string().min(1),
  /** 包围盒：rect/ellipse/text 为框；arrow/line 为端点向量（允许负值） */
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  /** 旋转（度，绕包围盒中心；arrow/line 忽略） */
  rotation: z.number().min(-360).max(360).default(0),
  stroke: hexColor.default('#2b2f33'),
  fill: fillStyle.default('none'),
  lineWidth: z.number().min(0.5).max(12).default(2),
  dash: z.enum(['solid', 'dashed']).default('solid'),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  /** 编组标记（同组图元整体移动；复用组件组语义） */
  group: z.string().optional(),
};

/** 双端锚定（arrow/line 专有；缺省 = 两端 free） */
const anchorsSchema = z
  .strictObject({
    start: anchorSchema.default({ kind: 'free' }),
    end: anchorSchema.default({ kind: 'free' }),
  })
  .default({ start: { kind: 'free' }, end: { kind: 'free' } });
export type ShapeAnchors = z.infer<typeof anchorsSchema>;

export const rectShapeSchema = z.strictObject({ type: z.literal('rect'), ...shapeCommon });
export const ellipseShapeSchema = z.strictObject({ type: z.literal('ellipse'), ...shapeCommon });
export const textShapeSchema = z.strictObject({
  type: z.literal('text'),
  ...shapeCommon,
  text: z.string().min(1).max(500),
  fontSize: z.number().min(8).max(72).default(14),
  color: hexColor.default('#1a1d21'),
  /** 多行以 \n 分隔 */
  align: z.enum(['left', 'center']).default('left'),
  /** 描边（白底提升 3D 场景上的可读性，与标注同款） */
  outline: z.boolean().default(true),
});
export const arrowShapeSchema = z.strictObject({
  type: z.literal('arrow'),
  ...shapeCommon,
  anchors: anchorsSchema,
  /** 箭头头部尺寸（px） */
  headSize: z.number().min(4).max(24).default(10),
  /** 弓高（px，2026-09-12 弧线箭头）：0 = 直线；正/负 = 沿弦法向两侧弯曲（电子转移弧线示意） */
  bow: z.number().min(-200).max(200).default(0),
  /** 箭头位置：end = 终点单头（默认）；both = 双端（可逆反应）；none = 仅线 */
  heads: z.enum(['end', 'both', 'none']).default('end'),
});
export const lineShapeSchema = z.strictObject({
  type: z.literal('line'),
  ...shapeCommon,
  anchors: anchorsSchema,
});

export const shapeSchema = z.discriminatedUnion('type', [
  rectShapeSchema,
  ellipseShapeSchema,
  textShapeSchema,
  arrowShapeSchema,
  lineShapeSchema,
]);

export type SceneShape = z.infer<typeof shapeSchema>;
export type RectShape = z.infer<typeof rectShapeSchema>;
export type EllipseShape = z.infer<typeof ellipseShapeSchema>;
export type TextShape = z.infer<typeof textShapeSchema>;
export type ArrowShape = z.infer<typeof arrowShapeSchema>;
export type LineShape = z.infer<typeof lineShapeSchema>;
export type ShapeType = SceneShape['type'];

/** 工具状态（画布事件分流状态机；'select' 时图元命中优先、空白透传 3D 拾取） */
export const SHAPE_TOOLS = ['select', 'rect', 'ellipse', 'arrow', 'line', 'text'] as const;
export type ShapeTool = (typeof SHAPE_TOOLS)[number];

/** 新图元默认值（addShape 与 DEFAULT_PARAMS 同职责；x/y/w/h 由调用方给） */
export const SHAPE_DEFAULTS = {
  rect: { type: 'rect' as const, w: 160, h: 90, stroke: '#2b2f33', fill: 'none' as const, lineWidth: 2, dash: 'solid' as const },
  ellipse: { type: 'ellipse' as const, w: 120, h: 120, stroke: '#2b2f33', fill: 'none' as const, lineWidth: 2, dash: 'solid' as const },
  arrow: { type: 'arrow' as const, w: 140, h: 0, stroke: '#2b2f33', fill: 'none' as const, lineWidth: 2, dash: 'solid' as const, headSize: 10 },
  line: { type: 'line' as const, w: 140, h: 0, stroke: '#2b2f33', fill: 'none' as const, lineWidth: 2, dash: 'solid' as const },
  text: { type: 'text' as const, w: 140, h: 24, text: '文本', fontSize: 14, color: '#1a1d21', align: 'left' as const, outline: true },
};
