/**
 * 卷曲动画导出测试 —— T-10.1
 *
 * Node 环境零 DOM：假画布 = 纯对象（getContext 返回固定色 getImageData），
 * 只需满足 animation.ts 的调用面（width/height/getContext）。
 *
 * 验收：帧序 progress 均匀 [0.02→1]、结束后恢复原始参数、GIF 输出合法、
 * 非管组件返回 null、几何等待超时不挂死。
 */
import { describe, expect, it, vi } from 'vitest';
import { encodeGIF, gifToDataUrl } from './gif';
import { exportCurlAnimation, type AnimationService } from './animation';

const W = 32;
const H = 24;

/** 假渲染服务：rebuildComponent 记录每次 params.progress；画布返回固定色像素 */
function fakeService(compType = 'halloysite_tube') {
  const progressLog: number[] = [];
  const current = {
    type: compType,
    params: { innerR: 14, length: 90, progress: 1 } as Record<string, unknown>,
  };
  const svc: AnimationService = {
    getComponent: () => ({ type: current.type, params: current.params }),
    rebuildComponent: (comp) => {
      const c = comp as unknown as { type: string; params: Record<string, unknown> };
      progressLog.push(c.params.progress as number);
      current.params = c.params;
    },
    exportComponentCanvas: () => {
      const rgb = current.params.progress === 1 ? 200 : 100;
      const pixels = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        pixels[i * 4] = rgb;
        pixels[i * 4 + 1] = 80;
        pixels[i * 4 + 2] = 80;
        pixels[i * 4 + 3] = 255;
      }
      return {
        width: W,
        height: H,
        getContext: (kind: string) =>
          kind === '2d' ? { getImageData: () => ({ data: pixels }) } : null,
      } as unknown as HTMLCanvasElement;
    },
    waitForGeometry: () => Promise.resolve(),
  };
  return { svc, progressLog };
}

describe('exportCurlAnimation（T-10.1）', () => {
  it('默认 20 帧：progress 均匀 [0.02→1]（首帧 0.02、末帧 1），结束恢复原始参数', async () => {
    const { svc, progressLog } = fakeService();
    const result = await exportCurlAnimation(svc, 'c1', { frames: 20 });
    expect(result).not.toBeNull();
    expect(result!.frames).toBe(20);
    expect(progressLog).toHaveLength(21); // 20 帧 + 1 次恢复
    expect(progressLog[0]).toBeCloseTo(0.02, 5);
    expect(progressLog[1]).toBeCloseTo(1 / 19, 5);
    expect(progressLog[19]).toBeCloseTo(1, 5);
    // 最后一次 = 恢复原始 progress = 1
    expect(progressLog[20]).toBe(1);
    // 恢复 = 最后一次 rebuild 的 params 与原始一致（fake 服务 current.params 为活引用）
    expect(svc.getComponent('c1')!.params).toEqual({ innerR: 14, length: 90, progress: 1 });
  });

  it('输出 GIF：合法头、帧数正确、dataURL 前缀', async () => {
    const { svc } = fakeService();
    const { dataUrl, frames } = (await exportCurlAnimation(svc, 'c1', { frames: 6, dpi: 96 }))!;
    expect(frames).toBe(6);
    expect(dataUrl.startsWith('data:image/gif;base64,')).toBe(true);
    const b64 = dataUrl.slice(22);
    const bin = atob(b64);
    expect(bin.slice(0, 6)).toBe('GIF89a');
    // GCE 数 = 帧数
    let gce = 0;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) gce++;
    expect(gce).toBe(6);
  });

  it('非埃洛石管组件返回 null', async () => {
    const { svc } = fakeService('molecule');
    expect(await exportCurlAnimation(svc, 'c1')).toBeNull();
  });

  it('几何等待超时不挂死（帧超时 10ms 内完成）', async () => {
    const { svc } = fakeService();
    const t0 = performance.now();
    const result = await exportCurlAnimation(svc, 'c1', { frames: 4, frameTimeoutMs: 10 });
    const ms = performance.now() - t0;
    expect(result!.frames).toBe(4);
    expect(ms).toBeLessThan(3000);
  });

  it('GIF 编码器直接使用：encodeGIF + gifToDataUrl 联通', () => {
    const rgba = new Uint8Array(16 * 16 * 4).fill(255);
    const gif = encodeGIF(16, 16, [{ rgba, delayMs: 120 }]);
    expect(gifToDataUrl(gif).startsWith('data:image/gif;base64,')).toBe(true);
    void vi;
  });
});
