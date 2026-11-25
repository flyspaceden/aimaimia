import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHash, escapeHtml } from '../dist/assets/model.js';
import { products, batches, findBatch, findProduct, findPond, findBase, waterSeries, complianceRate, metricRange, totalFeedKg, traceCompleteness, aiAnswers, liveReading, inPond } from '../dist/assets/data.js';

test('路由解析：带 ID、未知路由、坏编码', () => {
  assert.deepEqual([parseRoute('#trace/HH-YJ-2605-02').name, parseRoute('#trace/HH-YJ-2605-02').id], ['trace', 'HH-YJ-2605-02']);
  assert.equal(parseRoute('#nope/123').name, 'home');
  assert.equal(parseRoute('#nope/123').id, '');
  assert.equal(parseRoute('#product/%E0%A4%A').id, '');
  assert.equal(parseRoute('').name, 'home');
});

test('路由往返：商城筛选与工作台状态', () => {
  const r = parseRoute(routeHash({ name: 'shop', category: '虾类', sort: 'price-asc', query: '对虾' }));
  assert.deepEqual([r.name, r.category, r.sort, r.query], ['shop', '虾类', 'price-asc', '对虾']);
  assert.equal(parseRoute('#shop?category=bad&sort=bad').category, 'all');
  assert.equal(parseRoute(routeHash({ name: 'work', status: 'quoted' })).status, 'quoted');
});

test('每个商品都能找到批次、基地和塘', () => {
  assert.equal(products.length, 6);
  for (const p of products) {
    const b = findBatch(p.batchCode);
    assert.ok(b, p.id);
    assert.equal(b.productId, p.id);
    assert.ok(findBase(b.baseId));
    assert.ok(findPond(b.pondId));
    for (const node of b.lineage) assert.ok(findPond(node.pondId), node.pondId);
  }
  assert.equal(findBatch(' hh-yj-2605-02 ')?.code, 'HH-YJ-2605-02');
  assert.equal(findBatch('HH-NOPE'), undefined);
  assert.equal(findProduct(undefined), undefined);
  for (const b of inPond) assert.ok(findPond(b.pondId));
});

test('水质序列确定、长度等于养殖天数、预警日越线', () => {
  const b = findBatch('HH-YJ-2605-02');
  const a1 = waterSeries(b, 'do'), a2 = waterSeries(b, 'do');
  assert.deepEqual(a1, a2);
  assert.equal(a1[0].day, b.stockDate);
  assert.equal(a1.at(-1).day, b.harvestDate);
  assert.ok(a1.find(p => p.day === '2026-07-21').value < 5);
  const rate = complianceRate(a1, metricRange('do', 'marine'));
  assert.ok(rate > 95 && rate < 100);
  assert.equal(complianceRate([], [0, 1]), 0);
});

test('汇总、完整度、AI 回答只引用档案事实', () => {
  for (const b of batches) {
    assert.equal(totalFeedKg(b), b.feeds.reduce((s, f) => s + f.kg, 0));
    assert.ok(traceCompleteness(b) >= 80);
    const answers = aiAnswers(b);
    assert.ok(answers.length >= 5);
    assert.ok(answers.some(x => x.a.includes(b.code)));
  }
  assert.ok(findBatch('HH-YJ-2605-02').lineage.length >= 2);
  assert.deepEqual(liveReading('YJ-02', 5), liveReading('YJ-02', 5));
});

test('HTML 转义', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a">'&`), '&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;');
});
