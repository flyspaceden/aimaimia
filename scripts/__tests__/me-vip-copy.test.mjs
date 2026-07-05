import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('me tab VIP card uses shipping discount entitlement copy', () => {
  const meTab = read('app/(tabs)/me.tsx');

  assert.match(meTab, /· 减免运费权益/);
  assert.doesNotMatch(meTab, /· 免运费/);
});

test('VIP page does not promise instant cash reward on VIP activation', () => {
  const vipPage = read('app/me/vip.tsx');

  assert.match(vipPage, /好友后续普通商品订单按/);
  assert.doesNotMatch(vipPage, /好友成功开通，您即得现金奖励/);
});
