import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('admin growth page labels seeded categories and clarifies ordinary account scope', () => {
  const source = read('admin/src/pages/growth/index.tsx');

  assert.match(source, /普通买家账户/);
  assert.match(source, /\{ label: '新手', value: 'NEWBIE' \}/);
  assert.match(source, /\{ label: '邀请', value: 'INVITE' \}/);
  assert.doesNotMatch(source, /\{ label: '新手', value: 'ONBOARDING' \}/);
});
