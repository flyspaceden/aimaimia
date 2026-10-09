import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4319';
const output = fileURLToPath(new URL('../.qa/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], unexpectedRequests = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (request.method() !== 'GET' || new URL(request.url()).origin !== new URL(base).origin) unexpectedRequests.push(`${request.method()} ${request.url()}`); });
page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
const checks = [];
async function check(name, action) { await action(); checks.push(name); }
try {
  await page.goto(base);
  await page.locator('.hh-product').first().waitFor();
  await check('初始化与元数据', async () => {
    assert.equal(await page.locator('.hh-product').count(), 3);
    assert.match(await page.title(), /货源大厅/);
    assert.equal(await page.locator('.hh-logo').evaluate(img => img.complete && img.naturalWidth > 0), true);
  });
  await page.screenshot({ path: output + '/desktop.png', fullPage: true });
  await check('筛选交集、空态和清空', async () => {
    await page.locator('[data-category="畜禽"]').click();
    assert.match(await page.locator('#hh-products').innerText(), /暂无/);
    await page.locator('[data-action="reset"]').click();
    await page.locator('#hh-query').fill('茂名');
    await page.locator('#hh-query').press('Enter');
    assert.equal(await page.locator('.hh-product').count(), 1);
    await page.locator('[data-category="果蔬"]').click();
    assert.equal(await page.locator('.hh-product').count(), 0);
    await page.locator('[data-action="reset"]').click();
  });
  await check('链接刷新与返回恢复', async () => {
    await page.locator('[data-category="水产"]').click();
    await page.locator('#hh-query').fill('茂名');
    await page.locator('#hh-query').press('Enter');
    await page.reload();
    assert.equal(await page.locator('#hh-query').inputValue(), '茂名');
    assert.equal(await page.locator('.hh-product').count(), 1);
    await page.locator('[data-page="demand"]').click();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[data-view="market"]').hidden === false);
    assert.equal(await page.locator('.hh-product').count(), 1);
  });
  await check('模态焦点、Escape和独立货源询价', async () => {
    const button = page.locator('[data-item="tilapia"]');
    await button.click();
    assert.equal(await page.locator('#hh-dialog').evaluate(el => el.open), true);
    assert.equal(await page.locator('[data-action="close"]').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    // 原生 dialog 允许焦点进入浏览器工具栏（此时 activeElement 为 body），但不能进入背景控件。
    assert.equal(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('dialog')), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
    await page.keyboard.press('Escape');
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
    await button.click();
    await page.locator('[data-action="inquiry"]').click();
    assert.match(await page.locator('#hh-dialog-title').innerText(), /罗非鱼/);
    await page.keyboard.press('Escape');
  });
  await check('采购条目不串用', async () => {
    await page.locator('[data-page="demand"]').click();
    await page.locator('[data-demand="1"]').click();
    assert.match(await page.locator('#hh-dialog-title').innerText(), /番茄/);
    assert.match(await page.locator('#hh-dialog-body').innerText(), /800 公斤/);
    assert.match(await page.locator('#hh-dialog-body').innerText(), /深圳/);
    await page.keyboard.press('Escape');
  });
  await check('跳过导航不修改当前路由', async () => {
    for (const view of ['demand', 'trace', 'work']) {
      await page.locator(`[data-page="${view}"]`).click();
      const before = page.url();
      await page.locator('.hh-skip').focus();
      await page.keyboard.press('Enter');
      assert.equal(page.url(), before);
      assert.equal(await page.locator(`[data-view="${view}"] [data-view-heading]`).evaluate(el => el === document.activeElement), true);
    }
  });
  await check('批次成功、失败和大小写', async () => {
    await page.locator('[data-page="trace"]').click();
    await page.locator('#hh-batch').fill('unknown');
    await page.locator('#hh-batch').press('Enter');
    assert.equal(await page.locator('#hh-trace-empty').isVisible(), true);
    await page.locator('#hh-batch').fill(' hh-demo-001 ');
    await page.locator('#hh-batch').press('Enter');
    assert.equal(await page.locator('#hh-trace-result').isVisible(), true);
  });
  await check('工作台状态和报价', async () => {
    await page.locator('[data-page="work"]').click();
    await page.locator('[data-status="complete"]').click();
    assert.match(await page.locator('#hh-orders').innerText(), /暂无/);
    await page.locator('[data-status="quoted"]').click();
    await page.locator('[data-action="review"]').click();
    assert.match(await page.locator('#hh-dialog-body').innerText(), /12.80/);
    await page.keyboard.press('Escape');
    await page.locator('[data-status="ongoing"]').click();
    await page.locator('[data-action="orderdetail"]').click();
    assert.match(await page.locator('#hh-dialog-body').innerText(), /验收与异议/);
    await page.keyboard.press('Escape');
  });
  await check('三类表单校验、文本转义和关闭清除', async () => {
    await page.locator('[data-page="market"]').click();
    for (const action of ['buy', 'sell', 'join']) {
      await page.locator(`[data-action="${action}"]`).first().click();
      const form = page.locator('#hh-local-form');
      assert.equal(await form.evaluate(el => el.checkValidity()), false);
      await form.locator('[name="subject"]').fill('<img src=x onerror=alert(1)>');
      if (action === 'join') await form.locator('[name="region"]').fill('广东茂名');
      else {
        await form.locator('[name="quantity"]').fill('-1');
        assert.equal(await form.locator('[name="quantity"]').evaluate(el => el.checkValidity()), false);
        await form.locator('[name="quantity"]').fill('2000');
        await form.locator('[name="date"]').fill('2099-01-01');
      }
      await form.locator('textarea').fill('   ');
      await form.locator('button[type=submit]').click();
      assert.equal(await form.locator('textarea').evaluate(el => el.checkValidity()), false);
      await form.locator('textarea').fill('提供批次资料，广州交付。');
      await form.locator('button[type=submit]').click();
      assert.match(await page.locator('#hh-form-result').innerText(), /<img src=x onerror=alert\(1\)>/);
      assert.equal(await page.locator('#hh-form-result img').count(), 0);
      assert.match(await page.locator('#hh-form-result').innerText(), /未发送申请/);
      await page.keyboard.press('Escape');
      await page.locator(`[data-action="${action}"]`).first().click();
      assert.equal(await page.locator('[name="subject"]').inputValue(), '');
      await page.keyboard.press('Escape');
    }
  });
  await check('多宽度和短屏对话框', async () => {
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ['market', 'demand', 'trace', 'work']) {
        await page.locator(`[data-page="${view}"]`).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${view} at ${width}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-page="market"]').click();
    await page.locator('#hh-query').fill('');
    await page.locator('#hh-query').press('Enter');
    await page.locator('[data-category="all"]').click();
    await page.screenshot({ path: output + '/mobile.png', fullPage: true });
    await page.setViewportSize({ width: 320, height: 400 });
    await page.locator('[data-action="buy"]').first().click();
    await page.locator('#hh-local-form button').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#hh-local-form button').isVisible(), true);
    assert.equal(await page.locator('#hh-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.keyboard.press('Escape');
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(failures, []);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  console.log(JSON.stringify({ passed: checks, errors, unexpectedRequests, failures }, null, 2));
} finally { await browser.close(); }
