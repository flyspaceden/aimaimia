import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Test-only Vite + Chromium mount. Mock admin API responses validate browser
// wiring and payload shape; they do not prove real provider execution, billing,
// deployment, or online acceptance.
const runtime = process.env.PLAYWRIGHT_MODULE_PATH;
const optimizeDeps = {
  noDiscovery: true,
  entries: [],
  include: [
    'react', 'react-dom/client', 'react/jsx-runtime', 'antd', 'antd/locale/zh_CN',
    'react-router-dom', '@ant-design/icons', '@tanstack/react-query', 'dayjs',
    'axios', 'zustand', 'zustand/middleware', '@ant-design/pro-components',
  ],
};

const json = (route, data) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, data }),
});

test('real Chromium links the structure route to STRUCTURE_VERIFY and saves the exact budget payload', {
  skip: !runtime && 'Set PLAYWRIGHT_MODULE_PATH to an installed playwright/index.mjs; browser coverage not run',
  timeout: 90000,
}, async () => {
  const { chromium } = await import(pathToFileURL(runtime).href);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({
    root,
    configFile: `${root}/vite.config.ts`,
    optimizeDeps,
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const unexpectedRequests = [];
  let budgetListRequests = 0;
  let budgetSaveRequests = 0;
  let savedPayload;
  let savedPolicy;

  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith('/welcome-credit-policy') && request.method() === 'GET') return json(route, null);
    if (path.endsWith('/rate-cards') && request.method() === 'GET') return json(route, []);
    if (path.endsWith('/budget-policies') && request.method() === 'GET') {
      budgetListRequests += 1;
      return json(route, savedPolicy ? [savedPolicy] : []);
    }
    if (path.endsWith('/reconciliations') && request.method() === 'GET') return json(route, []);
    if (path.endsWith('/product-paid-visual-candidates') && request.method() === 'GET') return json(route, []);
    if (path.endsWith('/budget-policies') && request.method() === 'POST') {
      budgetSaveRequests += 1;
      savedPayload = request.postDataJSON();
      savedPolicy = {
        id: 'structure-budget-1',
        ...savedPayload,
        timezone: 'Asia/Shanghai',
        effectiveFrom: new Date().toISOString(),
        effectiveUntil: null,
      };
      return json(route, savedPolicy);
    }

    unexpectedRequests.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, body: 'unexpected request in structure budget mount test' });
  });

  try {
    const port = server.httpServer.address().port;
    await page.goto(`http://127.0.0.1:${port}/test/visual-structure-budget-mount.html`);
    await page.getByText('商品图片智能美化管理', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新增预算策略', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: '模型服务预算策略', exact: true });
    await dialog.waitFor();
    const selects = dialog.getByRole('combobox');
    assert.equal(await selects.count(), 3);

    await dialog.locator('.ant-select').nth(1).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="商品结构检查 · qwen3-vl-flash"]').click();

    await dialog.locator('.ant-select').nth(2).click();
    const structureOption = page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="商品结构检查"]');
    await structureOption.waitFor();
    assert.equal(await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="保留真实场景"]').count(), 0);
    await structureOption.click();

    const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/visual-agent/budget-policies') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存预算策略', exact: true }).click();
    await saveResponse;
    await page.getByText('预算策略已保存；同范围旧活动版本已自动停用', { exact: true }).waitFor();

    assert.deepEqual(savedPayload, {
      scope: 'PLATFORM',
      scopeKey: 'GLOBAL',
      provider: 'BAILIAN_QWEN_STRUCTURE',
      model: 'qwen3-vl-flash',
      visualMode: 'STRUCTURE_VERIFY',
      reserveCents: 20,
      perTaskCapCents: 50,
      dailyCapCents: 500,
      weeklyCapCents: 2000,
      policyVersion: 'v1',
      enabled: false,
    });
    assert.equal(budgetSaveRequests, 1);
    assert.ok(budgetListRequests >= 1);
    assert.deepEqual(unexpectedRequests, []);
    assert.deepEqual(pageErrors, []);
  } catch (error) {
    throw new Error(`${error.message}\nStructure budget mount UI: ${await page.locator('body').innerText()}\nCaptured page errors: ${JSON.stringify(pageErrors)}\nUnexpected requests: ${JSON.stringify(unexpectedRequests)}`, { cause: error });
  } finally {
    await browser.close();
    await server.close();
  }
});
