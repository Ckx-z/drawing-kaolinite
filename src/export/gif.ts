/**
 * GIF89a 编码器 —— T-10.1（卷曲动画导出）
 *
 * 零依赖思路与 tiff.ts 一致：内置 GIF89a 编码（LZW 压缩）。
 * 选型：GIF 仅 256 色/帧，照片级渲染会色带——采用**逐帧 216 色网页安全
 * 调色板量化**（6×6×6 立方），期刊示意图（低饱和学术色板）下视觉损失
 * 可接受；对比 gif.js 需 Worker + 内嵌脚本资源，内置版零依赖、Node 可单测。
 *
 * 结构：GIF89a 头 → 全局调色板（216 色）→ Netscape 循环扩展 → 逐帧
 * （Graphic Control Extension 延时 → Image Descriptor → LZW 数据）→ 尾部。
 * 帧内像素先量化为调色板索引（最近色），LZW 按规范变长码打包。
 */

export interface GifFrame {
  /** RGBA 像素（长度 = w×h×4） */
  rgba: Uint8Array;
  /** 帧延时（毫秒） */
  delayMs: number;
}

/* ---------- 216 色网页安全调色板（6×6×6） ---------- */

export function webSafePalette(): Uint8Array {
  const pal = new Uint8Array(216 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) {
        pal[i++] = r * 51;
        pal[i++] = g * 51;
        pal[i++] = b * 51;
      }
  return pal;
}

/** RGBA → 调色板索引（最近色；alpha < 128 视为第一索引背景） */
export function quantize(rgba: Uint8Array, pal: Uint8Array): Uint8Array {
  const idx = new Uint8Array(rgba.length / 4);
  for (let p = 0; p < idx.length; p++) {
    if (rgba[p * 4 + 3] < 128) {
      idx[p] = 0;
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < 216; c++) {
      const dr = rgba[p * 4] - pal[c * 3];
      const dg = rgba[p * 4 + 1] - pal[c * 3 + 1];
      const db = rgba[p * 4 + 2] - pal[c * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
      if (d === 0) break;
    }
    idx[p] = best;
  }
  return idx;
}

/* ---------- LZW（GIF 变长码规范） ---------- */

const LZW_MIN_CODE = 8; // 256 色调色板 → 最小码长 8

/** GIF LZW 压缩：输入索引流（每字节 0..255），输出字节数组 */
export function lzwEncode(indices: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  let cur = 0;
  let curBits = 0;
  const emit = (code: number, size: number): void => {
    cur |= code << curBits;
    curBits += size;
    while (curBits >= 8) {
      bytes.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  };

  const clearCode = 1 << LZW_MIN_CODE; // 256
  const eoiCode = clearCode + 1; // 257
  let codeSize = LZW_MIN_CODE + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map<string, number>();

  emit(clearCode, codeSize);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const ch = String(indices[i]);
    const key = prefix + ',' + ch;
    if (dict.has(key)) {
      prefix = key;
      continue;
    }
    emit(dict.get(prefix) ?? Number(prefix), codeSize);
    dict.set(key, nextCode++);
    // 码长增长与解码器同步：新分配码 ≥ 1<<codeSize 时升位（giflib 同款时机）
    if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
    if (nextCode > 4095) {
      // 字典满：清空重置
      emit(clearCode, codeSize);
      codeSize = LZW_MIN_CODE + 1;
      nextCode = eoiCode + 1;
      dict = new Map();
    }
    prefix = ch;
  }
  emit(dict.get(prefix) ?? Number(prefix), codeSize);
  emit(eoiCode, codeSize);
  if (curBits > 0) bytes.push(cur & 0xff);
  return new Uint8Array(bytes);
}

/* ---------- GIF89a 组装 ---------- */

function u16le(v: number): [number, number] {
  return [v & 0xff, (v >> 8) & 0xff];
}

/** RGBA 帧 → 索引帧（量化，216 色全局调色板） */
function frameToIndexed(rgba: Uint8Array, pal: Uint8Array): Uint8Array {
  return quantize(rgba, pal);
}

/** 组装 GIF89a（帧延时 ms → 百分之一秒，至少 2） */
export function encodeGIF(w: number, h: number, frames: GifFrame[]): Uint8Array {
  const pal = webSafePalette();
  const out: number[] = [];

  // Header + Logical Screen Descriptor + 全局调色板
  out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
  out.push(...u16le(w), ...u16le(h));
  out.push(0xf7, 0, 0); // 全局色表 flag(0b1111_0111): 256 色、色表尺寸 7；无排序；背景 0；宽高比 0
  out.push(...pal);

  // Netscape 循环扩展（无限循环）
  out.push(0x21, 0xff, 11);
  out.push(...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)));
  out.push(3, 1, 0, 0, 0);

  for (const f of frames) {
    const delayCs = Math.max(2, Math.round(f.delayMs / 10));
    // Graphic Control Extension
    out.push(0x21, 0xf9, 4, 0x00);
    out.push(...u16le(delayCs), 0, 0);
    // Image Descriptor
    out.push(0x2c, ...u16le(0), ...u16le(0), ...u16le(w), ...u16le(h), 0x00);
    const indexed = frameToIndexed(f.rgba, pal);
    const data = lzwEncode(indexed);
    // LZW 最小码长 + 子块
    out.push(LZW_MIN_CODE);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0); // 块终止
  }

  out.push(0x3b); // Trailer
  return new Uint8Array(out);
}

/** Uint8Array → dataURL（image/gif） */
export function gifToDataUrl(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192)
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:image/gif;base64,' + btoa(bin);
}
