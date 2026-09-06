import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  SceneValidationError,
  defaultTransformFor,
  deserializeModule,
  deserializeScene,
  moduleSchema,
  normalizeScene,
  sceneDocumentSchema,
  serializeScene,
  sheetParamsSchema,
  particleParamsSchema,
  substrateParamsSchema,
  tubeParamsSchema,
  moleculeParamsSchema,
} from './schema';

/* ============================================================
 * fixtures —— 复刻 demo/index.html「保存场景」按钮的真实输出格式：
 * 顶层 {format, saved, components[]}；组件【无 id/locked】；
 * 参数值取 demo DEFAULTS 与 loadPreset 实测值，覆盖全部 5 种类型。
 * ============================================================ */

const DEMO_SCENE = {
  format: 'kaolin-scene/v1',
  saved: '2026-09-05T03:12:44.000Z',
  components: [
    {
      name: '高岭土片层 1',
      type: 'kaolinite_sheet',
      params: { Lx: 70, Ly: 60, layers: 3, d001: 8.5, shape: '六角', style: '球棍', edgeH: true },
      transform: { position: [0, 0, 0], rotation: [0, 15, 0], scale: 1 },
      visible: true,
    },
    {
      name: '埃洛石管（双层壁）',
      type: 'halloysite_tube',
      params: { innerR: 14, length: 100, walls: 2, d001: 10, progress: 1, taperDeg: 5, style: '空间填充' },
      transform: { position: [10, -6, 0], rotation: [0, 0, 90], scale: 1 },
      visible: true,
    },
    {
      name: 'CeO₂ 颗粒 A',
      type: 'nanoparticle',
      params: { radius: 9, grains: 170, seed: 11, mode: '簇装' },
      transform: { position: [58, 6, 2], rotation: [0, 0, 0], scale: 1 },
      visible: true,
    },
    {
      name: 'H₂O ×1',
      type: 'molecule',
      params: { kind: 'H₂O' },
      transform: { position: [-8, 26, 10], rotation: [0, 0, 25], scale: 4 },
      visible: true,
    },
    {
      name: '橡胶基底 1',
      type: 'rubber_substrate',
      params: { Lx: 140, Ly: 90, thickness: 5 },
      transform: { position: [0, -30, 0], rotation: [0, 0, 0], scale: 1 },
      visible: false,
    },
  ],
};

const DEMO_SCENE_TEXT = JSON.stringify(DEMO_SCENE);

describe('场景校验：demo 样例兼容性（T-1.2 核心验收）', () => {
  it('demo 保存的 5 类型场景 JSON 通过校验（组件无 id 字段）', () => {
    const doc = deserializeScene(DEMO_SCENE_TEXT);
    expect(doc.format).toBe('kaolin-scene/v1');
    expect(doc.components).toHaveLength(5);
    expect(doc.components.map((c) => c.type)).toEqual([
      'kaolinite_sheet',
      'halloysite_tube',
      'nanoparticle',
      'molecule',
      'rubber_substrate',
    ]);
    // demo 组件不带 id —— optional 约定生效
    expect(doc.components.every((c) => c.id === undefined)).toBe(true);
  });

  it('molecule 默认 scale=4、特殊枚举值（含下标字符与括号）均合法', () => {
    const doc = deserializeScene(DEMO_SCENE_TEXT);
    expect(doc.components[3].transform.scale).toBe(4);

    const oh = deserializeScene(
      JSON.stringify({
        ...DEMO_SCENE,
        components: [
          { ...DEMO_SCENE.components[3], params: { kind: '·OH (羟基自由基)' } },
        ],
      }),
    );
    // 判别联合经索引访问不收窄，按 fixture 已知类型断言
    expect(oh.components[0].type).toBe('molecule');
    expect((oh.components[0].params as { kind: string }).kind).toBe('·OH (羟基自由基)');
  });

  it('往返序列化无损：deserialize→serialize→deserialize 深相等', () => {
    const once = deserializeScene(DEMO_SCENE_TEXT);
    const twice = deserializeScene(serializeScene(once));
    expect(twice).toEqual(once);
  });

  it('空场景（清空后保存）合法', () => {
    const doc = deserializeScene(
      JSON.stringify({ format: 'kaolin-scene/v1', saved: '2026-09-05T00:00:00Z', components: [] }),
    );
    expect(doc.components).toHaveLength(0);
  });
});

describe('normalizeScene：载入规范化', () => {
  it('为无 id 组件补唯一 id，补 locked=false；params/transform 不变', () => {
    const doc = normalizeScene(deserializeScene(DEMO_SCENE_TEXT));
    const ids = doc.components.map((c) => c.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.components.every((c) => c.locked === false)).toBe(true);
    expect((doc.components[0].params as { Lx: number }).Lx).toBe(70);
    expect(doc.components[1].transform.rotation).toEqual([0, 0, 90]);
  });
});

