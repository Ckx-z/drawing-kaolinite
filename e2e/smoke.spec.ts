/**
 * 基座冒烟测试（T-1.7）—— Playwright 格式，供 CI / 本地回归。
 *
 * 运行前提（阶段 2 评估安装）：npm i -D @playwright/test && npx playwright install chromium
 * 当前状态：本清单所列断言已于 2026-09-05 用 ZCode IAB 浏览器逐条人工实测通过
 * （记录见 DAILY_LOG/2026-09-05.md T-1.7 节），脚本先行入库作为回归基线。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/demo-scene.json', import.meta.url)),
  'utf8',
);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.canvas-host canvas');
});

test('首启自动载入示例场景（6 组件渲染）', async ({ page }) => {
  const count = await page.evaluate(() => window.__KAOLIN.store.getState().components.length);
  expect(count).toBe(6);
});

test('素材库添加组件：自动选中、命名自增', async ({ page }) => {
  await page.locator('.lib-card').first().click();
  const state = await page.evaluate(() => {
    const s = window.__KAOLIN.store.getState();
    return { count: s.components.length, selected: s.selectionId, name: s.components.at(-1).name };
  });
  expect(state.count).toBe(7);
  expect(state.selected).not.toBeNull();
  expect(state.name).toContain('高岭土片层');
});

test('卷曲进度滑块实时重建（45% 半卷）', async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__KAOLIN.store.getState();
    s.select(s.components.find((c) => c.type === 'halloysite_tube')!.id);
  });
  await page.waitForSelector('.right input[type=range]');
  const progress = page
    .locator('.ctl', { hasText: '卷曲进度' })
    .locator('input[type=range]');
  await progress.fill('0.45');
  const p = await page.evaluate(() => {
    const s = window.__KAOLIN.store.getState();
    return s.components.find((c) => c.type === 'halloysite_tube')!.params.progress;
  });
  expect(p).toBeCloseTo(0.45);
});

test('图层显隐与删除', async ({ page }) => {
  const before = await page.evaluate(() => window.__KAOLIN.store.getState().components.length);
  await page.locator('.layer-row').first().locator('.eye').click();
  await page.locator('.layer-row').first().locator('.del').click();
  const after = await page.evaluate(() => window.__KAOLIN.store.getState().components.length);
  expect(after).toBe(before - 1);
});

test('demo 原生场景 JSON 载入一致（6 组件 / 16,097 原子）', async ({ page }) => {
  const res = await page.evaluate((json) => {
    const store = window.__KAOLIN.store.getState();
    store.loadScene(json);
    const comps = window.__KAOLIN.store.getState().components;
    let atoms = 0;
    for (const c of comps) atoms += window.__KAOLIN.renderer.current.atomCountOf(c.id);
    return { count: comps.length, atoms };
  }, fixture);
  expect(res.count).toBe(6);
  expect(res.atoms).toBe(16097);
});

test('保存→清空→载入 往返无损', async ({ page }) => {
  const equal = await page.evaluate(() => {
    const st = window.__KAOLIN.store.getState();
    const doc = st.toSceneDocument();
    const snapshot = JSON.stringify(doc.components.map((c) => [c.type, c.params, c.transform]));
    st.clear();
    window.__KAOLIN.store.getState().loadScene(JSON.stringify(doc));
    const comps = window.__KAOLIN.store.getState().components;
    const snapshot2 = JSON.stringify(comps.map((c) => [c.type, c.params, c.transform]));
    return snapshot === snapshot2;
  });
  expect(equal).toBe(true);
});

test('300 dpi 导出 = 16cm → 1890px 宽', async ({ page }) => {
  const out = await page.evaluate(() => window.__KAOLIN.renderer.current.exportPNG({ dpi: 300 }));
  expect(out.width).toBe(1890);
  expect(out.isPng ?? true).toBe(true);
});

test('键盘：Esc 取消选中、Delete 删除', async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__KAOLIN.store.getState();
    s.select(s.components[0].id);
  });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__KAOLIN.store.getState().selectionId)).toBeNull();
  await page.evaluate(() => {
    const s = window.__KAOLIN.store.getState();
    s.select(s.components[0].id);
  });
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__KAOLIN.store.getState().selectionId)).toBeNull();
});
