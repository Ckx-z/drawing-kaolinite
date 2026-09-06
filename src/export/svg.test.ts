/**
 * 分组 SVG 导出验收测试 —— T-5.3
 *
 * 验收标准（TODO）：g 分组命名与图层名一致；PPT/Inkscape 可读（XML 合法、无 NaN）；
 * 线稿档画风（平色填充 + 均匀描边）；透视投影与遮挡排序正确。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sceneToSVG, type SvgComponentInput } from './svg';

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 6000);
  cam.position.set(0, 0, 200);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

const COLORS = { O: '#D64550', Si: '#E2C47E' };
const W = 800;
const H = 600;

function twoComponents(): SvgComponentInput[] {
  return [
    {
      name: '远处的片层',
      visible: true,
      atoms: [
        { el: 'O', x: 0, y: 0, z: -20, r: 3 },
        { el: 'Si', x: 4, y: 0, z: -20, r: 2.5 },
      ],
      bonds: [[0, 1]],
      bondRadius: 0.16,
      bondColor: '#8f959c',
    },
    {
      name: '近处的颗粒',
      visible: true,
      atoms: [{ el: 'O', x: 0, y: 0, z: 20, r: 3 }],
      bonds: [],
      bondRadius: 0,
      bondColor: '#8f959c',
    },
  ];
}

describe('结构：g 分组 / 命名 / XML 合法', () => {
  it('每组件一个 <g id="组件名">，与图层名一致（空格转连字符）', () => {
    const svg = sceneToSVG(twoComponents(), makeCamera(), { width: W, height: H, elementColors: COLORS });
    expect(svg).toContain('<g id="远处的片层">');
    expect(svg).toContain('<g id="近处的颗粒">');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('undefined');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('隐藏组件不输出；空组件跳过', () => {
    const comps = twoComponents();
    comps[0].visible = false;
    const svg = sceneToSVG(comps, makeCamera(), { width: W, height: H, elementColors: COLORS });
    expect(svg).not.toContain('远处的片层');
    expect(svg).toContain('近处的颗粒');
  });

  it('特殊字符转义与非法 id 字符清理', () => {
    const comps: SvgComponentInput[] = [
      { name: '颗粒 <A> & "B"', visible: true, atoms: [{ el: 'O', x: 0, y: 0, z: 0, r: 3 }], bonds: [], bondRadius: 0, bondColor: '#000' },
    ];
    const svg = sceneToSVG(comps, makeCamera(), { width: W, height: H, elementColors: COLORS });
    expect(svg).toContain('<g id="颗粒-A--B">');
    expect(svg).not.toMatch(/<g id=".*<.*">/);
  });
});

describe('投影与排序', () => {
  it('画家算法：远组件先于近组件输出（近的遮住远的）', () => {
    const svg = sceneToSVG(twoComponents(), makeCamera(), { width: W, height: H, elementColors: COLORS });
    expect(svg.indexOf('远处的片层')).toBeLessThan(svg.indexOf('近处的颗粒'));
  });

  it('原子画在所在组件的键之后（同深度时近者后画）——线稿档描边圆覆盖线端', () => {
    const comps: SvgComponentInput[] = [
      {
        name: 'g',
        visible: true,
        atoms: [
          { el: 'O', x: 0, y: 0, z: 0, r: 3 },
          { el: 'Si', x: 3, y: 0, z: 0, r: 2.5 },
        ],
        bonds: [[0, 1]],
        bondRadius: 0.16,
        bondColor: '#8f959c',
      },
    ];
    const svg = sceneToSVG(comps, makeCamera(), { width: W, height: H, elementColors: COLORS });
    const line = svg.indexOf('<line');
    const lastCircle = svg.lastIndexOf('<circle');
    expect(line).toBeGreaterThan(-1);
    expect(lastCircle).toBeGreaterThan(line);
  });

  it('相机后方与视锥外原子被剔除', () => {
    const comps: SvgComponentInput[] = [
      {
        name: 'g',
        visible: true,
        atoms: [
          { el: 'O', x: 0, y: 0, z: 300, r: 3 },   // 相机后方（相机在 +z 看 -z）
          { el: 'O', x: 0, y: 0, z: 0, r: 3 },     // 在场
          { el: 'O', x: 5000, y: 0, z: -100, r: 3 }, // 视锥外
        ],
        bonds: [],
        bondRadius: 0,
        bondColor: '#000',
      },
    ];
    const svg = sceneToSVG(comps, makeCamera(), { width: W, height: H, elementColors: COLORS });
    expect(svg.match(/<circle/g)).toHaveLength(1);
  });

  it('同深度同元素：世界半径正比于像素半径（透视缩放公式）', () => {
    const comps: SvgComponentInput[] = [
      {
        name: 'g',
        visible: true,
        atoms: [
          { el: 'O', x: 0, y: 0, z: -100, r: 2 },
          { el: 'O', x: 10, y: 0, z: -100, r: 4 },
        ],
        bonds: [],
        bondRadius: 0,
        bondColor: '#000',
      },
    ];
    const svg = sceneToSVG(comps, makeCamera(), { width: W, height: H, elementColors: COLORS });
    const radii = [...svg.matchAll(/ r="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
    expect(radii[1] / radii[0]).toBeCloseTo(2, 2); // r=4 与 r=2 → 像素半径比 2
  });
});

describe('线稿档画风', () => {
  it('填充用色板色 + 均匀描边色/宽度可配', () => {
    const comps: SvgComponentInput[] = [
      { name: 'g', visible: true, atoms: [{ el: 'O', x: 0, y: 0, z: 0, r: 3 }], bonds: [], bondRadius: 0, bondColor: '#000' },
    ];
    const svg = sceneToSVG(comps, makeCamera(), {
      width: W, height: H, elementColors: COLORS, strokeColor: '#333', strokeWidth: 2,
    });
    expect(svg).toContain('fill="#D64550"');
    expect(svg).toContain('stroke="#333" stroke-width="2"');
  });

  it('背景矩形可选', () => {
    const comps: SvgComponentInput[] = [
      { name: 'g', visible: true, atoms: [{ el: 'O', x: 0, y: 0, z: 0, r: 3 }], bonds: [], bondRadius: 0, bondColor: '#000' },
    ];
    const withBg = sceneToSVG(comps, makeCamera(), { width: W, height: H, elementColors: COLORS, background: '#F4F5F7' });
    const noBg = sceneToSVG(comps, makeCamera(), { width: W, height: H, elementColors: COLORS });
    expect(withBg).toContain('<rect width="800" height="600" fill="#F4F5F7"/>');
    expect(noBg).not.toContain('<rect');
  });
});
