/**
 * TIFF 导出编码器 —— T-5.1（期刊 300dpi+ 硬要求）
 *
 * 实现说明：方案原文拟用 UTIF.encodeImage，但其不写入 XResolution/YResolution
 * 物理分辨率标签（验收硬性要求"正确物理尺寸与 300dpi 元数据"），故改为内置
 * 无压缩 RGBA TIFF 编码器：约 80 行、零依赖、Node 可单测，完整控制标签集：
 *   - 282/283 XResolution/YResolution = dpi（RATIONAL）+ 296 ResolutionUnit=inch
 *     → Photoshop/GIMP 打开即为设定物理尺寸；
 *   - 277 SamplesPerPixel=4 + 338 ExtraSamples=2（unassociated alpha）→ 透明底；
 *   - 259 Compression=1（无压缩）：16cm@300dpi 约 10.6MB，期刊投稿无碍；
 * 降级：resolveExportSize 按设备 WebGL maxTextureSize 钳制最大边（验收"600dpi
 * 不超上限，自动降级提示"），返回 degraded 标志与有效 dpi 供 UI 提示。
 */

export interface ExportSizePlan {
  w: number;
  h: number;
  /** true = 请求分辨率超设备上限，已按比例降级 */
  degraded: boolean;
  /** 实际生效 dpi（降级时小于请求值） */
  effectiveDpi: number;
}

/**
 * 导出尺寸解析（纯函数）：px = cm × dpi / 2.54，比例锁定当前画布视口；
 * 最大边超过 maxTextureSize 时按比例降级到上限。
 */
export function resolveExportSize(
  dpi: number,
  widthCM: number,
  viewW: number,
  viewH: number,
  maxTextureSize: number,
): ExportSizePlan {
  const w0 = Math.round((widthCM * dpi) / 2.54);
  const h0 = Math.round((w0 * viewH) / Math.max(1, viewW));
  const maxEdge = Math.max(w0, h0);
  if (maxEdge <= maxTextureSize) return { w: w0, h: h0, degraded: false, effectiveDpi: dpi };
  const scale = maxTextureSize / maxEdge;
  return {
    w: Math.max(1, Math.floor(w0 * scale)),
    h: Math.max(1, Math.floor(h0 * scale)),
    degraded: true,
    effectiveDpi: Math.round(dpi * scale),
  };
}

/* ---------- TIFF 二进制编码 ---------- */

const TIFF_TAGS = {
  ImageWidth: 256,
  ImageHeight: 257,
  BitsPerSample: 258,
  Compression: 259,
  Photometric: 262,
  StripOffsets: 273,
  SamplesPerPixel: 277,
  RowsPerStrip: 278,
  StripByteCounts: 279,
  XResolution: 282,
  YResolution: 283,
  ResolutionUnit: 296,
  ExtraSamples: 338,
} as const;

// 类型码
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

/** 编码 RGBA 像素为无压缩 TIFF（dpi 写入物理分辨率标签；alpha 为 unassociated） */
export function encodeTIFF(rgba: Uint8Array, w: number, h: number, dpi: number): ArrayBuffer {
  if (rgba.length !== w * h * 4) {
    throw new Error(`像素数据长度不匹配：期望 ${w * h * 4}，实际 ${rgba.length}`);
  }
  const entryCount = 13;
  const ifdOffset = 8;
  const ifdSize = 2 + entryCount * 12 + 4;
  const heapOffset = ifdOffset + ifdSize; // 超出 4 字节的值区（BitsPerSample/XRes/YRes）
  const bitsOffset = heapOffset; // 4 × SHORT = 8 字节
  const xResOffset = bitsOffset + 8;
  const yResOffset = xResOffset + 8;
  const dataOffset = yResOffset + 8;
  const total = dataOffset + rgba.length;

  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);

  // 文件头：II（小端）+ 42 + IFD 偏移
  v.setUint8(0, 0x49);
  v.setUint8(1, 0x49);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifdOffset, true);

  // 值区
  for (let i = 0; i < 4; i++) v.setUint16(bitsOffset + i * 2, 8, true); // RGBA 各 8bit
  v.setUint32(xResOffset, Math.round(dpi), true);
  v.setUint32(xResOffset + 4, 1, true); // dpi / 1
  v.setUint32(yResOffset, Math.round(dpi), true);
  v.setUint32(yResOffset + 4, 1, true);

  // IFD：条目按 tag 升序
  const entries: Array<{ tag: number; type: number; count: number; value: number }> = [
    { tag: TIFF_TAGS.ImageWidth, type: TYPE_LONG, count: 1, value: w },
    { tag: TIFF_TAGS.ImageHeight, type: TYPE_LONG, count: 1, value: h },
    { tag: TIFF_TAGS.BitsPerSample, type: TYPE_SHORT, count: 4, value: bitsOffset },
    { tag: TIFF_TAGS.Compression, type: TYPE_SHORT, count: 1, value: 1 }, // 无压缩
    { tag: TIFF_TAGS.Photometric, type: TYPE_SHORT, count: 1, value: 2 }, // RGB
    { tag: TIFF_TAGS.StripOffsets, type: TYPE_LONG, count: 1, value: dataOffset },
    { tag: TIFF_TAGS.SamplesPerPixel, type: TYPE_SHORT, count: 1, value: 4 },
    { tag: TIFF_TAGS.RowsPerStrip, type: TYPE_LONG, count: 1, value: h }, // 单条带
    { tag: TIFF_TAGS.StripByteCounts, type: TYPE_LONG, count: 1, value: rgba.length },
    { tag: TIFF_TAGS.XResolution, type: TYPE_RATIONAL, count: 1, value: xResOffset },
    { tag: TIFF_TAGS.YResolution, type: TYPE_RATIONAL, count: 1, value: yResOffset },
    { tag: TIFF_TAGS.ResolutionUnit, type: TYPE_SHORT, count: 1, value: 2 }, // 英寸
    { tag: TIFF_TAGS.ExtraSamples, type: TYPE_SHORT, count: 1, value: 2 }, // unassociated alpha
  ];
  entries.sort((a, b) => a.tag - b.tag);
  v.setUint16(ifdOffset, entryCount, true);
  entries.forEach((e, i) => {
    const p = ifdOffset + 2 + i * 12;
    v.setUint16(p, e.tag, true);
    v.setUint16(p + 2, e.type, true);
    v.setUint32(p + 4, e.count, true);
    if (e.type === TYPE_SHORT && e.count === 1) {
      v.setUint16(p + 8, e.value, true);
      v.setUint16(p + 10, 0, true);
    } else {
      v.setUint32(p + 8, e.value, true);
    }
  });
  v.setUint32(ifdOffset + 2 + entryCount * 12, 0, true); // 无后续 IFD

  // 像素数据（RGBA，top-down 与输入一致）
  new Uint8Array(buf, dataOffset).set(rgba);
  return buf;
}
