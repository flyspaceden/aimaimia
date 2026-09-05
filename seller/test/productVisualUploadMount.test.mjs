import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const runtime = process.env.PLAYWRIGHT_MODULE_PATH;
const optimizeDeps = { noDiscovery: true, entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'antd', 'antd/locale/zh_CN', 'react-router-dom', '@ant-design/icons', '@tanstack/react-query', 'dayjs', 'axios', 'zustand', 'zustand/middleware', '@ant-design/pro-components'] };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('actual multipart upload distinguishes transferred bytes from server processing and rejects invalid files locally', {
  skip: !runtime && 'Playwright runtime not configured; actual upload coverage not run', timeout: 60000,
}, async () => {
  const { chromium } = await import(pathToFileURL(runtime).href);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bodyReceived = deferred(), releaseResponse = deferred();
  let uploads = 0, receivedBytes = 0, receivedBody = Buffer.alloc(0), contentType = '';
  const server = await createServer({
    root, configFile: `${root}/vite.config.ts`, optimizeDeps, server: { port: 0, host: '127.0.0.1' },
    plugins: [{ name: 'mount-upload-only', enforce: 'pre',
      transform(code, id) { return id.split('?')[0].endsWith('/src/pages/products/edit.tsx') ? code.replace('function ImageUploadSection(', 'export function ImageUploadSection(') : undefined; },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.method !== 'POST' || req.url?.split('?')[0] !== '/api/v1/seller/media-assets/product-images') return next();
          uploads++; contentType = String(req.headers['content-type']);
          const chunks = [];
          req.on('data', (chunk) => { chunks.push(chunk); receivedBytes += chunk.length; });
          req.on('end', () => {
            receivedBody = Buffer.concat(chunks);
            bodyReceived.resolve();
            void releaseResponse.promise.then(() => {
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, data: { asset: { id: 'uploaded-transport', status: 'AVAILABLE', objectKey: 'transport.png', width: 128, height: 128 }, displayUrl: '/fixture-upload.png', expiresAt: null } }));
            });
          });
        });
      },
    }],
  });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const port = server.httpServer.address().port;
    await page.goto(`http://127.0.0.1:${port}/test/visual-flow-mount.html`);
    await page.getByRole('button', { name: '图片处理记录', exact: true }).waitFor();
    const encoded = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
      const context = canvas.getContext('2d'); context.fillStyle = '#c85b38'; context.fillRect(0, 0, 128, 128);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const file = Buffer.from(encoded, 'base64');
    // A real File is sent through the production customRequest/Axios XHR.
    // No page.route or synthetic progress callbacks are installed.
    await page.locator('input[type="file"]').setInputFiles({ name: 'transport.png', mimeType: 'image/png', buffer: file });
    await bodyReceived.promise;
    assert.equal(uploads, 1);
    assert.match(contentType, /^multipart\/form-data; boundary=/);
    assert.ok(receivedBytes > file.length);
    assert.ok(receivedBody.includes(file));
    await page.getByText('图片已传输，服务器正在处理，请稍候。', { exact: true }).waitFor();
    assert.equal(await page.locator('.ant-upload-list-item-uploading').count(), 1);
    assert.equal(await page.getByRole('button', { name: /查看美化建议：transport.png/ }).count(), 0);
    await page.waitForTimeout(1200);
    assert.equal(await page.getByText('图片已传输，服务器正在处理，请稍候。', { exact: true }).isVisible(), true);
    assert.equal(await page.locator('.ant-upload-list-item-uploading').count(), 1);
    releaseResponse.resolve();
    await page.getByRole('button', { name: /查看美化建议：transport.png/ }).waitFor();
    await page.getByText('图片上传成功，可以查看美化建议。', { exact: true }).waitFor();
    assert.equal(await page.locator('.ant-upload-list-item-uploading').count(), 0);

    await page.locator('input[type="file"]').setInputFiles({ name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await page.getByText('仅支持 JPG、PNG 或 WebP 图片', { exact: true }).waitFor();
    assert.equal(uploads, 1);
    await page.locator('input[type="file"]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid PNG content') });
    await page.getByText('图片无法读取或内容已损坏，请重新导出后上传', { exact: true }).waitFor();
    assert.equal(uploads, 1);
    assert.equal(await page.getByRole('button', { name: /查看美化建议：broken.png/ }).count(), 0);
    assert.deepEqual(pageErrors, []);
  } catch (error) {
    throw new Error(`${error.message}\nUpload test UI: ${await page.locator('body').innerText()}`, { cause: error });
  } finally { releaseResponse.resolve(); await browser.close(); await server.close(); }
});
