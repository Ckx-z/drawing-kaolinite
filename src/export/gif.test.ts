/**
 * GIF89a 编码器测试 —— T-10.1
 *
 * 验收：输出为合法 GIF89a（头部/逻辑屏幕/全局色表/帧结构/Trailer）；
 * LZW 压缩可无损解码回索引流（自实现解码器对拍）；量化正确；
 * 帧延时元数据正确。浏览器渲染效果由实测覆盖。
 */
import { describe, expect, it } from 'vitest';
import { encodeGIF, gifToDataUrl, lzwEncode, quantize, webSafePalette, type GifFrame } from './gif';

/** GIF LZW 解码器（规范实现，用于编码器对拍） */
function lzwDecode(data: Uint8Array, expectedPixels: number): Uint8Array {
  const out: number[] = [];
  let cur = 0;
  let curBits = 0;
  let pos = 0;
  const read = (size: number): number => {
    while (curBits < size) {
      if (pos >= data.length) throw new Error('LZW 数据提前耗尽');
      cur |= data[pos++] << curBits;
      curBits += 8;
    }
    const code = cur & ((1 << size) - 1);
    cur >>= size;
    curBits -= size;
    return code;
  };

  const clearCode = 256;
  const eoi = 257;
  let codeSize = 9;
  let dict: Map<number, number[]> = new Map();
  const resetDict = (): void => {
    dict = new Map();
    for (let i = 0; i < 256; i++) dict.set(i, [i]);
    codeSize = 9; // 字典重置后码长同步回 9（编码器字典满 clear 重置同款）
  };
  resetDict();

  let prev: number[] | null = null;
  for (;;) {
    const code = read(codeSize);
    if (code === clearCode) {
      resetDict();
      codeSize = 9;
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (dict.has(code)) entry = dict.get(code)!;
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error(`非法码 ${code}`);
    out.push(...entry);
    if (prev) {
      // 下一个新增条目索引 = 258 + 已新增数 = dict.size + 2（dict.size 已含 256 字面量）。
      // GIF "early change" 约定：编码器字典领先解码器一个条目 → 解码器升位比数学时机
      // 提前一码（next >= 2^n - 1），否则与 gif.js 等标准编码器输出不兼容。
      dict.set(dict.size + 2, [...prev, entry[0]]);
      if (dict.size + 2 >= (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    }
    prev = entry;
    if (out.length >= expectedPixels) break;
  }
  return new Uint8Array(out.slice(0, expectedPixels));
}

describe('调色板与量化', () => {
  it('216 色调色板：6×6×6 均匀立方（c = r*36+g*6+b，值 = n*51）', () => {
    const pal = webSafePalette();
    expect(pal).toHaveLength(216 * 3);
    expect(pal[0]).toBe(0);        // c=0 → (0,0,0)
    expect(pal[1]).toBe(0);
    expect(pal[2]).toBe(0);
    expect(pal[3]).toBe(0);        // c=1 → (0,0,51)
    expect(pal[5]).toBe(51);
    expect(pal[215 * 3]).toBe(255); // c=215 → (255,255,255)
    expect(pal[215 * 3 + 2]).toBe(255);
  });

  it('量化：精确色命中调色板原色；半透明视为背景索引 0', () => {
    const pal = webSafePalette();
    const rgba = new Uint8Array([
      255, 0, 0, 255,    // 红 → (5,0,0) = c 180
      0, 255, 0, 255,    // 绿 → (0,5,0) = c 30
      10, 10, 10, 255,   // 近黑 → (0,0,0) = c 0
      0, 0, 0, 100,      // 半透明 → 背景 0
    ]);
    const idx = quantize(rgba, pal);
    expect(idx[0]).toBe(180); // 5*36 + 0*6 + 0
    expect(idx[1]).toBe(30);  // 0*36 + 5*6 + 0
    expect(idx[2]).toBe(0);
    expect(idx[3]).toBe(0);
  });
});

describe('LZW 压缩（对拍解码）', () => {
  it('索引流编码后解码无损（顺序、长短流混合）', () => {
    const seq = new Uint8Array(1000);
    for (let i = 0; i < seq.length; i++) seq[i] = (i * 7 + (i % 13)) % 216; // 伪随机索引
    const packed = lzwEncode(seq);
    expect(packed.length).toBeLessThan(seq.length); // 有压缩
    const back = lzwDecode(packed, seq.length);
    expect(back).toEqual(seq);
  });

  it('长游程（纯色画面）压缩率显著', () => {
    const seq = new Uint8Array(5000).fill(30);
    const packed = lzwEncode(seq);
    expect(packed.length).toBeLessThan(200);
    expect(lzwDecode(packed, seq.length)).toEqual(seq);
  });

  it('空流与单元素流不崩溃', () => {
    expect(lzwEncode(new Uint8Array(0)).length).toBeGreaterThan(0);
    expect(lzwDecode(lzwEncode(new Uint8Array([42])), 1)).toEqual(new Uint8Array([42]));
  });
});

describe('GIF89a 组装', () => {
  const W = 64;
  const H = 48;
  const frame = (v: number): GifFrame => ({
    rgba: new Uint8Array(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : v)),
    delayMs: 100,
  });

  /** 最小 GIF 结构遍历：返回 { images: [{ data: Uint8Array }], trailer: number } */
  function walkGIF(gif: Uint8Array): { images: Array<{ lzwMin: number; data: number[] }>; trailer: number; gce: number } {
    let p = 13 + 216 * 3; // 头(6) + 屏幕描述(7) + 全局色表
    let gce = 0;
    const images: Array<{ lzwMin: number; data: number[] }> = [];
    for (;;) {
      const b = gif[p];
      if (b === 0x3b) return { images, trailer: gif[p], gce };
      if (b === 0x21) {
        const label = gif[p + 1];
        if (label === 0xf9) gce++;
        p += 2;
        while (gif[p] !== 0) p += gif[p] + 1; // 跳子块
        p++; // 终止
        continue;
      }
      if (b === 0x2c) {
        const flags = gif[p + 9];
        expect(flags & 0x80).toBe(0); // 无局部色表（用全局）
        const lzwMin = gif[p + 10];
        p += 11; // 跳过描述符(9) + LZW 最小码长(1)
        const data: number[] = [];
        while (gif[p] !== 0) {
          const len = gif[p];
          for (let k = 1; k <= len; k++) data.push(gif[p + k]);
          p += len + 1;
        }
        p++;
        images.push({ lzwMin, data });
        continue;
      }
      throw new Error(`未知块 0x${b.toString(16)} @ ${p}`);
    }
  }

  it('结构：GIF89a 头 / 全局色表标志 / Netscape 循环 / 帧延时 / Trailer', () => {
    const gif = encodeGIF(W, H, [frame(200), frame(120)]);
    let s = '';
    for (const b of gif) s += String.fromCharCode(b);
    expect(s.startsWith('GIF89a')).toBe(true);
    expect(s).toContain('NETSCAPE2.0');
    // 逻辑屏幕尺寸
    expect(gif[6]).toBe(W & 0xff);
    expect(gif[8]).toBe(H & 0xff);
    // 全局色表标志：高 4 位 1111 + 7 → 256 色
    expect(gif[10] & 0x80).toBe(0x80);
    expect((gif[10] >> 4) & 0x07).toBe(7);

    const { images, trailer, gce } = walkGIF(gif);
    expect(images).toHaveLength(2);       // 每帧一个 Image Descriptor
    expect(gce).toBe(2);                  // 每帧一个 Graphic Control Extension
    expect(trailer).toBe(0x3b);           // Trailer
  });

  it('帧延时：100ms → 10（百分之一秒），最小 2', () => {
    const gif = encodeGIF(W, H, [{ rgba: frame(200).rgba, delayMs: 100 }, { rgba: frame(50).rgba, delayMs: 1 }]);
    const delays: number[] = [];
    for (let i = 0; i < gif.length - 2; i++)
      if (gif[i] === 0x21 && gif[i + 1] === 0xf9) delays.push(gif[i + 4] | (gif[i + 5] << 8));
    expect(delays).toEqual([10, 2]);
  });

  it('像素数据 LZW 可解码回索引流（两帧各自解码）', () => {
    const srcFrames = [frame(200), frame(80)];
    const gif = encodeGIF(W, H, srcFrames);
    // 复用 walkGIF 的解析路径（重新实现于本用例内联）
    let p = 13 + 216 * 3;
    const framesData: Array<{ lzwMin: number; data: number[] }> = [];
    for (;;) {
      const b = gif[p];
      if (b === 0x3b) break;
      if (b === 0x21) {
        p += 2;
        while (gif[p] !== 0) p += gif[p] + 1;
        p++;
        continue;
      }
      if (b === 0x2c) {
        const lzwMin = gif[p + 10];
        p += 11;
        const data: number[] = [];
        while (gif[p] !== 0) {
          const len = gif[p];
          for (let k = 1; k <= len; k++) data.push(gif[p + k]);
          p += len + 1;
        }
        p++;
        framesData.push({ lzwMin, data });
        continue;
      }
      throw new Error(`未知块 0x${b.toString(16)}`);
    }
    expect(framesData).toHaveLength(2);
    const pal = webSafePalette();
    framesData.forEach((f, frameIdx) => {
      expect(f.lzwMin).toBe(8);
      const decoded = lzwDecode(new Uint8Array(f.data), W * H);
      const expected = quantize(srcFrames[frameIdx].rgba, pal);
      expect(decoded).toEqual(expected);
    });
  });

  it('gifToDataUrl：合法 data:image/gif;base64 前缀', () => {
    const url = gifToDataUrl(encodeGIF(8, 8, [frame(100)]));
    expect(url.startsWith('data:image/gif;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan(100);
  });
});
