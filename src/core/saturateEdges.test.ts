/**
 * 边缘饱和位点升级验收测试 —— T-2.5
 *
 * 验收标准（TODO）：开启边缘饱和后无原子间距 < 0.9Å 的碰撞；边缘 O 配位数
 * 全部 ≥ 2。附加：补 H 方向逆键（消除方向畸变）、确定性、回归（旧基线）。
 */
import { describe, expect, it } from 'vitest';
import cifText from '../../data/kaolinite.cif?raw';
import { buildKaoliniteSheet } from './builders';
import { computeBonds, saturateEdges } from './crystal';

describe('边缘饱和位点（T-2.5 验收）', () => {
  it('开启 edgeH 后：无原子间距 < 0.9Å 碰撞；边缘 O 配位数全部 ≥ 2', () => {
    const sheet = buildKaoliniteSheet(cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: true, strictCell: false,
    });
    // 无碰撞
    let minD = Infinity;
    for (let i = 0; i < sheet.atoms.length; i++)
      for (let j = i + 1; j < sheet.atoms.length; j++) {
        const d = Math.hypot(
          sheet.atoms[i].x - sheet.atoms[j].x,
          sheet.atoms[i].y - sheet.atoms[j].y,
          sheet.atoms[i].z - sheet.atoms[j].z,
        );
        if (d < minD) minD = d;
      }
    expect(minD, `最小原子间距 ${minD.toFixed(3)}Å`).toBeGreaterThan(0.9);

    // 边缘 O（含补氢后）配位数 ≥ 2（键图含 O-H）
    const bonds = computeBonds(sheet.atoms);
    const cnt = new Array<number>(sheet.atoms.length).fill(0);
    for (const b of bonds) {
      cnt[b[0]]++;
      cnt[b[1]]++;
    }
    const edgeO = sheet.atoms
      .map((a, i) => ({ a, i, label: a.label ?? '' }))
      .filter(({ a, label }) => a.el === 'O' && !label.startsWith('O-H') && true)
      .map(({ i }) => i);
    const lowCoord = edgeO.filter((i) => cnt[i] < 2);
    expect(lowCoord, `配位数 <2 的边缘 O：${lowCoord.length} 个`).toHaveLength(0);
  });

  it('补 H 方向逆键：新 H–O 键与既有 O–X 键夹角 > 90°（无方向畸变）', () => {
    // 手工构造 1 配位 O + 1 个已键合邻居
    const atoms = [
      { el: 'Si', label: 'Si1', x: 0, y: 0, z: 0 },
      { el: 'O', label: 'O1', x: 1.6, y: 0, z: 0 },
    ];
    const bonds: Array<[number, number]> = [[0, 1]];
    const out = saturateEdges(atoms, bonds);
    const h = out.find((a) => a.label === 'H*');
    expect(h).toBeDefined();
    // H 应在 O 的 +x 侧（逆 Si→O 键方向）
    expect(h!.x).toBeGreaterThan(1.6);
    // 夹角：O→H 与 O→Si 的点积 < 0（>90°）
    const dot = (h!.x - 1.6) * (0 - 1.6) + (h!.y - 0) * 0 + (h!.z - 0) * 0;
    expect(dot).toBeLessThan(0);
  });

  it('确定性：两次饱和输出逐位一致；H 标记 H*', () => {
    const sheet = buildKaoliniteSheet(cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, strictCell: false,
    });
    const rawBonds = computeBonds(sheet.atoms);
    const s1 = saturateEdges(sheet.atoms, rawBonds);
    const s2 = saturateEdges(sheet.atoms, rawBonds);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    expect(s1.some((a) => a.label === 'H*')).toBe(true);
  });

  it('1 配位 O 数量 = 新增 H 数量（每末端桥氧恰补 1 H）', () => {
    const sheet = buildKaoliniteSheet(cifText, {
      Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', style: '球棍', edgeH: false, strictCell: false,
    });
    const rawBonds = computeBonds(sheet.atoms);
    const cnt = new Array<number>(sheet.atoms.length).fill(0);
    for (const b of rawBonds) {
      cnt[b[0]]++;
      cnt[b[1]]++;
    }
    const oneCoordO = sheet.atoms.filter(
      (a, i) => a.el === 'O' && cnt[i] === 1 && !(a.label ?? '').startsWith('O-H'),
    ).length;
    const s = saturateEdges(sheet.atoms, rawBonds);
    expect(s.filter((a) => a.label === 'H*')).toHaveLength(oneCoordO);
  });
});
