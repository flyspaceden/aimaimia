import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const detailSource = readFileSync('app/group-buy/[activityId].tsx', 'utf8');
const checkoutSource = readFileSync('app/group-buy/checkout.tsx', 'utf8');
const groupBuyIndexSource = readFileSync('app/group-buy/index.tsx', 'utf8');
const currentPanelSource = readFileSync('src/components/group-buy/GroupBuyCurrentPanel.tsx', 'utf8');
const groupBuySummaryRule = '团购不退换，仅24小时质量问题补发。';

test('group-buy app rules count direct referrals from other users, not only brand-new users', () => {
  assert.equal(detailSource.includes('全新用户'), false);
  assert.match(detailSource, /仅统计直接推荐的其他用户购买同款商品/);
});

test('group-buy app rules disclose that only VIP purchases accumulate consumption assets', () => {
  const vipAssetRule = /VIP用户购买团购后会累计消费资产，普通用户不累计消费资产/;
  assert.match(detailSource, vipAssetRule);
  assert.match(checkoutSource, vipAssetRule);
});

test('group-buy index places summary rules in the hero copy and removes duplicate note surfaces', () => {
  assert.equal(groupBuyIndexSource.includes('当前上架的指定团购商品，购买前可查看价格、运费和活动条件。'), false);
  assert.equal(groupBuyIndexSource.includes('styles.complianceBar'), false);
  assert.equal(groupBuyIndexSource.includes('complianceBar:'), false);
  assert.equal(groupBuyIndexSource.includes('仅一级直接推荐;好友付款后返还冻结，确认收货后释放;'), false);
  assert.match(groupBuyIndexSource, new RegExp(groupBuySummaryRule));

  const heroRuleIndex = groupBuyIndexSource.indexOf(groupBuySummaryRule);
  const heroMarkIndex = groupBuyIndexSource.indexOf('styles.heroMark');
  assert.ok(heroRuleIndex > -1 && heroMarkIndex > -1 && heroRuleIndex < heroMarkIndex);

  assert.equal(currentPanelSource.includes('好友付款后返还先冻结，好友确认收货后释放。'), false);
});
