import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const files = {
  orders: 'admin/src/pages/orders/index.tsx',
  couponInstances: 'admin/src/pages/coupons/instances.tsx',
  couponCampaigns: 'admin/src/pages/coupons/campaigns.tsx',
  lottery: 'admin/src/pages/lottery/index.tsx',
  groupBuyInstances: 'admin/src/pages/group-buy/instances.tsx',
  groupBuyOrders: 'admin/src/pages/group-buy/orders.tsx',
  groupBuyRebateLedgers: 'admin/src/pages/group-buy/rebate-ledgers.tsx',
};

test('second batch business record pages expose buyer suggestion filters', () => {
  for (const [name, path] of Object.entries({
    orders: files.orders,
    couponInstances: files.couponInstances,
    lottery: files.lottery,
    groupBuyInstances: files.groupBuyInstances,
    groupBuyOrders: files.groupBuyOrders,
    groupBuyRebateLedgers: files.groupBuyRebateLedgers,
  })) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /BuyerSuggestInput/, `${name} should render BuyerSuggestInput`);
    assert.match(source, /dataIndex:\s*'userId'/, `${name} should submit a userId buyer filter`);
    assert.match(source, /placeholder="搜索并选择买家编号、手机号或昵称"/, `${name} should use a selection-oriented placeholder`);
  }
});

test('manual coupon issue uses shared buyer multi-select with infinite loading', () => {
  const source = readFileSync(files.couponCampaigns, 'utf8');

  assert.match(source, /BuyerNoMultiSelect/);
  assert.match(source, /manualIssueBuyerNosText/);
  assert.doesNotMatch(source, /loadManualIssueUsers/);
  assert.doesNotMatch(source, /getAppUsers/);
});

test('admin group-buy userId filters accept selected public buyer numbers', () => {
  const service = readFileSync('backend/src/modules/admin/group-buy/admin-group-buy.service.ts', 'utf8');

  assert.match(service, /resolveBuyerUserId/);
  assert.match(service, /where\.userId = await resolveBuyerUserId\(this\.prisma, options\.userId\)/);
});
