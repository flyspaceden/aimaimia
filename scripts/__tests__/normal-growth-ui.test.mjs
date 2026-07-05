import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('me profile card shows ordinary share code entry only for non-VIP users', () => {
  const source = read('app/(tabs)/me.tsx');

  assert.match(source, /const showNormalShareEntry =/);
  assert.match(source, /showNormalShareEntry \? \(/);
  assert.match(source, /普通推荐码/);
  assert.match(source, /router\.push\('\/me\/growth'\)/);
  assert.match(source, /const isVip = member\?\.tier === 'VIP'/);
});

test('growth repo exposes buyer-visible guide sourced from backend rules', () => {
  const repo = read('src/repos/GrowthRepo.ts');
  const types = read('src/types/domain/Growth.ts');

  assert.match(types, /export type GrowthGuideRule =/);
  assert.match(types, /export type GrowthGuide =/);
  assert.match(repo, /getGuide:\s*\(\): Promise<Result<GrowthGuide>>/);
  assert.match(repo, /ApiClient\.get<GrowthGuide>\('\/growth\/guide'\)/);
});

test('growth center explains invite rewards, earning tasks, and level rules', () => {
  const source = read('app/me/growth.tsx');

  assert.match(source, /queryKey:\s*\['growth-guide'\]/);
  assert.match(source, /推荐收益/);
  assert.match(source, /赚积分和成长值/);
  assert.match(source, /升级规则/);
  assert.match(source, /成长值用于升级，不会因为积分兑换而减少/);
  assert.match(source, /普通积分用于兑换红包和权益，兑换时会消耗/);
  assert.match(source, /formatRewardText/);
  assert.match(source, /formatLimitText/);
});

test('VIP users see member growth instead of ordinary growth and ordinary share modules', () => {
  const meSource = read('app/(tabs)/me.tsx');
  const growthSource = read('app/me/growth.tsx');

  assert.match(meSource, /const normalGrowthTool =/);
  assert.match(meSource, /const growthToolLabel = memberData\?\.ok \? \(isVip \? '会员成长' : '普通成长'\) : '成长中心'/);
  assert.match(meSource, /label: growthToolLabel/);
  assert.match(meSource, /\.\.\.TOOL_GRID_BASE/);
  assert.match(growthSource, /BonusRepo\.getMember/);
  assert.match(growthSource, /const memberLoadFailed = Boolean\(memberQuery\.data && !memberQuery\.data\.ok\)/);
  assert.match(growthSource, /const isVip = member\?\.tier === 'VIP'/);
  assert.match(growthSource, /const normalShareEnabled = Boolean\(isLoggedIn && memberQuery\.data\?\.ok && !isVip\)/);
  assert.match(growthSource, /const growthTitle = memberLoaded \? \(isVip \? '会员成长' : '普通成长'\) : '成长中心'/);
  assert.match(growthSource, /会员状态加载失败/);
  assert.match(growthSource, /\{isVip \? \(/);
  assert.match(growthSource, /VIP 推荐权益/);
  assert.match(growthSource, /router\.push\('\/me\/referral'\)/);
  assert.match(growthSource, /普通分享码/);
  assert.match(growthSource, /最近邀请/);
});

test('VIP growth page explains how member growth and VIP referral should be used', () => {
  const growthSource = read('app/me/growth.tsx');

  assert.match(growthSource, /VIP 成长与推荐/);
  assert.match(growthSource, /会员成长怎么用/);
  assert.match(growthSource, /推荐好友怎么操作/);
  assert.match(growthSource, /积分和成长值怎么获得/);
  assert.match(growthSource, /普通分享码仅普通用户拉新使用/);
  assert.match(growthSource, /去分享 VIP 推荐码/);
});

test('admin growth page presents unified points growth accounts without duplicating VIP referral management', () => {
  const source = read('admin/src/pages/growth/index.tsx');
  const layout = read('admin/src/layouts/AdminLayout.tsx');
  const treeViewer = read('admin/src/pages/bonus/components/TreeViewer.tsx');

  assert.match(layout, /name: '积分成长'/);
  assert.match(source, /积分成长配置顺序/);
  assert.match(source, /成长账户总数/);
  assert.match(source, /普通用户 \/ VIP 用户/);
  assert.match(source, /积分余额/);
  assert.match(source, /成长账户/);
  assert.match(source, /用户身份/);
  assert.match(source, /VIP 推荐码/);
  assert.match(source, /查看 VIP 详情/);
  assert.match(source, /查看 VIP 奖励树/);
  assert.match(source, /普通分享只服务普通用户拉新/);
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
  assert.match(source, /用户看到什么/);
  assert.match(source, /scroll=\{\{ x: 1600 \}\}/);
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
