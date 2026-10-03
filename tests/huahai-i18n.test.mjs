import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 默认使用 tests/package.json 已有 Playwright；本地也可指定现成运行库路径。
const { chromium } = await import(process.env.HUAHAI_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../huahai-corporate-site/', import.meta.url));
const languages = ['zh-CN', 'en', 'ar', 'fr', 'de', 'ja', 'it', 'pt', 'es', 'zh-TW'];
const pages = ['index', 'about', 'business', 'technology', 'industry', 'contact', 'privacy', 'terms'];
const errors = [];
let server, browser, base;
before(async () => {
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
    try {
      const content = await readFile(file);
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' }[path.extname(file)];
      response.writeHead(200, { 'Content-Type': `${type || 'application/octet-stream'}; charset=utf-8` }).end(content);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.HUAHAI_TEST_CHANNEL ? { channel: process.env.HUAHAI_TEST_CHANNEL } : {}) });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
async function newPage(width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  // 外部字体不可用时也必须排版正常，测试使用系统字体回退。
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}
async function ready(page, language) {
  await page.waitForFunction((code) => document.documentElement.lang === code && !document.querySelector('.language-switch')?.hasAttribute('aria-busy') && getComputedStyle(document.querySelector('.language-switch select')).minHeight === '42px', language);
}

test('all 8 pages render all 10 languages at 320, 390, 1100 and 1440 pixels', { timeout: 180000 }, async () => {
  const page = await newPage();
  for (const width of [320, 390, 1100, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const file of pages) {
      for (const language of languages) {
        await page.goto(`${base}/${file}.html?lang=${language}`, { waitUntil: 'domcontentloaded' });
        await ready(page, language);
        const state = await page.evaluate(() => ({
          dir: document.documentElement.dir,
          overflow: document.documentElement.scrollWidth - innerWidth,
          options: document.querySelector('.language-switch select').options.length,
          selected: document.querySelector('.language-switch select').value,
          notice: !!document.querySelector('.translation-notice:not([hidden])'),
          title: document.title,
        }));
        assert.equal(state.dir, language === 'ar' ? 'rtl' : 'ltr');
        assert.ok(state.overflow <= 1, `${width}px ${file}/${language}: overflow ${state.overflow}`);
        assert.equal(state.options, 10);
        assert.equal(state.selected, language);
        assert.equal(state.notice, ['privacy', 'terms'].includes(file) && language !== 'zh-CN');
        if (!['zh-CN', 'zh-TW', 'ja'].includes(language)) assert.doesNotMatch(state.title, /[\u4e00-\u9fff]/);
      }
    }
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('switching preserves page fragments, language across pages, reloads and Chinese originals', async () => {
  const page = await newPage();
  await page.goto(`${base}/privacy.html?lang=zh-CN&source=test#scope`);
  await ready(page, 'zh-CN');
  const original = await page.locator('main').innerText();
  await page.locator('select').selectOption('fr');
  await ready(page, 'fr');
  assert.equal(new URL(page.url()).hash, '#scope');
  assert.equal(new URL(page.url()).searchParams.get('source'), 'test');
  await page.reload();
  await ready(page, 'fr');
  await page.locator('.translation-notice button').click();
  await ready(page, 'zh-CN');
  assert.equal(await page.locator('main').innerText(), original);
  await page.goto(`${base}/index.html?lang=en`);
  await ready(page, 'en');
  await page.locator('.nav-toggle').click();
  await page.locator('.nav a[data-route="technology.html"]').click();
  await ready(page, 'en');
  assert.equal(new URL(page.url()).searchParams.get('lang'), 'en');
  assert.equal(await page.locator('a[href="https://iot-admin.huahainongke.com/screens"]').count(), 1);
  await page.goto(`${base}/contact.html`);
  await ready(page, 'en');
  assert.equal(await page.locator('a[href="tel:13641421263"]').first().getAttribute('href'), 'tel:13641421263');
  await page.close();
});

test('rapid switches, blocked storage and missing or incomplete locale files recover safely', async () => {
  const page = await newPage();
  await page.goto(`${base}/index.html?lang=en`);
  await ready(page, 'en');
  const title = await page.title();
  await page.route('**/locales/ar.json*', (route) => route.abort());
  await page.locator('select').selectOption('ar');
  await page.locator('.language-status').waitFor({ state: 'visible' });
  assert.equal(await page.title(), title);
  assert.equal(await page.locator('select').inputValue(), 'en');
  assert.equal(new URL(page.url()).searchParams.get('lang'), 'en');
  await page.unroute('**/locales/ar.json*');
  await page.route('**/locales/de.json*', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.locator('select').selectOption('de');
  await page.locator('.language-status').waitFor({ state: 'visible' });
  assert.equal(await page.title(), title);
  await page.unroute('**/locales/de.json*');
  await page.route('**/locales/ar.json*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue().catch(() => {});
  });
  await page.locator('select').selectOption('ar');
  await page.locator('select').selectOption('es');
  await ready(page, 'es');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } }));
  await page.goto(`${base}/index.html?lang=de`);
  await ready(page, 'de');
  assert.ok((await page.locator('.nav a').first().getAttribute('href')).includes('lang=de'));
  await page.goto(`${base}/index.html?lang=invalid`);
  await ready(page, 'zh-CN');
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  await page.close();
  assert.deepEqual(errors, []);
});
