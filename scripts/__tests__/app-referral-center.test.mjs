import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('buyer app has a unified referral center with identity-specific sections', () => {
  const referral = read('app/me/referral.tsx');
  const relationUtil = read('src/utils/referralRelation.ts');
  const mePage = read('app/(tabs)/me.tsx');

  assert.match(relationUtil, /label: '推荐中心'/);
  assert.match(relationUtil, /directReferralStatus/);
  assert.match(relationUtil, /INVALIDATED_BY_INVITEE_VIP_UPGRADE/);
  assert.match(mePage, /buildMeReferralToolEntry\(member\)/);
  assert.match(referral, /AppHeader\s+title="推荐中心"/);
  assert.match(referral, /const isVip = member\?\.tier === 'VIP'/);
  assert.match(referral, /const canBindReferrer = !isVip && !hasInviter/);
  assert.match(referral, /rightSlot=\{canBindReferrer \?/);
  assert.match(referral, /normalShareEnabled/);
  assert.match(referral, /\['normal-share-me'\]/);
  assert.match(referral, /\['normal-share-stats'\]/);
  assert.match(referral, /\['normal-share-records'\]/);
  assert.match(referral, /\['vip-referral-records'\]/);
  assert.match(referral, /普通分享码/);
  assert.match(referral, /VIP 推荐码/);
  assert.match(referral, /我的推荐人/);
  assert.match(referral, /最近推荐用户/);
  assert.match(referral, /查看全部推荐用户/);
  assert.match(referral, /router\.push\('\/me\/referral-users'\)/);
});

test('growth center no longer owns referral acquisition modules', () => {
  const growth = read('app/me/growth.tsx');

  assert.match(growth, /赚积分和成长值/);
  assert.match(growth, /升级规则/);
  assert.match(growth, /积分兑换/);
  assert.doesNotMatch(growth, /普通分享码/);
  assert.doesNotMatch(growth, /推荐收益/);
  assert.doesNotMatch(growth, /绑定好友分享码/);
  assert.doesNotMatch(growth, /最近邀请/);
  assert.doesNotMatch(growth, /normalShareEnabled/);
  assert.doesNotMatch(growth, /getNormalShareMe/);
  assert.doesNotMatch(growth, /getNormalShareStats/);
  assert.doesNotMatch(growth, /getNormalShareRecords/);
  assert.doesNotMatch(growth, /bindNormalShareCode/);
});

test('buyer app has a full recommended-user list page for normal and VIP users', () => {
  assert.equal(existsSync('app/me/referral-users.tsx'), true);

  const page = read('app/me/referral-users.tsx');
  const bonusRepo = read('src/repos/BonusRepo.ts');
  const bonusTypes = read('src/types/domain/Bonus.ts');

  assert.match(page, /AppHeader title="推荐用户"/);
  assert.match(page, /BonusRepo\.getReferralRecords/);
  assert.match(page, /GrowthRepo\.getNormalShareRecords/);
  assert.match(page, /rewardStatusLabels/);
  assert.match(page, /relationStatusLabels/);
  assert.match(page, /VIP 推荐/);
  assert.match(page, /普通推荐/);
  assert.match(bonusRepo, /getReferralRecords:\s*async \(\): Promise<Result<VipReferralRecord\[\]>>/);
  assert.match(bonusRepo, /ApiClient\.get<VipReferralRecord\[\]>\('\/bonus\/referral\/records'\)/);
  assert.match(bonusTypes, /export interface VipReferralRecord/);
  assert.match(bonusTypes, /vipPurchasedAt:\s*string \| null/);
  assert.match(bonusTypes, /invitee:\s*\{/);
});

test('referral center does not expose configurable direct-ratio copy on the app page', () => {
  const referral = read('app/me/referral.tsx');

  assert.doesNotMatch(referral, /直推比例/);
  assert.doesNotMatch(referral, /directReferralPercentText/);
  assert.doesNotMatch(referral, /formatPercent/);
  assert.doesNotMatch(referral, /付款时的 VIP 直推比例/);
  assert.doesNotMatch(referral, /付款时的普通直推比例/);
  assert.doesNotMatch(referral, /购买 VIP 礼包本身不单独给推荐人发推荐奖/);
  assert.match(referral, /商品订单奖励会先冻结，确认收货且售后期结束后释放。/);
});

test('backend exposes VIP referral records for the buyer app', () => {
  const controller = read('backend/src/modules/bonus/bonus.controller.ts');
  const service = read('backend/src/modules/bonus/bonus.service.ts');

  assert.match(controller, /@Get\('referral\/records'\)/);
  assert.match(controller, /getReferralRecords\(@CurrentUser\('sub'\) userId: string\)/);
  assert.match(service, /async getReferralRecords\(userId: string\)/);
  assert.match(service, /where:\s*\{\s*inviterUserId:\s*userId\s*\}/);
  assert.match(service, /orderBy:\s*\[\s*\{\s*vipPurchasedAt:\s*'desc'\s*\}/);
});
