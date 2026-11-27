import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIndex, parsePondFile, isPondCode, isBaseCode, findLivePond, findLiveBase, featuredPond, isFeedStale, readingState, ageText, stamp, valueText, liveRanges } from '../dist/assets/live.js';
import { SAMPLE_NOW, sampleIndex, samplePond } from '../scripts/live-sample.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/live-v1/${name}`, import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const reading = idx => idx.bases[0].ponds[0].readings[0];

test('提交的样例文件与样例生成函数一致', () => {
  assert.deepEqual(fixture('index.json'), sampleIndex(SAMPLE_NOW));
  assert.deepEqual(fixture('pond-yx-00.json'), samplePond(SAMPLE_NOW));
});
test('解析：样例通过，多余的键被丢弃', () => {
  const raw = sampleIndex(SAMPLE_NOW); raw.secret = 'x'; reading(raw).device_sn = 'SN1'; raw.bases[0].manager = '张三';
  const idx = parseIndex(raw);
  assert.equal(idx.bases[0].ponds[0].code, 'yx-00');
  assert.equal(/SN1|张三|secret/.test(JSON.stringify(idx)), false);
  assert.deepEqual(parseIndex(sampleIndex(SAMPLE_NOW)), sampleIndex(SAMPLE_NOW));
  assert.deepEqual(parseIndex({ ...sampleIndex(SAMPLE_NOW), bases: [] }).bases, []);
});
test('解析：违反契约一律返回 null', () => {
  const mutate = fn => { const raw = sampleIndex(SAMPLE_NOW); fn(raw); return raw; };
  const bad = [null, [], 'x', {}, mutate(r => { r.schema = 2; }), mutate(r => { r.generated_at = 'yesterday'; }),
    mutate(r => { r.generated_at = '2026-11-26 14:35'; }), mutate(r => { r.company = {}; }),
    mutate(r => { r.bases[0].code = 'YX'; }), mutate(r => { r.bases[0].ponds[0].code = 'yx_00'; }), mutate(r => { r.bases[0].ponds = []; }),
    mutate(r => { r.bases.push(clone(r.bases[0])); }),                       // 塘代号重复
    mutate(r => { r.bases[0].lat = 91; }), mutate(r => { r.bases[0].ponds[0].area_value = 0; }),
    mutate(r => { reading(r).value = '6.8'; }), mutate(r => { reading(r).value = null; }), // 有时间没数值
    mutate(r => { reading(r).observed_at = null; }), mutate(r => { reading(r).label = 5; }), mutate(r => { reading(r).label = ''; }),
    mutate(r => { reading(r).key = 'do'; }), mutate(r => { r.bases[0].ponds[0].readings[1].key = 'r1'; }),
    mutate(r => { r.bases[0].ponds[0].readings = Array.from({ length: 25 }, (_, i) => ({ ...reading(r), key: `r${i}` })); }),
    mutate(r => { reading(r).label = 'x'.repeat(41); })];
  for (const raw of bad) assert.equal(parseIndex(raw), null, JSON.stringify(raw)?.slice(0, 80));
  assert.equal(parseIndex(JSON.parse('{"schema":1,"generated_at":"2026-11-26T06:35:00Z","company":{"name":"a"},"bases":[{"code":"yx","name":"b","province":"","city":"","district":"","address":"","lat":1e999,"lng":0,"ponds":[]}]}')), null);
});
test('曲线文件解析', () => {
  const ok = parsePondFile(samplePond(SAMPLE_NOW), 'yx-00');
  assert.deepEqual([ok.series['24h'][0].points.length, ok.series['7d'][0].points.length, ok.series['30d'][0].points.length], [288, 168, 180]);
  const mutate = fn => { const raw = samplePond(SAMPLE_NOW); fn(raw); return raw; };
  assert.equal(parsePondFile(samplePond(SAMPLE_NOW), 'yx-01'), null);
  for (const raw of [mutate(r => { delete r.series['7d']; }), mutate(r => { r.series['1y'] = []; }),
    mutate(r => { r.series['24h'][0].points[3] = [1]; }), mutate(r => { r.series['24h'][0].points[3][1] = null; }),
    mutate(r => { r.series['24h'][0].points[3][0] = r.series['24h'][0].points[2][0]; }),   // 时间不递增
    mutate(r => { const p = r.series['7d'][0].points; r.series['7d'][0].points = [...p, ...p.map(([t, v]) => [t + 1e12, v])]; }), // 超过 200 点
    mutate(r => { r.series['24h'].push(clone(r.series['24h'][0])); })])
    assert.equal(parsePondFile(raw, 'yx-00'), null);
  assert.deepEqual(parsePondFile(mutate(r => { r.series = { '24h': [], '7d': [], '30d': [] }; }), 'yx-00').series['24h'], []);
});
test('过期判断：整份 15 分钟、单项 30 分钟，服务器时钟偏快不算过期', () => {
  const idx = sampleIndex(SAMPLE_NOW), [r1, , , , r5] = idx.bases[0].ponds[0].readings;
  assert.equal(isFeedStale(idx, SAMPLE_NOW + 900_000), false);
  assert.equal(isFeedStale(idx, SAMPLE_NOW + 900_001), true);
  assert.equal(isFeedStale(idx, SAMPLE_NOW - 3_600_000), false);
  assert.equal(readingState(r1, SAMPLE_NOW), 'fresh');
  assert.equal(readingState(r1, Date.parse(r1.observed_at) + 1_800_001), 'stale');
  assert.equal(readingState(r1, SAMPLE_NOW - 3_600_000), 'fresh');
  assert.equal(readingState(r5, SAMPLE_NOW), 'none');
});
test('时间与数值文字', () => {
  assert.deepEqual([ageText(-5), ageText(59_000), ageText(35 * 60_000), ageText(2 * 3_600_000 + 1), ageText(49 * 3_600_000)], ['刚刚', '刚刚', '35 分钟前', '2 小时前', '2 天前']);
  assert.equal(stamp('2026-11-26T06:35:00Z', SAMPLE_NOW), '14:35');
  assert.equal(stamp('2026-11-25T16:05:00Z', SAMPLE_NOW), '00:05');          // 北京时间已是 26 日
  assert.equal(stamp('2026-11-25T06:35:00Z', SAMPLE_NOW), '11-25 14:35');
  assert.deepEqual([valueText(6.816), valueText(24.31), valueText(35210.4), valueText(0.031), valueText(-3.14159)], ['6.82', '24.3', '35210', '0.03', '-3.14']);
  assert.deepEqual(liveRanges.map(r => [r.id, r.label, r.spanMs / r.bucketMs]), [['24h', '24小时', 288], ['7d', '7天', 168], ['30d', '30天', 180]]);
});
test('查找与首页用哪口塘', () => {
  const idx = parseIndex(sampleIndex(SAMPLE_NOW));
  assert.equal(findLivePond(idx, 'yx-00').base.code, 'yx');
  assert.equal(findLivePond(idx, 'yx-99'), undefined);
  assert.equal(findLiveBase(idx, 'yx').name, '阳江永兴基地');
  assert.equal(featuredPond(idx).pond.code, 'yx-00');
  const empty = clone(idx); for (const r of empty.bases[0].ponds[0].readings) { r.value = null; r.observed_at = null; }
  assert.equal(featuredPond(empty), undefined);
  assert.deepEqual([isPondCode('yx-00'), isPondCode('yx'), isPondCode('../x'), isBaseCode('yx'), isBaseCode('Y X')], [true, false, false, true, false]);
});
