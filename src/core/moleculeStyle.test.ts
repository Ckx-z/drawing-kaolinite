/**
 * Molecule 显示模型统一（2026-09-21c）：所有来源（preset/SMILES/化学式/MOL/SDF/
 * 吸附 Apply）的 molecule 组件共用 params.style（球棍/空间填充）——
 * 纯渲染表达：切换零几何影响（原子坐标/键连接/测量不变），default 兼容旧数据。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, moleculeParamsSchema, sceneDocumentSchema } from './schema';
import { computeGeometry } from './worker';
import { PARAM_DEFS } from '../ui/paramDefs';
import { createSceneStore, sceneStore } from '../state/sceneStore';

describe('统一 style 参数', () => {
  it('默认值：所有 molecule 创建路径（DEFAULT_PARAMS）缺省 = 球棍', () => {
    expect(DEFAULT_PARAMS.molecule.style).toBe('球棍');
    expect(moleculeParamsSchema.parse({ kind: 'H₂O' }).style).toBe('球棍'); // 旧数据 default 补全
  });

  it('切换 球棍 → 空间填充 schema 通过；两值往返', () => {
    const a = moleculeParamsSchema.parse({ kind: 'C₇H₈', style: '空间填充' });
    expect(a.style).toBe('空间填充');
    expect(moleculeParamsSchema.parse({ ...a, style: '球棍' }).style).toBe('球棍');
  });

  it('ParamPanel：molecule defs 含 style（显示模型）且无 when——与来源无关', () => {
    const style = PARAM_DEFS.molecule.find((d) => d.key === 'style')!;
    expect(style.label).toBe('显示模型');
    expect(style.when).toBeUndefined();
    const opts = style.options as Array<{ value: string; label: string }>;
    expect(opts.map((o) => o.value)).toEqual(['球棍', '空间填充']);
  });

  it('几何不变量：style 切换前后 atoms/bonds 逐位相同（渲染层决定显示，几何层零感知）', () => {
    const g1 = computeGeometry({ kind: 'molecule', cifText: '', params: { kind: 'C₇H₈', style: '球棍' } });
    const g2 = computeGeometry({ kind: 'molecule', cifText: '', params: { kind: 'C₇H₈', style: '空间填充' } });
    expect(g2.atoms).toHaveLength(g1.atoms.length);
    for (const [i, a] of g1.atoms.entries()) {
      expect(a.x).toBe(g2.atoms[i]!.x);
      expect(a.y).toBe(g2.atoms[i]!.y);
    }
    expect(g2.bonds).toEqual(g1.bonds); // 键数据恒在（空间填充仅渲染隐藏）
  });

  it('Scene 序列化/反序列化：style 保持；旧 scene 缺 style 正常加载默认球棍', () => {
    const id = sceneStore.getState().addComponent('molecule', { params: { kind: 'C₇H₈', style: '空间填充' } });
    const doc = sceneDocumentSchema.parse(JSON.parse(JSON.stringify(sceneStore.getState().toSceneDocument())));
    expect((doc.components.find((c) => 'params' in c && (c.params as { kind?: string }).kind === 'C₇H₈')?.params as { style?: string }).style).toBe('空间填充');
    // 旧 scene（手动剥离 style 字段模拟历史数据）
    const legacy = JSON.parse(JSON.stringify(doc));
    for (const c of legacy.components) if ((c.params as { kind?: string }).kind) delete c.params.style;
    sceneStore.getState().removeComponent(id);
    expect(() => sceneStore.getState().loadScene(legacy)).not.toThrow();
    const back = sceneStore.getState().components.find((c) => c.type === 'molecule');
    expect((back?.params as { style?: string }).style).toBe('球棍');
    for (const c of [...sceneStore.getState().components]) sceneStore.getState().removeComponent(c.id);
  });

  it('各来源创建统一：SMILES/化学式/MOL 分子组件同样携带默认 style', () => {
    const s = createSceneStore();
    const a = s.getState().addComponent('molecule', { params: { smiles: 'CCO', kind: 'H₂O' } });
    const b = s.getState().addComponent('molecule', { params: { formula: 'CO', kind: 'H₂O' } });
    const c = s.getState().addComponent('molecule', { params: { mol: 'dummy-mol-text', kind: 'H₂O' } });
    for (const id of [a, b, c]) {
      const comp = s.getState().components.find((x) => x.id === id)!;
      expect((comp.params as { style?: string }).style).toBe('球棍'); // DEFAULT_PARAMS 统一注入
    }
  });
});
