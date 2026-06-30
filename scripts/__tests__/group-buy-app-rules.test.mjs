import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const detailSource = readFileSync('app/group-buy/[activityId].tsx', 'utf8');
const checkoutSource = readFileSync('app/group-buy/checkout.tsx', 'utf8');

test('group-buy app rules count direct referrals from other users, not only brand-new users', () => {
  assert.equal(detailSource.includes('全新用户'), false);
  assert.match(detailSource, /仅统计直接推荐的其他用户购买同款商品/);
});

test('group-buy app rules disclose that only VIP purchases accumulate consumption assets', () => {
  const vipAssetRule = /VIP用户购买团购后会累计消费资产，普通用户不累计消费资产/;
  assert.match(detailSource, vipAssetRule);
  assert.match(checkoutSource, vipAssetRule);
});
