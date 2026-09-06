/**
 * PDF 导出测试 —— T-5.2
 *
 * 验收：页面物理尺寸 = 设定 cm 数（MediaBox 换算为 pt：1cm = 72/2.54 pt）；
 * 输出为合法 PDF（%PDF 头）；横/竖两个方向宽高不互换。
 */
import { describe, expect, it } from 'vitest';
import { pngToPdf } from './pdf';

// 1×1 红色 PNG（最小合法 dataURL）
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function blobText(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return s;
}

/** 从 PDF 文本中提取 MediaBox 尺寸（pt） */
function mediaBoxOf(text: string): [number, number] {
  const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
  if (!m) throw new Error('MediaBox 未找到');
  return [parseFloat(m[1]), parseFloat(m[2])];
}

describe('pngToPdf（T-5.2）', () => {
  const PT_PER_CM = 72 / 2.54;

  it('输出合法 PDF（%PDF 头）且非空', async () => {
    const blob = pngToPdf(TINY_PNG, 16, 10);
    expect(blob.size).toBeGreaterThan(500);
    const text = await blobText(blob);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('MediaBox');
  });

  it('横版 16×10cm：MediaBox = 453.54 × 283.46 pt（1cm = 72/2.54pt）', async () => {
    const [w, h] = mediaBoxOf(await blobText(pngToPdf(TINY_PNG, 16, 10)));
    expect(w).toBeCloseTo(16 * PT_PER_CM, 1);
    expect(h).toBeCloseTo(10 * PT_PER_CM, 1);
  });

  it('竖版 10×16cm：宽高不互换', async () => {
    const [w, h] = mediaBoxOf(await blobText(pngToPdf(TINY_PNG, 10, 16)));
    expect(w).toBeCloseTo(10 * PT_PER_CM, 1);
    expect(h).toBeCloseTo(16 * PT_PER_CM, 1);
  });
});
