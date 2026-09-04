import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const runtime = process.env.PLAYWRIGHT_MODULE_PATH;
const optimizeDeps = { noDiscovery: true, entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'antd', 'antd/locale/zh_CN', 'react-router-dom', '@ant-design/icons', '@tanstack/react-query', 'dayjs', 'axios', 'zustand', 'zustand/middleware', '@ant-design/pro-components'] };
const delay = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const json = (route, data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
const asset = (id) => ({ asset: { id, status: 'AVAILABLE', objectKey: id, width: 600, height: 600 }, displayUrl: `/fixture-${id}.png`, expiresAt: null });
const plan = (id) => ({ id: `plan-${id}`, sourceAssetId: id, productId: 'product-1', riskProfile: 'CONSERVATIVE_FACTS', recommendedMode: 'PRESERVE_REAL_SCENE', allowedModes: ['PRESERVE_REAL_SCENE'], allowedOperations: [], expiresAt: new Date(Date.now() + 60000).toISOString() });
const quote = (status) => ({ id: 'quote-B', sourceAssetRef: 'B', status, creditCost: 10, candidateCount: 1, quoteHash: 'hash-B', expiresAt: new Date(Date.now() + 60000).toISOString(), rateCardSnapshot: { displayName: 'B方案' }, visualPlanSnapshot: { direction: 'PRESERVE_REAL_SCENE' } });

test('real mounted image flow isolates historical task and completes ISSUED recovery after parent update', { skip: !runtime && 'Set PLAYWRIGHT_MODULE_PATH to an installed playwright/index.mjs; browser coverage not run', timeout: 90000 }, async () => {
  const { chromium } = await import(pathToFileURL(runtime).href);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, optimizeDeps, server: { port: 0, host: '127.0.0.1' }, plugins: [{ name: 'mount-image-section-only', enforce: 'pre', transform(code, id) { return id.split('?')[0].endsWith('/src/pages/products/edit.tsx') ? code.replace('function ImageUploadSection(', 'export function ImageUploadSection(') : undefined; } }] });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let phase = 'history';
  let delayed = delay();
  let started = delay();
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/visual-tasks')) return json(route, { items: [{ quoteId: 'quote-B', displayName: 'B已生成任务', creditCost: 10, createdAt: new Date().toISOString(), executionStatus: 'SUCCEEDED' }], nextCursor: null });
    if (path.endsWith('/visual-enhancements/plan')) {
      const id = route.request().postDataJSON().sourceAssetId;
      if ((phase === 'history' && id === 'A') || (phase === 'issued' && id === 'B')) { started.resolve(); await delayed.promise; }
      return json(route, plan(id));
    }
    if (path.endsWith('/visual-quotes/quote-B')) return json(route, { quote: quote(phase === 'issued' ? 'ISSUED' : 'SETTLED'), billingAccount: { availableCredits: 90, reservedCredits: 0 }, optimization: phase === 'issued' ? null : { id: 'candidate-B', status: 'SUCCEEDED' } });
    if (path.endsWith('/media-assets/B')) return json(route, asset('B'));
    if (path.endsWith('/product-image-optimizations/candidate-B')) return json(route, { id: 'candidate-B', status: 'SUCCEEDED', kind: 'WHITE_BACKGROUND', candidateRole: 'FACT_MAIN_IMAGE', candidate: { assetId: 'candidate-B', displayUrl: '/candidate-B.png' } });
    if (path.endsWith('/visual-credit-account')) return json(route, { availableCredits: 90, reservedCredits: 0 });
    throw new Error(`Unexpected mocked request ${path}`);
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/test/visual-flow-mount.html`);
    await page.getByRole('button', { name: '图片处理记录', exact: true }).click();
    await page.getByText('B已生成任务').waitFor();
    // Dispatch the actual underlying React button while history is open to model
    // an already-queued image action; history switching must invalidate its response.
    await page.getByRole('button', { name: '查看美化建议：原图A.png', exact: true }).evaluate((button) => button.click());
    await started.promise;
    await page.getByRole('button', { name: '查看任务', exact: true }).click();
    await page.locator('img[src="/candidate-B.png"]').waitFor();
    const oldResponse = page.waitForResponse((response) => response.url().endsWith('/visual-enhancements/plan'));
    delayed.resolve();
    await oldResponse;
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('dialog', { name: '智能图片美化建议', exact: true }).count(), 0);
    assert.equal(await page.locator('img[src="/fixture-B.png"]').count() > 0, true);
    assert.equal(await page.locator('img[src="/candidate-B.png"]').count(), 1);

    phase = 'issued'; delayed = delay(); started = delay();
    await page.evaluate(() => localStorage.setItem('ai-visual-agent:active-quote:product-1', 'quote-B'));
    await page.reload();
    await started.promise;
    await page.getByRole('button', { name: '父表单更新', exact: true }).click();
    delayed.resolve();
    await page.getByRole('dialog', { name: '智能图片美化建议', exact: true }).waitFor();
    await page.getByText('B方案', { exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    assert.deepEqual(errors, []);
  } finally { delayed.resolve(); await browser.close(); await server.close(); }
});

test('real mounted free, quote expiry, lost confirmation, close, defer and history retry flows', { skip: !runtime && 'Playwright runtime not configured; browser coverage not run', timeout: 90000 }, async () => {
  const { chromium } = await import(pathToFileURL(runtime).href);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, configFile: `${root}/vite.config.ts`, optimizeDeps, server: { port: 0, host: '127.0.0.1' }, plugins: [{ name: 'mount-image-section-only', enforce: 'pre', transform(code, id) { return id.split('?')[0].endsWith('/src/pages/products/edit.tsx') ? code.replace('function ImageUploadSection(', 'export function ImageUploadSection(') : undefined; } }] });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let freeRequests = 0, confirmRequests = 0, quotes = 0, polls = 0, historyRequests = 0;
  let providerSuccess = false;
  let recovering = false;
  const recoveryStarted = delay(), releaseRecovery = delay();
  const makeQuote = (status = 'ISSUED') => ({ ...quote(status), id: 'quote-A', sourceAssetRef: 'A', quoteHash: 'hash-A', rateCardSnapshot: { displayName: 'A实景精修' }, expiresAt: new Date(Date.now() + (quotes === 1 ? 2500 : 60000)).toISOString() });
  const candidate = (kind = 'BACKGROUND_GENERATION') => ({ id: kind === 'FREE_TUNE' ? 'free-A' : 'paid-A', kind, status: 'SUCCEEDED', candidateRole: 'FACT_MAIN_IMAGE', candidate: { assetId: 'output-A', displayUrl: '/output-A.png' } });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/visual-enhancements/plan')) return json(route, { ...plan('A'), processingPlan: { freeTunePolicy: { contractVersion: 'local-photometric-v2', available: true } } });
    if (path.endsWith('/visual-credit-account')) return json(route, { availableCredits: 100, reservedCredits: 0 });
    if (path.endsWith('/product-image-optimizations') && route.request().method() === 'POST') {
      assert.equal(route.request().postDataJSON().intent, 'FREE_TUNE');
      if (++freeRequests === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: '图片处理暂时繁忙，请重试' } }) });
      return json(route, candidate('FREE_TUNE'));
    }
    if (path.endsWith('/visual-rate-cards/resolve')) return json(route, [{ code: 'paid-A', displayName: 'A实景精修', description: '保留实景', creditCost: 10, candidateCount: 1 }]);
    if (path.endsWith('/visual-quotes')) { quotes++; return json(route, { quote: makeQuote(), account: { availableCredits: 100, reservedCredits: 0 } }); }
    if (path.endsWith('/visual-quotes/quote-A/confirm')) { confirmRequests++; recovering = true; return route.abort('failed'); }
    if (path.endsWith('/visual-quotes/quote-A')) {
      if (recovering) { recoveryStarted.resolve(); await releaseRecovery.promise; recovering = false; }
      return json(route, { quote: makeQuote('RESERVED'), billingAccount: { availableCredits: 90, reservedCredits: 10 }, optimization: null });
    }
    if (path.endsWith('/media-assets/A')) return json(route, asset('A'));
    if (path.endsWith('/visual-quotes/quote-A/poll')) { polls++; return json(route, providerSuccess ? { quoteId: 'quote-A', status: 'SUCCEEDED', optimizationId: 'paid-A' } : { quoteId: 'quote-A', status: 'RUNNING' }); }
    if (path.endsWith('/product-image-optimizations/paid-A')) return json(route, candidate());
    if (path.endsWith('/visual-tasks')) {
      if (++historyRequests === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: '暂时无法读取记录' } }) });
      return json(route, { items: [{ quoteId: 'quote-A', displayName: '已保存的A任务', creditCost: 10, executionStatus: 'SUCCEEDED', createdAt: new Date().toISOString() }], nextCursor: null });
    }
    errors.push(`Unexpected API (including forbidden OCR): ${path}`);
    return route.fulfill({ status: 500, body: 'unexpected request' });
  });
  try {
    const port = server.httpServer.address().port;
    await page.goto(`http://127.0.0.1:${port}/test/visual-flow-mount.html`);
    await page.getByRole('button', { name: '查看美化建议：原图A.png', exact: true }).click();
    // AntD's exiting loading icon remains in the accessible name briefly;
    // match the stable Chinese label while retaining Playwright actionability.
    const freeButton = page.getByRole('button', { name: /生成免费实景优化候选/ });
    await freeButton.waitFor();
    assert.equal(await page.getByRole('button', { name: '检查图片中的商品事实', exact: true }).count(), 0);
    await freeButton.click();
    await page.getByText('免费调优未完成', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('免费调优未完成', { exact: true }).isVisible(), true);
    await freeButton.click();
    await page.locator('img[src="/output-A.png"]').waitFor();
    await page.getByRole('dialog', { name: '实景优化候选', exact: true }).getByRole('button', { name: '返回图片', exact: true }).click();
    await page.getByRole('dialog', { name: '实景优化候选', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(freeRequests, 2);
    assert.equal(confirmRequests, 0);

    await page.getByRole('button', { name: '查看美化建议：原图A.png', exact: true }).click();
    await page.getByRole('button', { name: '查看可用方案与图片积分', exact: true }).click();
    await page.getByRole('button', { name: '获取本方案报价', exact: true }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '更新报价', exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    assert.equal(confirmRequests, 0);
    await page.getByRole('button', { name: '更新报价', exact: true }).click();
    await page.getByRole('button', { name: '查看可用方案与图片积分', exact: true }).click();
    await page.getByRole('button', { name: '获取本方案报价', exact: true }).click();
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '确认图片积分并生成候选', exact: true }).click();
    await recoveryStarted.promise;
    assert.equal(await page.evaluate(() => localStorage.getItem('ai-visual-agent:active-quote:product-1')), 'quote-A');
    releaseRecovery.resolve();
    await page.getByText('任务已存在，正在恢复原任务状态', { exact: true }).waitFor();
    await page.getByRole('button', { name: '返回图片', exact: true }).click();
    await page.waitForResponse((response) => response.url().endsWith('/quote-A/poll'));
    assert.equal(confirmRequests, 1);
    assert.ok(polls > 0);
    providerSuccess = true;
    await page.locator('img[src="/output-A.png"]').waitFor();
    await page.getByRole('button', { name: '暂不采用，选择其他方案', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('ai-visual-agent:active-quote:product-1')), null);
    await page.getByRole('button', { name: '查看美化建议：原图A.png', exact: true }).click();
    await page.getByRole('dialog', { name: '智能图片美化建议', exact: true }).waitFor();
    assert.equal(confirmRequests, 1);
    await page.getByRole('button', { name: '返回图片', exact: true }).click();
    await page.getByRole('button', { name: '图片处理记录', exact: true }).click();
    await page.getByText('图片处理记录暂时无法读取，请重试', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByText('已保存的A任务', { exact: true }).waitFor();
    assert.equal(historyRequests, 2);
    assert.deepEqual(errors, []);
  } catch (error) { throw new Error(`${error.message}\nMock test UI: ${await page.locator('body').innerText()}\nCaptured page errors: ${JSON.stringify(errors)}`, { cause: error }); }
  finally { releaseRecovery.resolve(); await browser.close(); await server.close(); }
});