describe('非法输入拒绝并报出字段路径（T-1.2 核心验收）', () => {
  const parseExpectingError = (mutate: (scene: typeof DEMO_SCENE) => void) => {
    const bad = structuredClone(DEMO_SCENE);
    mutate(bad);
    try {
      deserializeScene(JSON.stringify(bad));
    } catch (e) {
      expect(e).toBeInstanceOf(SceneValidationError);
      return e as SceneValidationError;
    }
    throw new Error('应当抛出 SceneValidationError');
  };

  it.each([
    ['Lx 超上限', (s: typeof DEMO_SCENE) => void (s.components[0].params.Lx = 999), 'components.0.params.Lx'],
    ['layers 非法', (s: typeof DEMO_SCENE) => void (s.components[0].params.layers = 5), 'components.0.params.layers'],
    ['d001 低于片层下限', (s: typeof DEMO_SCENE) => void (s.components[0].params.d001 = 7.0), 'components.0.params.d001'],
    ['progress 超上限', (s: typeof DEMO_SCENE) => void ((s.components[1].params as { progress: number }).progress = 1.5), 'components.1.params.progress'],
    ['未知分子种类', (s: typeof DEMO_SCENE) => void ((s.components[3].params as { kind: string }).kind = 'H₂SO₄'), 'components.3.params.kind'],
    ['scale 低于下限', (s: typeof DEMO_SCENE) => void (s.components[2].transform.scale = 0.001), 'components.2.transform.scale'],
  ])('%s → 报路径 %s', (_label, mutate, expectedPath) => {
    const err = parseExpectingError(mutate);
    expect(err.issues.some((i) => i.path === expectedPath)).toBe(true);
    expect(err.message).toContain(expectedPath);
  });

  it('版本号错误拒绝', () => {
    const err = parseExpectingError((s) => void (s.format = 'kaolin-scene/v2'));
    expect(err.issues.some((i) => i.path === 'format')).toBe(true);
  });

  it('strictObject 拒绝未知字段（拼写错误早暴露）', () => {
    const err = parseExpectingError((s) =>
      void ((s.components[0].params as Record<string, unknown>).Lx_typo = 70),
    );
    expect(err.issues.some((i) => i.path === 'components.0.params')).toBe(true);
  });

  it('非 JSON 文本报语法错误', () => {
    expect(() => deserializeScene('{oops')).toThrow(SceneValidationError);
  });
});

describe('模块库条目校验（demo localStorage 格式兼容）', () => {
  const DEMO_MODULE = {
    id: 'm1725512345678',
    name: '卷曲测试管',
    type: 'halloysite_tube',
    params: { innerR: 14, length: 90, walls: 2, d001: 10, progress: 1, taperDeg: 0, style: '空间填充' },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    thumb: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ',
  };

  it('demo 存入的模块（无 tags/createdAt）通过校验，对象与文本双入口一致', () => {
    const fromObj = deserializeModule(DEMO_MODULE);
    const fromText = deserializeModule(JSON.stringify(DEMO_MODULE));
    expect(fromObj).toEqual(fromText);
    expect(fromObj.name).toBe('卷曲测试管');
  });

  it('T-3.2 规划字段（tags/createdAt/moduleVersion）合法', () => {
    const m = deserializeModule({ ...DEMO_MODULE, tags: ['埃洛石', '复合'], createdAt: '2026-09-05', moduleVersion: 1 });
    expect(m.tags).toEqual(['埃洛石', '复合']);
  });

  it('thumb 非 data:image 前缀拒绝并报路径', () => {
    try {
      deserializeModule({ ...DEMO_MODULE, thumb: 'https://example.com/a.jpg' });
    } catch (e) {
      const err = e as SceneValidationError;
      expect(err.issues.some((i) => i.path === 'thumb')).toBe(true);
      return;
    }
    throw new Error('应当抛出 SceneValidationError');
  });
});

describe('默认值工厂（与 DATA_DICT / demo DEFAULTS 一致）', () => {
  it('各类型默认 params 通过对应 schema', () => {
    expect(sheetParamsSchema.parse(DEFAULT_PARAMS.kaolinite_sheet)).toBeTruthy();
    expect(tubeParamsSchema.parse(DEFAULT_PARAMS.halloysite_tube)).toBeTruthy();
    expect(particleParamsSchema.parse(DEFAULT_PARAMS.nanoparticle)).toBeTruthy();
    expect(moleculeParamsSchema.parse(DEFAULT_PARAMS.molecule)).toBeTruthy();
    expect(substrateParamsSchema.parse(DEFAULT_PARAMS.rubber_substrate)).toBeTruthy();
  });

  it('默认 transform：molecule scale=4，其余 1', () => {
    expect(defaultTransformFor('molecule').scale).toBe(4);
    expect(defaultTransformFor('kaolinite_sheet').scale).toBe(1);
  });

  it('默认参数组件可组装为合法场景（T-1.6 素材库点击添加的路径）', () => {
    const doc = sceneDocumentSchema.parse({
      format: 'kaolin-scene/v1',
      saved: new Date().toISOString(),
      components: (Object.keys(DEFAULT_PARAMS) as Array<keyof typeof DEFAULT_PARAMS>).map((type) => ({
        name: `新组件-${type}`,
        type,
        params: DEFAULT_PARAMS[type],
        transform: defaultTransformFor(type),
        visible: true,
      })),
    });
    expect(doc.components).toHaveLength(5);
    expect(moduleSchema.safeParse({ ...DEMO_SCENE, id: '' }).success).toBe(false);
  });
});
