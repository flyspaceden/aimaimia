import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('admin separates points growth from referral acquisition management', () => {
  assert.equal(existsSync('admin/src/pages/referrals/index.tsx'), true);

  const layout = read('admin/src/layouts/AdminLayout.tsx');
  const app = read('admin/src/App.tsx');
  const growth = read('admin/src/pages/growth/index.tsx');
  const referrals = read('admin/src/pages/referrals/index.tsx');
  const buyerIdentityText = read('admin/src/components/BuyerIdentityText.tsx');

  assert.match(layout, /path: '\/growth', name: '积分成长'/);
  assert.match(layout, /path: '\/referrals'[\s\S]{0,80}name: '推荐与拉新'/);
  assert.match(layout, /path: '\/referrals'[\s\S]{0,260}PERMISSIONS\.GROWTH_READ/);
  assert.match(layout, /PERMISSIONS\.USERS_READ/);
  assert.match(layout, /PERMISSIONS\.VIP_GIFT_READ/);
  assert.match(app, /const ReferralsPage = lazy\(\(\) => import\('@\/pages\/referrals\/index'\)\)/);
  assert.match(app, /<Route path="referrals" element=\{<ReferralsPage \/>\} \/>/);

  assert.match(growth, /message="积分成长只管理积分、成长值、等级、兑换和流水"/);
  assert.doesNotMatch(growth, /getNormalShareBindings/);
  assert.doesNotMatch(growth, /disableNormalShareProfile/);
  assert.doesNotMatch(growth, /enableNormalShareProfile/);
  assert.doesNotMatch(growth, /key: 'share'/);
  assert.doesNotMatch(growth, /key: 'auto-vip'/);
  assert.doesNotMatch(growth, /name="autoVipBySpendEnabled"/);
  assert.doesNotMatch(growth, /name="autoVipCumulativeSpendThreshold"/);
  assert.doesNotMatch(growth, /title: '推荐码'/);
  assert.doesNotMatch(growth, /title: '直推关系'/);

  assert.match(referrals, /普通推荐关系/);
  assert.match(referrals, /VIP 推荐码/);
  assert.match(referrals, /自动升级 VIP/);
  assert.match(referrals, /VIP 转化设置/);
  assert.match(referrals, /getNormalShareBindings/);
  assert.match(referrals, /getMembers/);
  assert.match(referrals, /getGrowthLedgers/);
  assert.match(referrals, /autoVipBySpendEnabled/);
  assert.match(referrals, /enabled:\s*canReadGrowth/);
  assert.match(referrals, /enabled:\s*canReadBonus/);
  assert.match(referrals, /canReadNormalShare\s*\?\s*\{/);
  assert.match(referrals, /canReadBonus\s*\?\s*\{/);
  assert.match(referrals, /canReadGrowth\s*\?\s*\{/);
  assert.match(referrals, /filter\(Boolean\) as TabsProps\['items'\]/);
  assert.match(referrals, /key: 'auto-vip-settings'[\s\S]{0,120}forceRender:\s*true/);
  assert.match(buyerIdentityText, /copyable\?: boolean/);
  assert.match(growth, /renderUser\(record\.user,\s*\{\s*copyable:\s*false\s*\}\)/);
});

test('admin core user reward tables opt into resizable columns', () => {
  assert.equal(existsSync('admin/src/components/table/useResizableColumns.tsx'), true);

  const hook = read('admin/src/components/table/useResizableColumns.tsx');
  assert.match(hook, /function ResizableHeaderCell/);
  assert.match(hook, /useResizableColumns/);
  assert.match(hook, /components:\s*\{\s*header:\s*\{\s*cell:\s*ResizableHeaderCell\s*\}/s);
  assert.match(hook, /data-resizable-column/);
  assert.match(hook, /localStorage/);

  for (const pagePath of [
    'admin/src/pages/users/index.tsx',
    'admin/src/pages/bonus/members.tsx',
    'admin/src/pages/growth/index.tsx',
    'admin/src/pages/referrals/index.tsx',
  ]) {
    const page = read(pagePath);
    assert.match(page, /useResizableColumns/, `${pagePath} should use resizable columns`);
    assert.match(page, /components=\{[^}]*resizableTable\.components/s, `${pagePath} should wire table components`);
    assert.match(page, /scroll=\{\{\s*x:\s*resizableTable\.tableWidth/s, `${pagePath} should use computed table width`);
  }
});

test('admin user and vip member tables send server-side sort params', () => {
  const usersPage = read('admin/src/pages/users/index.tsx');
  const usersApi = read('admin/src/api/app-users.ts');
  const usersService = read('backend/src/modules/admin/app-users/admin-app-users.service.ts');
  const usersController = read('backend/src/modules/admin/app-users/admin-app-users.controller.ts');

  assert.match(usersPage, /request=\{async \(params,\s*sort\)/);
  assert.match(usersPage, /getAppUserSortParams\(sort/);
  assert.match(usersPage, /sortField:\s*sortParams\.sortField/);
  assert.match(usersPage, /sortOrder:\s*sortParams\.sortOrder/);
  for (const field of ['memberTier', 'status', 'orderCount', 'createdAt']) {
    const start = usersPage.indexOf(`dataIndex: '${field}'`);
    assert.notEqual(start, -1, `${field} column should exist`);
    assert.match(usersPage.slice(start, start + 260), /sorter:\s*true/, `${field} should be sortable`);
  }
  assert.match(usersApi, /sortField\?:\s*AppUserSortField/);
  assert.match(usersController, /@Query\('sortField'\) sortField\?: string/);
  assert.match(usersService, /private buildUserOrderBy/);
  assert.match(usersService, /orders:\s*\{\s*_count:\s*direction\s*\}/);

  const membersPage = read('admin/src/pages/bonus/members.tsx');
  const bonusApi = read('admin/src/api/bonus.ts');
  const bonusService = read('backend/src/modules/admin/bonus/admin-bonus.service.ts');
  const bonusController = read('backend/src/modules/admin/bonus/admin-bonus.controller.ts');

  assert.match(membersPage, /request=\{async \(params,\s*sort\)/);
  assert.match(membersPage, /getBonusMemberSortParams\(sort/);
  assert.match(membersPage, /sortField:\s*sortParams\.sortField/);
  assert.match(membersPage, /sortOrder:\s*sortParams\.sortOrder/);
  for (const field of ['vipPurchasedAt', 'selfPurchaseCount', 'createdAt']) {
    assert.match(membersPage, new RegExp(`dataIndex: ${field === 'selfPurchaseCount' ? "'selfPurchaseCount'" : `'${field}'`}[\\s\\S]{0,260}sorter:\\s*true`));
  }
  assert.match(bonusApi, /sortField\?:\s*BonusMemberSortField/);
  assert.match(bonusController, /@Query\('sortField'\) sortField\?: string/);
  assert.match(bonusService, /private buildMemberOrderBy/);
});

test('admin user table shows each user current recommendation code', () => {
  const usersPage = read('admin/src/pages/users/index.tsx');
  const usersTypes = read('admin/src/types/index.ts');
  const usersService = read('backend/src/modules/admin/app-users/admin-app-users.service.ts');

  assert.match(usersPage, /title: '推荐码'/);
  assert.match(usersPage, /renderRecommendationCode/);
  assert.match(usersPage, /https:\/\/app\.ai-maimai\.com\/r\/\$\{code\}/);
  assert.match(usersPage, /https:\/\/app\.ai-maimai\.com\/s\/\$\{code\}/);
  assert.match(usersPage, /普通分享码已停用/);
  assert.match(usersTypes, /normalShareCode\?:\s*string \| null/);
  assert.match(usersTypes, /normalShareStatus\?:\s*string \| null/);
  assert.match(usersTypes, /vipReferralCode\?:\s*string \| null/);
  assert.match(usersService, /normalShareProfile:\s*\{\s*select:\s*\{\s*code:\s*true,\s*status:\s*true\s*\},?\s*\}/);
  assert.match(usersService, /vipReferralCode:\s*user\.memberProfile\?\.tier === 'VIP'/);
  assert.match(usersService, /normalShareCode:\s*user\.memberProfile\?\.tier === 'VIP' \? null : user\.normalShareProfile\?\.code/);
});

test('referral page tables support sortable relation and upgrade dates', () => {
  const referrals = read('admin/src/pages/referrals/index.tsx');
  const growthApi = read('admin/src/api/growth.ts');
  const growthTypes = read('admin/src/types/index.ts');
  const growthDto = read('backend/src/modules/admin/growth/dto/admin-growth.dto.ts');
  const growthService = read('backend/src/modules/admin/growth/admin-growth.service.ts');

  assert.match(referrals, /getNormalShareSortParams\(sort/);
  assert.match(referrals, /sortField:\s*sortParams\.sortField/);
  assert.match(referrals, /sortOrder:\s*sortParams\.sortOrder/);
  for (const field of ['boundAt', 'rewardIssuedAt', 'updatedAt']) {
    const start = referrals.indexOf(`dataIndex: '${field}'`);
    assert.notEqual(start, -1, `${field} column should exist`);
    assert.match(referrals.slice(start, start + 260), /sorter:\s*true/, `${field} should be sortable`);
  }
  assert.match(growthApi, /AdminNormalShareBindingQueryParams/);
  assert.match(growthTypes, /sortField\?:\s*'boundAt'\s*\|\s*'rewardIssuedAt'\s*\|\s*'updatedAt'/);
  assert.match(growthDto, /@IsIn\(\['boundAt', 'rewardIssuedAt', 'updatedAt'\]\)/);
  assert.match(growthService, /private buildNormalShareOrderBy/);
  assert.match(referrals, /getLedgerSortParams\(sort/);
  assert.match(referrals, /behaviorCode:\s*'AUTO_VIP_UPGRADE'[\s\S]{0,220}sortBy:\s*sortParams\.sortBy/);
  assert.match(growthTypes, /sortBy\?:\s*'createdAt'\s*\|\s*'pointsDelta'\s*\|\s*'growthDelta'/);
  assert.match(growthDto, /@IsIn\(\['createdAt', 'pointsDelta', 'growthDelta'\]\)/);
  assert.match(growthService, /private buildLedgerOrderBy/);
});

test('growth ledger table sends server-side sort params', () => {
  const growthPage = read('admin/src/pages/growth/index.tsx');

  assert.match(growthPage, /getLedgerSortParams\(sort/);
  assert.match(growthPage, /sortBy:\s*sortParams\.sortBy/);
  assert.match(growthPage, /sortOrder:\s*sortParams\.sortOrder/);
  for (const field of ['pointsDelta', 'growthDelta', 'createdAt']) {
    const start = growthPage.indexOf(`dataIndex: '${field}'`);
    assert.notEqual(start, -1, `${field} column should exist`);
    assert.match(growthPage.slice(start, start + 300), /sorter:\s*true/, `${field} should be sortable`);
  }
});
