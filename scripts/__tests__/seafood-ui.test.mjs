import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('seafood icon component maps isolated transparent assets', () => {
  const source = read('src/components/ui/SeafoodIcon.tsx');

  for (const name of [
    'lobster',
    'fish',
    'crab',
    'scallop',
    'puffer',
    'seahorse',
    'shrimp',
    'abalone',
    'squid',
    'octopus',
    'oyster',
    'conch',
    'starfish',
    'seaCucumber',
    'supportCrab',
  ]) {
    assert.match(source, new RegExp(`${name}: require\\(`), `${name} should have an isolated asset`);
  }
});

test('me order and tool grids use seafood roles without visible icon frames', () => {
  const me = read('app/(tabs)/me.tsx');

  assert.match(me, /<SeafoodIcon name=\{entry\.icon\} size=\{40\}/);
  assert.match(me, /<SeafoodIcon name=\{tool\.icon\} size=\{43\}/);
  assert.doesNotMatch(me, /style=\{\[styles\.toolIcon, \{ backgroundColor:/);
  assert.match(me, /flexDirection: 'column',\s*gap: 12,/s);
  assert.match(me, /me-shell-ivory\.png/);
  assert.match(me, /me-shell-mint\.png/);
});

test('me lottery card does not report an unknown status as already participated', () => {
  const me = read('app/(tabs)/me.tsx');

  assert.match(me, /lotteryStatus\s*\?\s*hasLotteryChance/s);
  assert.match(me, /进入抽奖页查看今日机会/);
  assert.match(me, /const scheduleNextRefresh = \(\) =>/);
  assert.match(me, /scheduleNextRefresh\(\);\s*\n\s*\}, getMsUntilNextUtc8Midnight\(\) \+ 500\)/);
});

test('all three primary tabs use seafood character icons', () => {
  const tabs = read('app/(tabs)/_layout.tsx');

  assert.match(tabs, /name="home"[\s\S]*?<SeafoodIcon name="puffer"/);
  assert.match(tabs, /name="museum"[\s\S]*?<SeafoodIcon name="starfish"/);
  assert.match(tabs, /name="me"[\s\S]*?<SeafoodIcon name="oyster"/);
  assert.doesNotMatch(tabs, /compass-outline|account-circle-outline|<AiOrb/);
});

test('home keeps the seafood hero in a centered width-based cluster', () => {
  const home = read('app/(tabs)/home.tsx');

  assert.match(home, /getHomeAiStageLayout\(width, spacing\.xl\)/);
  assert.match(home, /width: aiStageLayout\.stageWidth/);
  assert.match(home, /size=\{aiStageLayout\.orbSize\}/);
  assert.match(home, /alignSelf: 'center'/);
  assert.doesNotMatch(home, /marginHorizontal: compactHome/);
  assert.doesNotMatch(home, /homeLobsterCompact|homeCrabCompact|aiStageCompact/);
});

test('home VIP referral and search affordances use distinct seafood characters', () => {
  const home = read('app/(tabs)/home.tsx');

  assert.match(home, /<SeafoodIcon name="scallop" size=\{38\}/);
  assert.match(home, /<SeafoodIcon name="puffer" size=\{32\}/);
  assert.match(home, /styles\.vipReferralIconHalo/);
  assert.match(home, /styles\.searchDivider/);
  assert.doesNotMatch(home, /name="crown-outline"/);
  assert.doesNotMatch(home, /name="magnify"/);

  // 语义明确的操作仍保留原图标，海鲜角色只替换装饰性入口标识。
  assert.match(home, /name="microphone-outline"/);
  assert.match(home, /name="cart-outline"/);
});
