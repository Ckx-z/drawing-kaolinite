/**
 * 卷曲动画导出 —— T-10.1
 *
 * 编排：对选中埃洛石管按 progress 0→1 均匀取 N 帧 → 逐帧重建几何（引擎路径，
 * 经缓存层——重复导出同参数零重建）→ 隔离离屏渲染 → GIF 编码（内置 GIF89a）。
 * 动画临时改动不进撤销栈（直接走渲染服务而非 store）；结束后恢复原始参数。
 */
import { encodeGIF, gifToDataUrl, type GifFrame } from './gif';

export interface AnimationService {
  getComponent(id: string): {
    type: string;
    params: Record<string, unknown>;
  } | null;
  rebuildComponent(comp: never): void;
  exportComponentCanvas(
    id: string,
    opts: { dpi: number; widthCM?: number; annotations?: never[] },
  ): HTMLCanvasElement | null;
  waitForGeometry(id: string, timeoutMs?: number): Promise<void>;
}

export interface AnimationOptions {
  /** 帧数（含首尾），默认 20 */
  frames?: number;
  /** 目标 dpi（96 预览足够动画；300 亦可，文件大） */
  dpi?: number;
  /** 单帧几何等待上限（ms），默认 8000 */
  frameTimeoutMs?: number;
  /** 进度回调（0~1） */
  onProgress?: (p: number) => void;
}

const ANIM_PROGRESS_MIN = 0.02;

/**
 * 导出卷曲动画 GIF dataURL。返回 null = 组件不是埃洛石管。
 * 帧间 progress 均匀分布 [0.02, 1]（与参数面板滑块范围一致）。
 */
export async function exportCurlAnimation(
  svc: AnimationService,
  componentId: string,
  opts: AnimationOptions = {},
): Promise<{ dataUrl: string; frames: number } | null> {
  const comp = svc.getComponent(componentId);
  if (!comp || comp.type !== 'halloysite_tube') return null;

  const frameCount = Math.max(2, opts.frames ?? 20);
  const dpi = opts.dpi ?? 96;
  const original = structuredClone(comp.params) as Record<string, unknown>;
  const canvases: HTMLCanvasElement[] = [];

  try {
    for (let i = 0; i < frameCount; i++) {
      const progress = i === 0 ? ANIM_PROGRESS_MIN : i / (frameCount - 1);
      const next = {
        ...comp,
        params: { ...comp.params, progress },
      } as never;
      svc.rebuildComponent(next);
      await svc.waitForGeometry(componentId, opts.frameTimeoutMs);
      const canvas = svc.exportComponentCanvas(componentId, { dpi });
      if (!canvas) return null;
      canvases.push(canvas);
      opts.onProgress?.((i + 1) / frameCount);
    }
  } finally {
    // 恢复原始参数（重建一次；不产生动画帧的副作用）
    svc.rebuildComponent({ ...comp, params: original } as never);
    await svc.waitForGeometry(componentId, opts.frameTimeoutMs);
  }

  // GIF 编码：画布 → RGBA → 帧
  const w = canvases[0].width;
  const h = canvases[0].height;
  const gifFrames: GifFrame[] = canvases.map((cv) => {
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('动画帧画布无 2D 上下文');
    return { rgba: new Uint8Array(ctx.getImageData(0, 0, w, h).data), delayMs: 120 };
  });
  const gif = encodeGIF(w, h, gifFrames);
  return { dataUrl: gifToDataUrl(gif), frames: gifFrames.length };
}
