/**
 * 标注层验收测试 —— T-4.4
 *
 * 验收：PNG 与 SVG 导出中标注清晰且位置一致（同一投影函数）；不随相机缩放
 * 改变字号（屏幕空间）；场景 JSON 往返无损。
 * 位图像素级一致性由浏览器实测覆盖（同一 projectToScreen 同一像素）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { annotationSchema, sceneDocumentSchema } from '../core/schema';
import { sceneToSVG } from './svg';
import { annotationsToSVG } from './svg';

describe('schema：标注随场景 JSON 往返', () => {
  it('annotations 入场景文档 → 序列化往返无损', () => {
    const doc = {
      format: 'kaolin-scene/v1',
      saved: '2026-09-06T00:00:00.000Z',
      components: [],
      annotations: [
        { type: 'scalebar', visible: true },
        { type: 'label', text: 'd₀₀₁ = 1.0 nm', target: [0, 0, 0], offset: [14, -14], visible: true },
      ],
    };
    const parsed = sceneDocumentSchema.parse(doc);
    expect(parsed.annotations).toHaveLength(2);
    // 往返
    const text = JSON.stringify(parsed);
    const back = sceneDocumentSchema.parse(JSON.parse(text));
    expect(back.annotations).toEqual(parsed.annotations);
  });

  it('旧场景无 annotations 缺省合法；visible 缺省 true；非法标注拒绝', () => {
    const ok = sceneDocumentSchema.parse({ format: 'kaolin-scene/v1', saved: '2026-09-06T00:00:00.000Z', components: [] });
    expect(ok.annotations).toBeUndefined();

    const withDefault = annotationSchema.parse({ type: 'scalebar' });
    expect(withDefault.visible).toBe(true);

    expect(annotationSchema.safeParse({ type: 'ruler' }).success).toBe(false);
    expect(annotationSchema.safeParse({ type: 'label', text: 'x', worldLen: 0 }).success).toBe(false); // worldLen 必须 >0
  });
});

describe('SVG 标注（与位图同一投影 → 位置一致）', () => {
  const project = (p: [number, number, number]) => ({
    x: 400 + p[0],
    y: 300 - p[1],
    visible: 400 + p[0] >= 0 && 400 + p[0] <= 800, // 模拟视口剔除（真实实现 projectToScreen 同语义）
  });

  it('比例尺：输出 <g id="scalebar"> + <line>/<text>，nm 计；自动取 ≤160px 最大刻度', () => {
    const svg = annotationsToSVG({
      width: 800,
      height: 600,
      project,
      pxPerA: 4,
      annotations: [{ type: 'scalebar', visible: true }],
    });
    expect(svg).toContain('id="scalebar"');
    expect(svg).toContain('<line');
    expect(svg).toContain('nm');
    // pxPerA=4 → 刻度选 ≤160px/4 = ≤40Å 的最大候选 20Å → 80px 线长
    const x2 = Number(/x2="([\d.]+)"/.exec(svg)?.[1] ?? 0);
    expect(x2).toBeCloseTo(24 + 20 * 4, 1);
  });

  it('文本标签：锚点投影 + 引线 + 文本；不可见锚点剔除', () => {
    const svg = annotationsToSVG({
      width: 800,
      height: 600,
      project,
      pxPerA: 4,
      annotations: [
        { type: 'label', text: 'd₀₀₁ = 1.0 nm', target: [0, 0, 0], offset: [14, -14], visible: true },
        { type: 'label', text: '隐藏', target: [0, 0, 0], visible: false },
        { type: 'label', text: '出画', target: [900, 0, 0], visible: true },
      ],
    });
    expect(svg).toContain('d₀₀₁ = 1.0 nm');
    expect(svg).not.toContain('隐藏');
    expect(svg).not.toContain('出画'); // 投影 x=1300 > 800 剔除
  });

  it('sceneToSVG + 标注追加 = 双导出结构（RendererService 同款路径）', () => {
    const sceneSvg = sceneToSVG(
      [{ name: 'g', visible: true, atoms: [{ el: 'O', x: 0, y: 0, z: 0, r: 3 }], bonds: [], bondRadius: 0, bondColor: '#000' }],
      (() => {
        const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 6000);
        cam.position.set(0, 0, 200);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        return cam;
      })(),
      { width: 800, height: 600, elementColors: { O: '#D64550' } },
    );
    // RendererService.exportSVG 的追加逻辑
    const annotSvg = annotationsToSVG({
      width: 800,
      height: 600,
      project,
      pxPerA: 4,
      annotations: [{ type: 'scalebar', visible: true }],
    });
    const svg = sceneSvg.replace('</svg>', `${annotSvg}\n</svg>`);
    expect(svg).toContain('<circle');
    expect(svg).toContain('id="scalebar"');
    expect(svg.indexOf('<circle')).toBeLessThan(svg.indexOf('id="scalebar"'));
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });
});
