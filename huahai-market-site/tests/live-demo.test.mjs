import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_READINGS, demoValue, demoSeries } from '../dist/assets/liveDemo.js';

test('演示值：确定性、同一 5 分钟内不变、落在合理区间', () => {
  const t = Date.parse('2026-11-28T06:00:00Z');
  for (const d of DEMO_READINGS) {
    assert.equal(demoValue(d, t), demoValue(d, t + 299_999));
    for (let k = 0; k < 2000; k++) {
      const v = demoValue(d, t + k * 3_600_000);
      assert.ok(v >= 0 && v <= d.base + d.day + d.week + d.noise + 1e-9, `${d.label} ${v}`);
    }
  }
});
test('演示曲线：点数与桶宽和真实曲线一致、时间递增、不超过 to', () => {
  const to = Date.parse('2026-11-28T06:03:00Z');
  for (const [range, n] of [['24h', 288], ['7d', 168], ['30d', 180]]) {
    const pts = demoSeries(DEMO_READINGS[0], range, to);
    assert.equal(pts.length, n);
    assert.ok(pts.every(([t], i) => t <= to && (i === 0 || t > pts[i - 1][0])));
  }
});
