/**
 * 分层透明 PNG 导出测试 —— T-5.4
 *
 * 覆盖：图层名清洗、逐层编排（深度序 = 文件名序号）、无可见层空结果。
 * 像素级验收（叠层合成 vs 整图像素差 <1%、RGBA 透明底）由浏览器实测覆盖。
 */
import { describe, expect, it } from 'vitest';
import { buildLayerPngs, sanitizeLayerName, type LayeredExportService } from './layers';

const png = (w = 100, h = 80): { dataUrl: string; width: number; height: number } => ({
  dataUrl: `data:image/png;base64,AAAA-${w}x${h}`,
  width: w,
  height: h,
});

function fakeService(layers: Array<{ id: string; name: string }>): LayeredExportService {
  return {
    visibleLayersByDepth: () => layers,
    exportComponentPNG: (id) => (layers.some((l) => l.id === id) ? png() : null),
  };
}

describe('sanitizeLayerName', () => {
  it('空格转连字符、剔除路径分隔符；空名回退 layer', () => {
    expect(sanitizeLayerName('埃洛石管 双层壁')).toBe('埃洛石管-双层壁');
    expect(sanitizeLayerName('a/b\\c')).toBe('abc');
    expect(sanitizeLayerName('   ')).toBe('layer');
  });
});

describe('buildLayerPngs 编排', () => {
  it('按深度序输出，文件名序号与叠放顺序一致（01 远 → 02 近）', () => {
    const svc = fakeService([
      { id: 'c-far', name: '远处的片层' },
      { id: 'c-near', name: '近处的颗粒' },
    ]);
    const out = buildLayerPngs(svc, { dpi: 300 });
    expect(out.map((l) => l.name)).toEqual(['远处的片层', '近处的颗粒']);
    expect(out.map((l) => l.filename)).toEqual(['01-远处的片层.png', '02-近处的颗粒.png']);
    expect(out.every((l) => l.dataUrl.startsWith('data:image/png'))).toBe(true);
    expect(out.every((l) => l.width === 100 && l.height === 80)).toBe(true);
  });

  it('名称重复的图层不产生同名文件（序号天然去重）', () => {
    const svc = fakeService([
      { id: 'a', name: '同名' },
      { id: 'b', name: '同名' },
    ]);
    const out = buildLayerPngs(svc, { dpi: 300 });
    expect(new Set(out.map((l) => l.filename)).size).toBe(2);
  });

  it('导出失败的图层被跳过；无可见层返回空数组', () => {
    const failing: LayeredExportService = {
      visibleLayersByDepth: () => [{ id: 'x', name: '丢失' }, { id: 'y', name: '正常' }],
      exportComponentPNG: (id) => (id === 'x' ? null : png()),
    };
    expect(buildLayerPngs(failing, { dpi: 300 }).map((l) => l.name)).toEqual(['正常']);
    expect(buildLayerPngs(fakeService([]), { dpi: 300 })).toEqual([]);
  });
});
