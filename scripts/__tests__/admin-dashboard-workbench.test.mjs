import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const service = readFileSync('backend/src/modules/admin/stats/admin-stats.service.ts', 'utf8');
const controller = readFileSync('backend/src/modules/admin/stats/admin-stats.controller.ts', 'utf8');
const dashboard = readFileSync('admin/src/pages/dashboard/index.tsx', 'utf8');
const statsApi = readFileSync('admin/src/api/stats.ts', 'utf8');
const types = readFileSync('admin/src/types/index.ts', 'utf8');
const groupBuyActivities = readFileSync('admin/src/pages/group-buy/activities.tsx', 'utf8');

test('admin dashboard statistics come from one audited operations overview endpoint', () => {
  assert.match(controller, /@Get\('operations-overview'\)[\s\S]*@RequirePermission\('dashboard:read'\)/);
  assert.match(service, /async getOperationsOverview\(\)/);
  assert.match(statsApi, /getOperationsOverview/);
  assert.match(types, /interface OperationsOverview/);
  assert.match(dashboard, /queryKey:\s*\['admin',\s*'operations-overview'\]/);
  assert.doesNotMatch(dashboard, /getProducts|getCompanies|getWithdrawals|getAfterSales|getBonusStats/);
});

test('operations overview uses payment-success time and active-window filters for reliable data', () => {
  assert.match(service, /const startOfDay = this\.startOfChinaDay\(\)/);
  assert.match(service, /const paidOrderWhere = \{[\s\S]*paidAt:\s*\{\s*gte:\s*startOfDay\s*\}/);
  assert.match(service, /this\.prisma\.payment\.groupBy\(\{[\s\S]*paidAt:\s*\{\s*gte:\s*startOfDay\s*\}/);
  assert.match(service, /SELECT DATE\("paidAt" \+ INTERVAL '8 hours'\) as date, COUNT\(\*\)::bigint as count/);
  assert.match(service, /AND status IN \('PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'\)/);
  assert.match(service, /const drawDate = this\.todayChinaDate\(\)/);
  assert.match(service, /lotteryRecord\.count\(\{ where: \{ drawDate \} \}\)/);
  assert.match(service, /this\.prisma\.couponCampaign\.count\(\{[\s\S]*status:\s*'ACTIVE'[\s\S]*startAt:\s*\{\s*lte:\s*now\s*\}[\s\S]*endAt:\s*\{[\s\S]*gte:\s*now/);
  assert.match(service, /afterSaleSellerReviews/);
  assert.match(service, /afterSaleReturns/);
});

test('admin dashboard displays operator-friendly sections and guidance', () => {
  for (const text of ['今日经营', '待办中心', '资金与奖励', '活动增长', '经营脉搏', '处理优先级']) {
    assert.match(dashboard, new RegExp(text));
  }
  assert.match(dashboard, /暂无待办/);
  assert.match(dashboard, /60 秒刷新/);
  assert.match(dashboard, /paymentChannelText/);
  assert.match(dashboard, /orderStatusText/);
  assert.doesNotMatch(dashboard, /title:\s*'提现失败'/);
});

test('group buy activity tier removal callback keeps explicit types for admin build', () => {
  assert.match(groupBuyActivities, /\.filter\(\(_:\s*GroupBuyTierConfig,\s*index:\s*number\)/);
  assert.match(groupBuyActivities, /\.map\(\(tier:\s*GroupBuyTierConfig,\s*index:\s*number\)/);
});
