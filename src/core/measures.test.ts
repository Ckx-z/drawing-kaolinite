import { describe, expect, it } from 'vitest';
import { angleDeg, bondToUpgrade, measureLabel, pickAtom, type Measurement } from './measures';

const id = (() => {
  let n = 0;
  return () => `m${n++}`;
})();

describe('angleDeg（键角）', () => {
  it('直线 180°、直角 90°、共点 0°', () => {
    expect(angleDeg([1, 0, 0], [0, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 6);
    expect(angleDeg([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90, 6);
    expect(angleDeg([1, 0, 0], [0, 0, 0], [2, 0, 0])).toBeCloseTo(0, 6);
  });

  it('水分子示意 104.5°', () => {
    // 顶点在原点，两臂按 104.5° 张开（yz 平面）
    const th = (104.5 / 2) * (Math.PI / 180);
    const a: [number, number, number] = [Math.sin(th), Math.cos(th), 0];
    const c: [number, number, number] = [-Math.sin(th), Math.cos(th), 0];
    expect(angleDeg(a, [0, 0, 0], c)).toBeCloseTo(104.5, 3);
  });
});

describe('measureLabel（标签文本）', () => {
  it('键长两位小数 Å；键角一位小数度', () => {
    expect(measureLabel('bond', [[0, 0, 0], [1.543, 0, 0]])).toBe('d = 1.54 Å');
    expect(measureLabel('bond', [[0, 0, 0], [0, 0, 0]])).toBe('d = 0.00 Å');
    expect(measureLabel('angle', [[1, 0, 0], [0, 0, 0], [0, 1, 0]])).toBe('θ = 90.0°');
  });
});

describe('pickAtom（拾取状态机）', () => {
  const A = { compId: 'c1', index: 0 };
  const B = { compId: 'c1', index: 1 };
  const C = { compId: 'c2', index: 3 };

  it('一点拾取 → 两点产出键长（保留拾取可续第三点）', () => {
    const r1 = pickAtom([], A, [], id);
    expect(r1.pick).toEqual([A]);
    expect(r1.commit).toBeNull();
    const r2 = pickAtom(r1.pick, B, [], id);
    expect(r2.pick).toEqual([A, B]);
    expect(r2.commit?.kind).toBe('bond');
    expect(r2.commit?.picks).toEqual([A, B]);
  });

  it('第三点升级键角并移除同两点键长', () => {
    const bond: Measurement = { id: 'mb', kind: 'bond', picks: [A, B] };
    const r = pickAtom([A, B], C, [bond], id);
    expect(r.pick).toEqual([]);
    expect(r.commit?.kind).toBe('angle');
    expect(r.commit?.picks).toEqual([A, B, C]);
    expect(r.removeId).toBe('mb');
  });

  it('重复点击已拾取原子 = 取消该拾取', () => {
    const r = pickAtom([A, B], B, [], id);
    expect(r.pick).toEqual([A]);
    expect(r.commit).toBeNull();
  });

  it('跨组件引用可拾取', () => {
    const r = pickAtom([A], C, [], id);
    expect(r.commit?.picks).toEqual([A, C]);
  });
});

describe('bondToUpgrade（升级判据：两点集合相同，顺序无关）', () => {
  it('逆序同两点命中；不同点不命中', () => {
    const bond: Measurement = { id: 'x', kind: 'bond', picks: [{ compId: 'a', index: 1 }, { compId: 'b', index: 0 }] };
    expect(bondToUpgrade([bond], [{ compId: 'b', index: 0 }, { compId: 'a', index: 1 }])).toBe('x');
    expect(bondToUpgrade([bond], [{ compId: 'a', index: 1 }, { compId: 'b', index: 2 }])).toBeNull();
    const angle: Measurement = { id: 'y', kind: 'angle', picks: [] as never };
    expect(bondToUpgrade([angle], [])).toBeNull();
  });
});
