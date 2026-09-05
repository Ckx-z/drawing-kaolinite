import { describe, expect, it } from 'vitest';
import { ELEMENTS, getElement } from './elements';

/**
 * 元素数据不变量测试（T-1.1 首个单测，同时是 T-1.3 内核移植时的数据基线校验）
 */
describe('ELEMENTS 元素显示数据库', () => {
  it('覆盖黏土矿物与配套场景所需元素', () => {
    const required = ['H', 'O', 'Al', 'Si', 'Ce', 'Ca', 'K', 'Fe', 'Mg', 'Na', 'Ti', 'C', 'N'];
    for (const sym of required) {
      expect(getElement(sym), `缺少元素 ${sym}`).toBeDefined();
    }
  });

  it('每条记录半径为正、vdw > cov、颜色为合法 hex', () => {
    for (const [sym, info] of Object.entries(ELEMENTS)) {
      expect(info.cov, `${sym} cov`).toBeGreaterThan(0);
      expect(info.vdw, `${sym} vdw`).toBeGreaterThan(info.cov);
      expect(info.color, `${sym} color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(info.name.length, `${sym} name`).toBeGreaterThan(0);
    }
  });

  it('未知元素返回 undefined（渲染层回退色的依据）', () => {
    expect(getElement('Xx')).toBeUndefined();
  });
});
