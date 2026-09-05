import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// This is a test-only Vite + Chromium mount. Mock API responses prove the
// seller wiring and retry behavior; they are not online or provider acceptance.
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

const sourceAsset = (id) => ({
  asset: { id, status: 'AVAILABLE', objectKey: id, width: 600, height: 600 },
  displayUrl: `/fixture-${id}.png`,
  expiresAt: null,
});

const candidatePng = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
  31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130,
]);

test('real Chromium restores a SUCCEEDED marketing candidate and retries its attachment download', {
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
    plugins: [{
      name: 'mount-image-section-only',
      enforce: 'pre',
      transform(code, id) {
        return id.split('?')[0].endsWith('/src/pages/products/edit.tsx')
          ? code.replace('function ImageUploadSection(', 'export function ImageUploadSection(')
          : undefined;
      },
    }],
  });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  const unexpectedRequests = [];
  let historyRequests = 0;
  let quoteRequests = 0;
  let sourceAssetRequests = 0;
  let candidateRequests = 0;
  let downloadRequests = 0;
  let confirmRequests = 0;
  let adoptRequests = 0;

  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/fixture-A.png', async (route) => route.fulfill({ contentType: 'image/png', body: candidatePng }));
  await page.route('**/marketing-candidate.png', async (route) => route.fulfill({ contentType: 'image/png', body: candidatePng }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith('/visual-tasks') && request.method() === 'GET') {
      historyRequests += 1;
      return json(route, {
        items: [{
          quoteId: 'quote-marketing',
          sourceAssetRef: 'A',
          billingStatus: 'SETTLED',
          executionStatus: 'SUCCEEDED',
          optimization: { id: 'marketing-task', status: 'SUCCEEDED' },
          direction: 'MARKETING_SCENE',
          displayName: 'AI 营销场景图',
          creditCost: 10,
          candidateCount: 1,
          createdAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          settledAt: new Date().toISOString(),
        }],
        nextCursor: null,
      });
    }
    if (path.endsWith('/visual-quotes/quote-marketing') && request.method() === 'GET') {
      quoteRequests += 1;
      return json(route, {
        quote: {
          id: 'quote-marketing',
          status: 'SETTLED',
          externalObjectId: 'external-marketing',
          sourceAssetRef: 'A',
          creditCost: 10,
          candidateCount: 1,
          rateCardSnapshot: { displayName: 'AI 营销场景图', description: '仅用于营销展示' },
          visualPlanSnapshot: { direction: 'MARKETING_SCENE' },
          quoteHash: 'hash-marketing',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        billingAccount: { availableCredits: 90, reservedCredits: 0 },
        optimization: { id: 'marketing-task', status: 'SUCCEEDED' },
      });
    }
    if (path.endsWith('/media-assets/A') && request.method() === 'GET') {
      sourceAssetRequests += 1;
      return json(route, sourceAsset('A'));
    }
    if (path.endsWith('/product-image-optimizations/marketing-task') && request.method() === 'GET') {
      candidateRequests += 1;
      return json(route, {
        id: 'marketing-task',
        status: 'SUCCEEDED',
        kind: 'BACKGROUND_GENERATION',
        candidateRole: 'MARKETING_IMAGE',
        adoptionAllowed: false,
        candidate: {
          assetId: 'candidate-marketing',
          displayUrl: '/marketing-candidate.png',
          expiresAt: null,
        },
      });
    }
    if (path.endsWith('/product-image-optimizations/marketing-task/download') && request.method() === 'GET') {
      downloadRequests += 1;
      if (downloadRequests === 1) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: { message: '候选图片暂时无法读取，请稍后重试' } }),
        });
      }
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-disposition': 'attachment; filename="product-image-marketing.png"',
          'cache-control': 'private, no-store',
        },
        body: candidatePng,
      });
    }
    if (path.endsWith('/visual-quotes/quote-marketing/confirm')) {
      confirmRequests += 1;
      return route.fulfill({ status: 500, body: 'confirm must not be called while recovering an existing candidate' });
    }
    if (path.endsWith('/product-image-optimizations/marketing-task/adopt')) {
      adoptRequests += 1;
      return route.fulfill({ status: 500, body: 'adopt must not be called by the download flow' });
    }

    unexpectedRequests.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, body: 'unexpected request in download mount test' });
  });

  try {
    const port = server.httpServer.address().port;
    await page.goto(`http://127.0.0.1:${port}/test/visual-flow-mount.html`);
    await page.getByRole('button', { name: '图片处理记录', exact: true }).click();
    await page.getByText('AI 营销场景图', { exact: true }).waitFor();
    await page.getByRole('button', { name: '查看任务', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'AI 营销场景候选（仅预览）', exact: true });
    await dialog.waitFor();
    await page.locator('img[src="/marketing-candidate.png"]').waitFor();
    await page.getByText('可下载用于营销展示，请标注 AI 生成；不能作为商品数量或包装规格的实物证据。', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '确认采用候选', exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: '下载图片', exact: true }).count(), 1);

    const downloadButton = dialog.getByRole('button', { name: /下载图片$/ });
    await downloadButton.click();
    await page.getByText('图片下载失败，请稍后重试；不会再次扣除图片积分。', { exact: true }).waitFor();
    assert.equal(downloadRequests, 1);

    const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
    assert.equal(download.suggestedFilename(), '商品美化图片.png');
    const downloadPath = await download.path();
    assert.ok(downloadPath);
    assert.deepEqual(readFileSync(downloadPath), candidatePng);
    assert.equal(downloadRequests, 2);
    assert.equal(await page.getByText('图片下载失败，请稍后重试；不会再次扣除图片积分。', { exact: true }).count(), 0);

    assert.equal(historyRequests, 1);
    assert.equal(quoteRequests, 1);
    assert.equal(sourceAssetRequests, 1);
    assert.equal(candidateRequests, 1);
    assert.equal(confirmRequests, 0);
    assert.equal(adoptRequests, 0);
    assert.deepEqual(unexpectedRequests, []);
    assert.deepEqual(pageErrors, []);
  } catch (error) {
    throw new Error(`${error.message}\nDownload mount UI: ${await page.locator('body').innerText()}\nCaptured page errors: ${JSON.stringify(pageErrors)}\nUnexpected requests: ${JSON.stringify(unexpectedRequests)}`, { cause: error });
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
