/**
 * TIFF 导出编码器验收测试 —— T-5.1
 *
 * 验收标准（TODO）：16cm@300dpi 导出的 TIFF 具备正确物理尺寸与 300dpi 元数据；
 * 600dpi 超设备纹理上限时自动降级。
 * 策略：编码结果在 Node 端按 TIFF 6.0 规范逐字段解析回读（II 字节序/IFD/标签/像素）。
 */
import { describe, expect, it } from 'vitest';
import { encodeTIFF, resolveExportSize } from './tiff';

/** 解析 TIFF：返回 IFD 标签映射与像素数据起点 */
function parseTIFF(buf: ArrayBuffer) {
  const v = new DataView(buf);
  expect(v.getUint8(0)).toBe(0x49); // 'I'
  expect(v.getUint8(1)).toBe(0x49);
  expect(v.getUint16(2, true)).toBe(42);
  const ifdOffset = v.getUint32(4, true);

  const count = v.getUint16(ifdOffset, true);
  const tags = new Map<number, { type: number; count: number; value: number }>();
  for (let i = 0; i < count; i++) {
    const p = ifdOffset + 2 + i * 12;
    const tag = v.getUint16(p, true);
    const type = v.getUint16(p + 2, true);
    const cnt = v.getUint32(p + 4, true);
    let value: number;
    if (type === 3 && cnt === 1) value = v.getUint16(p + 8, true);
    else value = v.getUint32(p + 8, true);
    tags.set(tag, { type, count: cnt, value });
  }
  const nextIFD = v.getUint32(ifdOffset + 2 + count * 12, true);
  return { v, tags, count, nextIFD };
}

describe('encodeTIFF：二进制结构（Photoshop/GIMP 可读契约）', () => {
  it('16cm@300dpi 基准：1890×1581px、XResolution=300/1 inch、透明底 ExtraSamples', () => {
    const w = 1890, h = 1581, dpi = 300;
    const rgba = new Uint8Array(w * h * 4);
    rgba[0] = 214; rgba[1] = 69; rgba[2] = 80; rgba[3] = 255; // 首像素 #D64550 不透明
    rgba[(h - 1) * w * 4 + 3] = 0;                            // 末行像素全透明

    const buf = encodeTIFF(rgba, w, h, dpi);
    const { v, tags, count, nextIFD } = parseTIFF(buf);

    expect(count).toBe(13);
    expect(nextIFD).toBe(0);
    expect(tags.get(256)?.value).toBe(w);          // ImageWidth
    expect(tags.get(257)?.value).toBe(h);          // ImageHeight
    expect(tags.get(259)?.value).toBe(1);          // 无压缩
    expect(tags.get(262)?.value).toBe(2);          // RGB
    expect(tags.get(277)?.value).toBe(4);          // RGBA
    expect(tags.get(279)?.value).toBe(w * h * 4);  // StripByteCounts
    expect(tags.get(296)?.value).toBe(2);          // 分辨率单位 = 英寸
    expect(tags.get(338)?.value).toBe(2);          // unassociated alpha（透明底）

    // 物理分辨率：RATIONAL 300/1（通过 offset 回读值区）
    const xOff = tags.get(282)!.value;
    const yOff = tags.get(283)!.value;
    expect(v.getUint32(xOff, true)).toBe(300);
    expect(v.getUint32(xOff + 4, true)).toBe(1);
    expect(v.getUint32(yOff, true)).toBe(300);
    expect(v.getUint32(yOff + 4, true)).toBe(1);

    // 像素数据完整性（经 StripOffsets 回读：首像素 + 末行 alpha）
    const dataOff = tags.get(273)!.value;
    const u8 = new Uint8Array(buf);
    expect(u8[dataOff]).toBe(214);
    expect(u8[dataOff + 1]).toBe(69);
    expect(u8[dataOff + (h - 1) * w * 4 + 3]).toBe(0);
  });

  it('尺寸/长度不匹配拒绝', () => {
    expect(() => encodeTIFF(new Uint8Array(10), 4, 4, 300)).toThrow(/不匹配/);
  });
});

describe('resolveExportSize：分辨率公式与超限降级', () => {
  it('16cm@300dpi → 1890px 宽（分辨率公式基准）', () => {
    const p = resolveExportSize(300, 16, 1280, 720, 16384);
    expect(p.w).toBe(1890);
    expect(p.h).toBe(1063);
    expect(p.degraded).toBe(false);
    expect(p.effectiveDpi).toBe(300);
  });

  it('600dpi 超纹理上限：按比例降级且保持宽高比（验收标准）', () => {
    // 16cm@600dpi → 3780px 宽；设备上限 2048 → scale = 2048/3780
    const p = resolveExportSize(600, 16, 1280, 720, 2048);
    expect(p.degraded).toBe(true);
    expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(2048);
    expect(p.w / p.h).toBeCloseTo(3780 / 2126, 2);
    expect(p.effectiveDpi).toBe(Math.round(600 * (2048 / 3780)));
  });

  it('恰好等于上限不降级', () => {
    const p = resolveExportSize(300, 16, 1280, 720, 1890);
    expect(p.w).toBe(1890);
    expect(p.degraded).toBe(false);
  });
});
