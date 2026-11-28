import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndex, parsePondFile } from '../dist/assets/live.js';
import { homeLivePanel, liveBasePage, livePondPage, liveTitle } from '../dist/assets/pages/live.js';
import { basesGrid, basesPage } from '../dist/assets/pages/bases.js';
import { homePage, demoHeroPanel } from '../dist/assets/pages/home.js';
import { SAMPLE_NOW as now, sampleIndex, samplePond } from '../scripts/live-sample.mjs';
const feed = { status: 'ok', index: parseIndex(sampleIndex(now)) };
const curves = { status: 'ok', file: parsePondFile(samplePond(now), 'yx-00') };

test('塘口页：读数、更新时间、空读数、曲线张数、无内联样式', () => {
  const html = livePondPage('yx-00', feed, curves, '24h', now);
  assert.match(html, /^<div data-live-slot="page">/);
  assert.match(html, /<h1 tabindex="-1" data-heading>永兴 0 号塘<\/h1>/);
  assert.match(html, /tag-ok">实时数据/); assert.match(html, /更新于 14:35/);
  assert.match(html, /data-reading="r1"[^>]*>[\s\S]*?6\.82[\s\S]*?mg\/L/);
  assert.match(html, /data-reading="r5"[^>]*>[\s\S]*?暂无读数/);
  assert.equal((html.match(/<svg class="chart chart-time/g) || []).length, 5); // 4 条真实 + 亚硝酸盐演示（样例已有真实氨氮）
  assert.equal((html.match(/曲线准备中/g) || []).length, 1);
  assert.match(html, /data-range="24h" aria-pressed="true"/); assert.match(html, /data-range="7d" aria-pressed="false"/);
  assert.match(html, /href="#live\/yx"/); assert.match(html, /约每 5 分钟更新一次/);
  assert.equal(/style=|live-banner|rd-stale/.test(html), false);
  assert.match(livePondPage('yx-00', feed, curves, '30d', now), /data-range="30d" aria-pressed="true"/);
});
test('塘口页：整份过期与单项过期不再显示“实时数据”', () => {
  const late = livePondPage('yx-00', feed, curves, '24h', now + 2 * 3_600_000 + 60_000);
  assert.match(late, /live-banner[^>]*>[\s\S]*?实时数据暂时中断，以下为 14:35 的数据/);
  assert.match(late, /rd-stale[\s\S]*?2 小时前的读数/); assert.match(late, /tag-warn">数据中断/);
  assert.equal(late.includes('tag-ok">实时数据'), false);
  assert.match(livePondPage('yx-00', feed, curves, '24h', now + 86_400_000 + 1), /以下为 11-26 14:35 的数据/);
});
test('塘口页：文字转义、载入中、取不到、塘不存在、曲线缺失', () => {
  const raw = sampleIndex(now); raw.bases[0].ponds[0].readings[0].label = '<img src=x onerror=1>'; raw.bases[0].ponds[0].name = '"><b>塘';
  const evil = livePondPage('yx-00', { status: 'ok', index: parseIndex(raw) }, curves, '24h', now);
  assert.equal(/<img src=x|"><b>塘/.test(evil), false); assert.match(evil, /&lt;img src=x/);
  assert.match(livePondPage('yx-00', { status: 'loading' }, { status: 'loading' }, '24h', now), /正在载入实时数据…/);
  assert.match(livePondPage('yx-00', { status: 'unavailable' }, { status: 'missing' }, '24h', now), /实时数据暂时取不到/);
  for (const code of ['yx-99', '<script>', '']) assert.match(livePondPage(code, feed, { status: 'missing' }, '24h', now), /没有找到这口塘/);
  const noCurve = livePondPage('yx-00', feed, { status: 'missing' }, '7d', now);
  assert.equal((noCurve.match(/曲线准备中/g) || []).length, 5); assert.match(noCurve, /6\.82/);
  assert.match(livePondPage('yx-00', feed, { status: 'loading' }, '24h', now), /正在载入曲线…/);
});
test('基地页、基地列表、首页面板、标题', () => {
  const page = liveBasePage('yx', feed, now);
  assert.match(page, /阳江永兴基地/); assert.match(page, /href="#pond\/yx-00"/); assert.match(page, /北纬 [\d.]+°，东经 [\d.]+°/);
  assert.match(liveBasePage('zz', feed, now), /没有找到这个基地/);
  const grid = basesGrid(feed, now);
  assert.match(grid, /^<div class="base-grid base-grid-lg" data-live-slot="bases">/);
  assert.ok(grid.indexOf('阳江永兴基地') < grid.indexOf('阳江海陵岛示范基地'));
  assert.equal((grid.match(/tag-demo/g) || []).length, 3); assert.match(grid, /href="#live\/yx"/);
  assert.equal((basesGrid({ status: 'unavailable' }, now).match(/class="base-card/g) || []).length, 3);
  assert.match(basesPage(grid), /华海农科养殖基地/);
  assert.equal(homeLivePanel({ status: 'unavailable' }, now), null);
  assert.equal(homeLivePanel({ status: 'loading' }, now), null);
  assert.equal(homeLivePanel({ status: 'ok', index: { ...feed.index, bases: [] } }, now), null);
  const panel = homeLivePanel(feed, now);
  assert.match(panel, /data-live-slot="home"/); assert.match(panel, /永兴 0 号塘 · 实时水质/); assert.match(panel, /href="#pond\/yx-00"/);
  assert.equal(panel.includes('暂无读数'), false);
  assert.match(demoHeroPanel(), /data-live-slot="home"[\s\S]*tag-demo/);
  assert.match(homePage(demoHeroPanel()), /data-counter="samples"/);
  assert.deepEqual([liveTitle('pond', 'yx-00', feed), liveTitle('live', 'yx', feed), liveTitle('pond', 'yx-00', { status: 'loading' })], ['永兴 0 号塘', '阳江永兴基地', undefined]);
});

test('索引是新的但这口塘的读数全都过期：标“数据中断”，首页面板去掉跳动圆点', () => {
  const raw = sampleIndex(now);
  for (const r of raw.bases[0].ponds[0].readings) if (r.value !== null) r.observed_at = '2026-11-26T03:00:00Z';
  const stale = { status: 'ok', index: parseIndex(raw) };
  assert.match(livePondPage('yx-00', stale, curves, '24h', now), /tag-warn">数据中断/);
  assert.equal(livePondPage('yx-00', stale, curves, '24h', now).includes('tag-ok">实时数据'), false);
  const panel = homeLivePanel(stale, now);
  assert.match(panel, /数据中断/); assert.equal(panel.includes('live-dot'), false);
  assert.match(basesGrid(stale, now), /live-base[\s\S]*?数据中断/);
  assert.match(liveBasePage('yx', stale, now), /tag-warn">数据中断/);
});
test('曲线文件比索引旧 15 分钟以上时说明曲线截至何时', () => {
  const old = { status: 'ok', file: parsePondFile(samplePond(now - 3_600_000), 'yx-00') };
  assert.match(livePondPage('yx-00', feed, old, '24h', now), /探头曲线截至 13:35/);
  assert.equal(livePondPage('yx-00', feed, curves, '24h', now).includes('探头曲线截至'), false);
});

test('塘口页：氨氮、亚硝酸盐演示读数与曲线，标“演示”，真实读数出现后自动让位', () => {
  const raw = sampleIndex(now); raw.bases[0].ponds[0].readings.splice(3, 1);   // 去掉样例里的真实氨氮
  const noNh3 = { status: 'ok', index: parseIndex(raw) };
  const html = livePondPage('yx-00', noNh3, curves, '24h', now);
  assert.match(html, /data-demo-reading="d1"[\s\S]*?氨氮[\s\S]*?tag-demo[\s\S]*?0\.\d{3}<small> mg\/L/);
  assert.match(html, /data-demo-reading="d2"[\s\S]*?亚硝酸盐[\s\S]*?tag-demo[\s\S]*?0\.\d{3}<small> mg\/L/);
  assert.equal((html.match(/live-curve-demo/g) || []).length, 2);
  assert.match(html, /标“演示”的氨氮、亚硝酸盐为演示数据/);
  assert.match(html, /tag-ok">实时数据/);                       // 演示项不影响实时/中断判断
  assert.equal((livePondPage('yx-00', noNh3, { status: 'missing' }, '30d', now).match(/live-curve-demo[\s\S]*?<svg class="chart chart-time/g) || []).length, 2);
  const real = livePondPage('yx-00', feed, curves, '24h', now);    // 样例有真实氨氮：只演示亚硝酸盐
  assert.equal(real.includes('data-demo-reading="d1"'), false); assert.match(real, /data-demo-reading="d2"/);
  assert.match(real, /标“演示”的亚硝酸盐为演示数据/);
  assert.equal(homeLivePanel(noNh3, now).includes('tag-demo'), false); // 首页面板只放真实读数
  assert.match(html, /aria-label="氨氮（演示）曲线/); assert.match(html, /（标“演示”的项目除外）/);
  assert.equal(/style=/.test(html), false);
  const byMetric = sampleIndex(now); byMetric.bases[0].ponds[0].readings[3].label = '2 号探头'; byMetric.bases[0].ponds[0].readings[3].metric_name = 'NH4+';
  assert.equal(livePondPage('yx-00', { status: 'ok', index: parseIndex(byMetric) }, curves, '24h', now).includes('data-demo-reading="d1"'), false);
  const variant = sampleIndex(now); variant.bases[0].ponds[0].readings[3].label = '亚硝氮'; variant.bases[0].ponds[0].readings[3].metric_name = 'x';
  assert.equal(livePondPage('yx-00', { status: 'ok', index: parseIndex(variant) }, curves, '24h', now).includes('data-demo-reading="d2"'), false);
  const none = sampleIndex(now); none.bases[0].ponds[0].readings = [];
  const empty = livePondPage('yx-00', { status: 'ok', index: parseIndex(none) }, curves, '24h', now);
  assert.match(empty, /这口塘暂未公开读数/); assert.equal(empty.includes('tag-demo'), false);
  const late = livePondPage('yx-00', noNh3, curves, '24h', now + 2 * 3_600_000);
  assert.match(late, /rd-demo rd-demo-off/);
});
