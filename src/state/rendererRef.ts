/**
 * 渲染服务引用 —— 模块级单例槽位
 * SceneCanvas 挂载时写入、卸载时清空；面板据此调用取景/gizmo/统计等命令式接口。
 * （store→渲染的正向同步走 bindRenderer，这里只承载 UI 的命令式需求。）
 */
import type { RendererService } from '../render/RendererService';

export const rendererRef: { current: RendererService | null } = { current: null };
