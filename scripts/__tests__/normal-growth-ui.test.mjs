import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('me profile card routes ordinary share entry to the referral center', () => {
  const homeSource = read('app/(tabs)/home.tsx');
  const identityCardSource = read('src/components/cards/MeIdentityCard.tsx');

  assert.match(homeSource, /const showNormalShareEntry =/);
  assert.match(homeSource, /showNormalShareEntry=\{showNormalShareEntry\}/);
  assert.match(homeSource, /onNormalSharePress=\{\(\) => router\.push\('\/me\/referral'\)\}/);
  assert.match(homeSource, /const isVip = member\?\.tier === 'VIP'/);
  assert.match(identityCardSource, /showNormalShareEntry \? \(/);
  assert.match(identityCardSource, /推荐中心/);
  assert.match(identityCardSource, /onNormalSharePress/);
});

test('growth repo exposes buyer-visible guide sourced from backend rules', () => {
  const repo = read('src/repos/GrowthRepo.ts');
  const types = read('src/types/domain/Growth.ts');

  assert.match(types, /export type GrowthGuideRule =/);
  assert.match(types, /export type GrowthGuide =/);
  assert.match(repo, /getGuide:\s*\(\): Promise<Result<GrowthGuide>>/);
  assert.match(repo, /ApiClient\.get<GrowthGuide>\('\/growth\/guide'\)/);
});

test('growth center explains earning tasks, level rules, and exchange without referral acquisition modules', () => {
  const source = read('app/me/growth.tsx');
  const types = read('src/types/domain/Growth.ts');

  assert.match(source, /queryKey:\s*\['growth-guide'\]/);
  assert.match(source, /赚积分和成长值/);
  assert.match(source, /升级规则/);
  assert.match(source, /成长值用于升级，不会因为积分兑换而减少/);
  assert.match(source, /积分用于兑换红包和权益，兑换时会消耗/);
  assert.match(source, /积分兑换/);
  assert.match(source, /formatRewardText/);
  assert.match(source, /formatLimitText/);
  assert.match(types, /relationStatus\?:/);
  assert.doesNotMatch(source, /relationStatusLabels/);
  assert.doesNotMatch(source, /推荐收益/);
  assert.doesNotMatch(source, /普通分享码/);
  assert.doesNotMatch(source, /最近邀请/);
});

test('me page separates referral center from points growth', () => {
  const meSource = read('app/(tabs)/me.tsx');
  const growthSource = read('app/me/growth.tsx');

  assert.match(meSource, /const normalGrowthTool =/);
  assert.match(meSource, /const growthToolLabel = '耕耘值'/);
  assert.match(meSource, /label: growthToolLabel/);
  assert.match(meSource, /buildMeReferralToolEntry\(member\)/);
  assert.match(meSource, /\.\.\.TOOL_GRID_BASE/);
  assert.match(growthSource, /BonusRepo\.getMember/);
  assert.match(growthSource, /const isVip = member\?\.tier === 'VIP'/);
  assert.match(growthSource, /会员状态加载失败/);
  assert.match(growthSource, /AppHeader title="耕耘值"/);
  assert.doesNotMatch(growthSource, /normalShareEnabled/);
  assert.doesNotMatch(growthSource, /getNormalShareMe/);
  assert.doesNotMatch(growthSource, /getNormalShareRecords/);
});

test('referral center explains normal and VIP referral separately', () => {
  const growthSource = read('app/me/growth.tsx');
  const referralSource = read('app/me/referral.tsx');

  assert.match(referralSource, /AppHeader\s+title="推荐中心"/);
  assert.match(referralSource, /普通分享码/);
  assert.match(referralSource, /VIP 推荐码/);
  assert.match(referralSource, /我的推荐人/);
  assert.match(referralSource, /推荐奖励/);
  assert.match(referralSource, /最近推荐用户/);
  assert.match(referralSource, /查看全部推荐用户/);
  assert.match(referralSource, /router\.push\('\/me\/referral-users'\)/);
  assert.doesNotMatch(growthSource, /你推荐的好友成为 VIP/);
  assert.doesNotMatch(growthSource, /好友后续普通商品订单按/);
});

test('scanner separates VIP referral links from ordinary share links', () => {
  const source = read('app/me/scanner.tsx');

  assert.match(source, /type ScannedInviteCode = \{ type: 'vip' \| 'normal' \| 'auto'; code: string \}/);
  assert.match(source, /const bindInviteCode = async/);
  assert.match(source, /shouldTryNormalShareFallback/);
  assert.match(source, /payload\.type === 'auto' && payload\.code\.startsWith\('S'\)/);
  assert.match(source, /GrowthRepo\.bindNormalShareCode\(payload\.code\)/);
  assert.match(source, /BonusRepo\.useReferralCode\(payload\.code\)/);
  assert.ok(source.includes("com\\/s\\/([A-Za-z0-9]{8})"));
  assert.ok(source.includes("com\\/r\\/([A-Za-z0-9]{8})"));
  assert.match(source, /推荐码或普通分享码/);
  assert.match(source, /手动输入推荐码或普通分享码/);
  assert.match(source, /bindMutation\.mutate\(\{ type: 'auto', code: trimmed \}\)/);
  assert.match(source, /const renderManualInputSheet =/);
  assert.match(source, /没有相机权限也可以手动输入/);
});

test('invite binding success refreshes member and growth caches across app entry points', () => {
  const layoutSource = read('app/_layout.tsx');
  const referralSource = read('app/me/referral.tsx');

  assert.match(layoutSource, /function invalidateInviteBindingQueries\(\)/);
  assert.match(layoutSource, /\['bonus-member'\]/);
  assert.match(layoutSource, /\['growth-me'\]/);
  assert.match(layoutSource, /\['normal-share-records'\]/);
  assert.match(layoutSource, /\['normal-share-stats'\]/);
  assert.match(layoutSource, /if \(result\.ok\) invalidateInviteBindingQueries\(\)/);
  assert.match(layoutSource, /if \(normalResult\.ok\) invalidateInviteBindingQueries\(\)/);
  assert.match(referralSource, /queryClient\.invalidateQueries\(\{ queryKey: \['bonus-member'\] \}\)/);
  assert.match(referralSource, /queryClient\.invalidateQueries\(\{ queryKey: \['growth-me'\] \}\)/);
});

test('admin growth page presents unified points growth accounts without duplicating VIP referral management', () => {
  const source = read('admin/src/pages/growth/index.tsx');
  const referrals = read('admin/src/pages/referrals/index.tsx');
  const layout = read('admin/src/layouts/AdminLayout.tsx');
  const treeViewer = read('admin/src/pages/bonus/components/TreeViewer.tsx');

  assert.match(layout, /name: '积分成长'/);
  assert.match(layout, /name: '推荐与拉新'/);
  assert.match(source, /积分成长只管理积分、成长值、等级、兑换和流水/);
  assert.match(source, /成长账户总数/);
  assert.match(source, /普通用户 \/ VIP 用户/);
  assert.match(source, /积分余额/);
  assert.match(source, /成长账户/);
  assert.match(source, /用户身份/);
  assert.doesNotMatch(source, /title: '推荐码'/);
  assert.doesNotMatch(source, /title: '直推关系'/);
  assert.doesNotMatch(source, /普通分享只服务普通用户拉新/);
  assert.doesNotMatch(source, /label: '自动升级'/);
  assert.match(referrals, /普通推荐关系/);
  assert.match(referrals, /VIP 推荐码/);
  assert.match(referrals, /自动升级 VIP/);
  assert.match(referrals, /进入的 VIP 上级/);
  assert.match(treeViewer, /growth: '积分成长'/);
  assert.doesNotMatch(source, /key: 'vipShare'/);
  assert.doesNotMatch(source, /label: 'VIP 推荐'/);
  assert.match(source, /\{ label: '新手', value: 'NEWBIE' \}/);
  assert.match(source, /\{ label: '邀请', value: 'INVITE' \}/);
  assert.doesNotMatch(source, /\{ label: '新手', value: 'ONBOARDING' \}/);
});

test('admin growth page explains configuration workflow and rule effects for operators', () => {
  const source = read('admin/src/pages/growth/index.tsx');

  assert.match(source, /Alert/);
  assert.match(source, /积分=可消耗/);
  assert.match(source, /成长值=不可消耗/);
  assert.match(source, /配置顺序/);
  assert.match(source, /先开全局/);
  assert.match(source, /再配行为/);
  assert.match(source, /最后配兑换/);
  assert.match(source, /已接入/);
  assert.match(source, /未接入/);
  assert.match(source, /发放时机/);
  assert.match(source, /生效状态/);
  assert.match(source, /toggleRuleMutation/);
  assert.match(source, /checkedChildren="生效"/);
  assert.match(source, /unCheckedChildren="停用"/);
  assert.match(source, /disabled=\{!wired \|\| toggleRuleMutation\.isPending\}/);
  assert.match(source, /未接入的行为不能启用/);
  assert.match(source, /disabled=\{!!editingRule && !wiredBehaviorCodes\.has\(editingRule\.code\)\}/);
  assert.match(source, /用户看到什么/);
  assert.match(source, /applicableUserTypeLabels/);
  assert.doesNotMatch(source, /title: '接入状态'/);
  assert.doesNotMatch(source, /title: '等级编码'/);
  assert.doesNotMatch(source, /<Typography\.Text type="secondary" code>/);
  assert.doesNotMatch(source, /<Tag color=\{record\.enabled \? 'green' : 'default'\}>/);
  assert.doesNotMatch(source, /value === 'ALL' \? '全部' : value/);
  assert.match(source, /ruleResizableTable/);
  assert.match(source, /components=\{ruleResizableTable\.components\}/);
});

test('admin growth exchange only offers dedicated coupon pools', () => {
  const source = read('admin/src/pages/growth/index.tsx');

  assert.match(source, /exchangeAvailableCouponCampaigns/);
  assert.match(source, /exchangeTypeOptions/);
  assert.match(source, /couponExchangeTypes\.has\(value\)/);
  assert.match(source, /campaign\.distributionMode === 'MANUAL'/);
  assert.match(source, /campaign\.growthExchangeEnabled === true/);
  assert.match(source, /campaign\.issuedCount < campaign\.totalQuota/);
  assert.match(source, /label="积分兑换专用红包池"/);
  assert.match(source, /只显示红包管理中已标记“积分兑换专用”的手动发放红包池/);
  assert.match(source, /请先到红包管理创建并标记“积分兑换专用”的手动发放红包活动/);
  assert.match(source, /renderExchangeCampaignOption/);
  assert.match(source, /optionLabelProp="title"/);
  assert.match(source, /whiteSpace: 'normal'/);
  assert.doesNotMatch(source, /formatExchangeCampaignOptionLabel/);
  assert.doesNotMatch(source, /装饰权益和抽奖机会用于后续权益扩展/);
});

test('growth defaults are shipped in a production migration, not only in seed data', () => {
  const migrationPath =
    'backend/prisma/migrations/20260704133000_seed_growth_defaults/migration.sql';

  assert.equal(existsSync(migrationPath), true);

  const migration = read(migrationPath);
  assert.match(migration, /INSERT INTO "GrowthBehaviorCategory"/);
  assert.match(migration, /INSERT INTO "GrowthLevel"/);
  assert.match(migration, /INSERT INTO "GrowthBehaviorRule"/);
  assert.match(migration, /NORMAL_INVITE_REGISTER/);
  assert.match(migration, /NORMAL_INVITE_FIRST_ORDER/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
});

test('unwired growth behavior rules are disabled until their event handlers exist', () => {
  const migrationPath =
    'backend/prisma/migrations/20260704143000_disable_unwired_growth_rules/migration.sql';
  const disabledCodes = [
    'COMPLETE_PROFILE',
    'BIND_PHONE_OR_WECHAT',
    'BROWSE_PRODUCTS',
    'FAVORITE_ITEM',
    'SHARE_CONTENT',
    'REVIEW_ORDER',
    'VIP_PURCHASE',
  ];

  assert.equal(existsSync(migrationPath), true);

  const migration = read(migrationPath);
  assert.match(migration, /UPDATE "GrowthBehaviorRule"/);
  assert.match(migration, /SET "enabled" = false/);
  for (const code of disabledCodes) {
    assert.match(migration, new RegExp(`'${code}'`));
  }

  const seed = read('backend/prisma/seed.ts');
  for (const code of disabledCodes) {
    const line = seed.split('\n').find((item) => item.includes(`code: '${code}'`));
    assert.ok(line, `missing seed rule for ${code}`);
    assert.match(line, /enabled: false/, `${code} should default to disabled`);
  }
});

test('normal invite register growth rule is re-enabled after its bind handler is wired', () => {
  const migrationPath =
    'backend/prisma/migrations/20260704150500_enable_normal_invite_register_growth/migration.sql';

  assert.equal(existsSync(migrationPath), true);

  const migration = read(migrationPath);
  assert.match(migration, /UPDATE "GrowthBehaviorRule"/);
  assert.match(migration, /SET "enabled" = true/);
  assert.match(migration, /'NORMAL_INVITE_REGISTER'/);

  const seed = read('backend/prisma/seed.ts');
  const line = seed.split('\n').find((item) => item.includes("code: 'NORMAL_INVITE_REGISTER'"));
  assert.ok(line, 'missing seed rule for NORMAL_INVITE_REGISTER');
  assert.doesNotMatch(line, /enabled: false/);
});
