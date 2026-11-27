// 浏览器集成检查：PLAYWRIGHT_MODULE 指向本机已有 Playwright；BASE_URL 默认本地预览。截图写入忽略的 .qa/。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sampleIndex, samplePond } from '../scripts/live-sample.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4319';
const output = fileURLToPath(new URL('../.qa/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [], unexpected = [], failures = [], liveRequests = [];
// 真实数据文件一律由这里模拟：index / pond 为函数时返回其结果，为字符串时原样返回（造坏文件），为 null 时 404。
const liveDefaults = () => ({ index: () => sampleIndex(), pond: () => samplePond(), delayMs: 0 });
let live = liveDefaults();
const isLive = url => new URL(url).pathname.startsWith('/live/v1/');
async function setup(p) {
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !isLive(m.location().url || base)) errors.push(m.text()); });
  p.on('request', r => { if (r.method() !== 'GET' || new URL(r.url()).origin !== new URL(base).origin) unexpected.push(`${r.method()} ${r.url()}`); if (isLive(r.url())) liveRequests.push(new URL(r.url()).pathname); });
  p.on('response', r => { if (r.status() >= 400 && !isLive(r.url())) failures.push(`${r.status()} ${r.url()}`); });
  await p.route('**/live/v1/**', async route => {
    const cur = live, path = new URL(route.request().url()).pathname;
    if (cur.delayMs) await new Promise(r => setTimeout(r, cur.delayMs));
    const src = path === '/live/v1/index.json' ? cur.index : path === '/live/v1/pond-yx-00.json' ? cur.pond : null;
    if (src === null) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: typeof src === 'string' ? src : JSON.stringify(src()) });
  });
  return p;
}
let page = await setup(await browser.newPage({ viewport: { width: 1440, height: 1000 } }));
const iso = ms => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const passed = [];
async function check(name, fn) { await fn(); passed.push(name); }
const heading = () => page.locator('[data-heading]').first().innerText();
const go = async hash => { await page.goto(`${base}/#${hash}`); await page.locator('[data-heading]').first().waitFor(); };
try {
  await check('首页与批次码查询（大小写/空格容错）', async () => {
    await go('home');
    assert.equal(await page.locator('.pcard').count(), 4);
    await page.locator('#hero-code').fill('  hh-yj-2605-02 ');
    await page.locator('#hero-code').press('Enter');
    await page.locator('#sec-ov').waitFor();
    assert.match(await heading(), /金鲳鱼/);
  });
  await check('未知批次、商品、基地、订单显示空态', async () => {
    await go('trace/NOPE-1');
    assert.match(await page.locator('[role=alert]').innerText(), /NOPE-1/);
    for (const [hash, text] of [['product/nope', /没有找到这件商品/], ['base/nope', /没有找到这个基地/], ['order/nope', /没有找到这个订单/]]) { await go(hash); assert.match(await heading(), text); }
    await page.goto(`${base}/#unknown/route`); await page.locator('[data-heading]').first().waitFor();
    assert.match(await page.title(), /首页/);
  });
  await check('商城筛选、排序、深链刷新与返回', async () => {
    await go('shop');
    await page.locator('.seg-i', { hasText: '虾类' }).click();
    await page.waitForURL(/category=/);
    await page.waitForFunction(() => document.querySelectorAll('.pcard').length === 1);
    assert.equal(await page.locator('.pcard').count(), 1);
    await page.goto(`${base}/#shop?sort=price-desc`); await page.locator('.pcard').first().waitFor();
    assert.match(await page.locator('.pcard h3').first().innerText(), /石斑/);
    await page.locator('#shop-q').fill('湛江'); await page.locator('#shop-q').press('Enter');
    await page.waitForURL(/q=/); await page.reload(); await page.locator('.pcard').first().waitFor();
    assert.equal(await page.locator('.pcard').count(), 2);
    await page.locator('#shop-q').fill('不存在的鱼'); await page.locator('#shop-q').press('Enter');
    await page.locator('.empty').waitFor();
    await page.goBack(); await page.locator('.pcard').first().waitFor();
    assert.equal(await page.locator('.pcard').count(), 2);
  });
  await check('排序下拉保持焦点、后退恢复滚动位置', async () => {
    await go('shop');
    await page.locator('#shop-sort').selectOption('sold');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'shop-sort');
    assert.match(page.url(), /sort=sold/);
    await page.setViewportSize({ width: 1440, height: 600 });
    await go('shop');
    await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(100);
    await page.locator('.pcard h3 a').last().click();
    await page.waitForURL(/#product\//); await page.locator('.pd').waitFor();
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.goBack(); await page.locator('.pcard').first().waitFor();
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - 700) < 5);
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('商品详情到溯源档案，水质指标切换', async () => {
    await go('product/pompano');
    await page.locator('a', { hasText: '查看完整溯源档案' }).click();
    await page.waitForURL(/#trace\/HH-YJ-2605-02/);
    await page.locator('#sec-ov').waitFor();
    for (const id of ['sec-lineage', 'sec-timeline', 'sec-feed', 'sec-water', 'sec-lab', 'sec-photo', 'sec-proof']) assert.equal(await page.locator('#' + id).count(), 1, id);
    await page.locator('[data-jump="sec-lab"]').click();
    assert.match(page.url(), /#trace\/HH-YJ-2605-02$/, '目录跳转不能改变路由');
    await page.locator('[data-metric="ph"]').click();
    assert.match(await page.locator('#water-chart svg').getAttribute('aria-label'), /pH/);
    assert.equal(await page.locator('[data-metric="ph"]').getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: output + 'trace-desktop.png', fullPage: true });
  });
  await check('购物车数量边界、删除、空态和演示下单', async () => {
    await go('product/grouper');
    await page.locator('#pd-qty').fill('999'); await page.locator('#pd-qty').dispatchEvent('change');
    assert.equal(await page.locator('#pd-qty').inputValue(), '96');
    await page.locator('#pd-qty').fill('0'); await page.locator('#pd-qty').dispatchEvent('change');
    assert.equal(await page.locator('#pd-qty').inputValue(), '1');
    await page.locator('[data-add-qty="grouper"]').click();
    assert.equal(await page.locator('#cart-count').innerText(), '1');
    await page.locator('#pd-qty').fill('96'); await page.locator('#pd-qty').dispatchEvent('change');
    await page.locator('[data-add-qty="grouper"]').click();
    await page.locator('[data-add-qty="grouper"]').click();
    assert.match(await page.locator('#toast').innerText(), /库存上限/);
    assert.equal(await page.locator('#cart-count').innerText(), '96');
    await go('cart');
    await page.locator('[data-cart-remove="grouper"]').click();
    await go('product/grouper');
    await page.locator('[data-add-qty="grouper"]').click();
    await go('cart');
    await page.locator('[data-cart-step="-1"]').click();
    assert.match(await heading(), /购物车是空的/);
    await go('product/shrimp');
    await page.locator('[data-buy="shrimp"]').click();
    await page.waitForURL(/#checkout/);
    await page.locator('[data-action="pay"]').click();
    await page.waitForURL(/#order\//);
    await page.locator('.success').waitFor();
    assert.match(await heading(), /支付成功/);
    assert.equal(await page.locator('#cart-count').isHidden(), true);
  });
  await check('AI 助手：无上下文、批次上下文、自由提问', async () => {
    await go('home');
    await page.locator('.top-actions [data-action="assistant"]').click();
    assert.match(await page.locator('#ai-log').innerText(), /打开任一商品或批次/);
    await page.locator('#ai-input').fill('这批鱼打过药吗'); await page.locator('#ai-input').press('Enter');
    await page.waitForFunction(() => document.querySelector('#ai-log').innerText.includes('请先打开一个商品'));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#ai-panel').isHidden(), true);
    await go('trace/HH-ZJ-2604-02');
    await page.locator('.top-actions [data-action="assistant"]').click();
    await page.locator('[data-ai-q="1"]').click();
    await page.waitForFunction(() => document.querySelector('#ai-log').innerText.includes('ZJHY-2611-1106'));
    await page.locator('[data-action="ai-close"]').click();
    assert.equal(await page.locator('#ai-panel').isHidden(), true);
  });
  await check('基地塘口切换与 B 端表单预览（XSS 文本输出、关闭清除）', async () => {
    await go('base/mm');
    await page.locator('[data-pond="MM-03"]').click();
    assert.equal(await page.locator('[data-pond="MM-03"]').getAttribute('aria-pressed'), 'true');
    await go('source');
    await page.locator('[data-form="buy"]').click();
    await page.locator('#local-form [name=subject]').fill('<img src=x onerror=alert(1)>');
    await page.locator('#local-form [name=quantity]').fill('2000');
    await page.locator('#local-form [name=date]').fill('2099-01-01');
    await page.locator('#local-form [name=req]').fill('测试');
    await page.locator('#local-form [type=submit]').click();
    assert.match(await page.locator('#form-result').innerText(), /<img src=x/);
    assert.equal(await page.locator('#form-result img').count(), 0);
    await page.locator('[data-action="dlg-close"]').click();
    await page.waitForFunction(() => document.querySelector('#dlg-body').innerHTML === '' && !document.querySelector('#dlg').open);
  });
  await check('多宽度无横向溢出', async () => {
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const hash of ['home', 'shop', 'product/bass', 'trace/HH-MM-2604-01', 'base/zj', 'source', 'work', 'checkout', 'bases', 'live/yx', 'pond/yx-00']) {
        await go(hash);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.equal(over, 0, `${width} ${hash}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await go('trace/HH-YJ-2605-02');
    await page.screenshot({ path: output + 'trace-mobile.png', fullPage: true });
    await go('pond/yx-00'); await page.locator('svg.chart-time').first().waitFor();
    await page.screenshot({ path: output + 'pond-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  const reset = () => { live = liveDefaults(); };
  // 只改 # 的跳转不会重新载入页面，换了模拟数据后要整页重载才会重新取数
  const fresh = async hash => { await page.goto(`${base}/#${hash}`); await page.reload(); await page.locator('[data-heading]').first().waitFor(); };
  const waitText = (sel, re) => page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent ?? ''), [sel, re.source]);
  await check('真实数据正常：基地列表 → 基地 → 塘口，切换范围保持焦点，首页面板', async () => {
    reset();
    await fresh('bases'); await page.locator('.live-base').waitFor();
    const first = page.locator('[data-live-slot="bases"] .base-card').first();
    assert.match(await first.innerText(), /阳江永兴基地[\s\S]*实时数据/);
    await first.click(); await page.waitForURL(/#live\/yx$/); await page.locator('.live-pond').waitFor();
    await page.locator('.live-pond').first().click(); await page.waitForURL(/#pond\/yx-00$/);
    await page.locator('svg.chart-time').first().waitFor();
    assert.equal(await heading(), '永兴 0 号塘');
    assert.equal(await page.locator('[data-reading]').count(), 5);
    assert.equal(await page.locator('svg.chart-time').count(), 4);
    await page.locator('[data-range="7d"]').click();
    assert.equal(await page.locator('[data-range="7d"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.range), '7d');
    await go('home'); await page.locator('.live-panel').waitFor();
    assert.match(await page.locator('[data-live-slot="home"]').innerText(), /永兴 0 号塘 · 实时水质/);
  });
  await check('单项读数过期：变灰并写明多久前，不出整份中断提示', async () => {
    live.index = () => { const x = sampleIndex(); x.bases[0].ponds[0].readings[0].observed_at = iso(Date.now() - 2 * 3_600_000 - 60_000); return x; };
    await fresh('pond/yx-00'); await page.locator('[data-reading="r1"]').waitFor();
    assert.match(await page.locator('[data-reading="r1"]').getAttribute('class'), /rd-stale/);
    assert.match(await page.locator('[data-reading="r1"]').innerText(), /2 小时前的读数/);
    assert.equal(await page.locator('.live-banner').count(), 0);
    assert.equal(await page.locator('.tag-ok', { hasText: '实时数据' }).count(), 1);
    reset();
  });
  await check('整份数据过期：顶部提示中断，不再标“实时数据”', async () => {
    live.index = () => sampleIndex(Date.now() - 3 * 3_600_000);
    await fresh('pond/yx-00'); await page.locator('.live-banner').waitFor();
    assert.match(await page.locator('.live-banner').innerText(), /实时数据暂时中断/);
    assert.equal(await page.locator('.tag-ok', { hasText: '实时数据' }).count(), 0);
    assert.equal(await page.locator('.tag-warn', { hasText: '数据中断' }).count(), 1);
    reset();
  });
  for (const [name, bad] of [['文件缺失', null], ['文件损坏', '{"schema":1,'], ['版本不认识', JSON.stringify({ ...sampleIndex(), schema: 2 })]]) {
    await check(`${name}：首页回到演示、基地只剩演示、塘口页说明取不到、商城照常`, async () => {
      live.index = bad;
      await fresh('home'); await page.waitForFunction(() => !!document.querySelector('[data-live-slot="home"] .tag-demo'));
      await page.waitForTimeout(300);
      assert.match(await page.locator('[data-live-slot="home"]').innerText(), /演示/);
      await go('bases'); await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-live-slot="bases"] .base-card').count(), 3);
      await go('pond/yx-00'); await waitText('[data-heading]', /实时数据暂时取不到/);
      await go('shop'); assert.equal(await page.locator('.pcard').count(), 6);
      reset();
    });
  }
  await check('曲线文件缺失：读数照常，每张曲线写“曲线准备中”', async () => {
    live.pond = null;
    await fresh('pond/yx-00'); await page.locator('[data-reading="r1"]').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.chart-empty').length === 5 && !document.body.innerText.includes('正在载入曲线'));
    assert.match(await page.locator('[data-reading="r1"]').innerText(), /6\.82/);
    reset();
  });
  await check('塘口不存在或代号非法：显示没有找到，不请求曲线文件', async () => {
    for (const hash of ['pond/yx-99', 'pond/%3Cscript%3E']) {
      liveRequests.length = 0;
      await fresh(hash); await waitText('[data-heading]', /没有找到这口塘/);
      await page.waitForTimeout(200);
      assert.equal(liveRequests.filter(x => x.includes('pond-')).length, 0, hash);
    }
  });
  await check('响应很慢时离开：不把别的页面内容换掉', async () => {
    live.delayMs = 1500;
    await page.goto(`${base}/#pond/yx-00`); await page.locator('[data-heading]').first().waitFor();
    await go('shop'); await page.waitForTimeout(2000);
    assert.equal(await page.locator('.pcard').count(), 6);
    assert.match(await page.title(), /买好货/);
    reset();
  });
  await check('定时刷新：60 秒后读数更新，焦点和输入框内容不丢', async () => {
    const clocked = await setup(await browser.newPage({ viewport: { width: 1440, height: 1000 } }));
    await clocked.clock.install();
    await clocked.goto(`${base}/#pond/yx-00`); await clocked.locator('svg.chart-time').first().waitFor();
    await clocked.locator('[data-range="7d"]').click();
    live.index = () => { const x = sampleIndex(); x.bases[0].ponds[0].readings[0].value = 7.11; return x; };
    await clocked.clock.fastForward(61_000);
    await clocked.waitForFunction(() => document.querySelector('[data-reading="r1"]')?.textContent.includes('7.11'));
    assert.equal(await clocked.evaluate(() => document.activeElement?.dataset.range), '7d');
    await clocked.goto(`${base}/#home`); await clocked.locator('.live-panel').waitFor();
    await clocked.locator('#hero-code').fill('HH-');
    await clocked.clock.fastForward(61_000); await clocked.waitForTimeout(300);
    assert.equal(await clocked.locator('#hero-code').inputValue(), 'HH-');
    await clocked.close();
    reset();
  });
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.deepEqual(failures, []);
  console.log(`浏览器检查通过 ${passed.length} 组：\n- ${passed.join('\n- ')}`);
} finally { await browser.close(); }
