/**
 * 原子拾取全局索引回归（V2 P0-1）
 *
 * InstancedMesh 按元素分桶后，raycast 的 instanceId 是「桶内」索引；修复前
 * RendererService.handleUp 把桶内号当全局原子号传给 onAtomClick → 测量/氧空位
 * 在多元素晶体上解析到错误原子（如 CeO₂ 的 O 桶实例号落在 Ce 段）。
 * 本文件锁定修复所依赖的映射语义：桶数组元素与全量 atoms 同引用（instanced.addAtoms），
 * indexOf 反查的全局号必然元素一致；并固化「旧缺陷可复现」的存证断言。
 */
import { describe, expect, it } from 'vitest';
import { buildKaoliniteSheet } from '../core/builders';
import { MINERALS } from '../core/minerals';
import type { Atom } from '../core/geometry';

/** 与 instanced.addAtoms 完全同款的分桶逻辑（键序 = 元素首次出现序） */
function bucketByElement(atoms: Atom[]): Record<string, Atom[]> {
  const byEl: Record<string, Atom[]> = {};
  for (const a of atoms) (byEl[a.el] = byEl[a.el] ?? []).push(a);
  return byEl;
}

function sheetAtoms(mineral: string): Atom[] {
  const m = MINERALS[mineral as keyof typeof MINERALS];
  return buildKaoliniteSheet(m.cifText, {
    mineral,
    Lx: 24,
    Ly: 24,
    layers: 1,
    d001: m.d001Default,
    shape: '矩形',
    style: '球棍',
  } as never).atoms;
}

describe('原子拾取：桶内实例号 → 全局原子号（P0-1 回归）', () => {
  it.each([
    ['高岭石（Al/Si/O/H 四元素）', 'kaolinite'],
    ['水滑石（Mg/Al/O/C/H 五元素，无序共占位 + 层间物种）', 'hydrotalcite'],
  ])('%s：每个桶实例经 indexOf 反查全局号，元素一致且同引用', (_name, mineral) => {
    const atoms = sheetAtoms(mineral as string);
    expect(new Set(atoms.map((a) => a.el)).size).toBeGreaterThanOrEqual(2); // 多元素前提
    const byEl = bucketByElement(atoms);
    for (const el of Object.keys(byEl)) {
      for (const atom of byEl[el]!) {
        const gi = atoms.indexOf(atom); // handleUp 修复采用的同一语义
        expect(gi).toBeGreaterThanOrEqual(0);
        expect(atoms[gi]).toBe(atom); // 引用相等（addAtoms 桶内即同对象）
        expect(atoms[gi]!.el).toBe(el); // 元素一致 = 测量/空位不再解析错原子
      }
    }
  });

  it('旧缺陷存证：把非首桶的桶内号当全局号，必然解析到另一元素的原子', () => {
    const atoms = sheetAtoms('hydrotalcite');
    const byEl = bucketByElement(atoms);
    const els = Object.keys(byEl);
    expect(els.length).toBeGreaterThanOrEqual(2);
    // 首桶占据全局数组前 |首桶| 位：第二桶 0 号实例的桶内号 0 落在首桶段
    expect(atoms[0]!.el).not.toBe(byEl[els[1]!]![0]!.el);
  });
});
