import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('home keeps the cart in the brand header and gives search the former group-buy slot', () => {
  const home = read('app/(tabs)/home.tsx');
  const heroStatement = home.indexOf('{HOME_HERO_STATEMENT}');
  const cartRoute = home.indexOf("router.push('/cart')");
  const identityCard = home.indexOf('<MeIdentityCard');
  const vipReferralStrip = home.indexOf('vipReferralPrompt ?');
  const searchRow = home.indexOf('styles.searchRow');
  const aiStage = home.indexOf('styles.aiStage');

  assert.ok(heroStatement > 0, 'consumer productivity statement should render on home');
  assert.ok(cartRoute > heroStatement, 'cart should sit beside the brand statement');
  assert.ok(cartRoute < identityCard, 'cart should stay in the top brand header');
  assert.equal(home.match(/router\.push\('\/cart'\)/g)?.length, 1, 'home should keep one cart entry');
  assert.ok(identityCard > heroStatement, 'identity card should follow the brand statement');
  assert.ok(identityCard > 0, 'identity card should render on home');
  assert.ok(vipReferralStrip > identityCard, 'VIP referral strip should follow the identity card');
  assert.ok(searchRow > vipReferralStrip, 'search should replace the former group-buy position');
  assert.ok(aiStage > searchRow, 'the AI stage should render after search');
});

test('home keeps one AI entry and moves the VIP carousel into the former mission slot', () => {
  const home = read('app/(tabs)/home.tsx');
  const aiOrb = home.indexOf('<AiOrb');
  const vipCarousel = home.indexOf('<VipHomePromoCarousel');

  assert.ok(aiOrb > 0, 'home should retain the AI Buy entry');
  assert.ok(vipCarousel > aiOrb, 'VIP carousel should render after the AI prompt');
  assert.match(home, /HOME_HERO_STATEMENT/);
  assert.doesNotMatch(home, /HOME_MISSION_LINES/);
  assert.doesNotMatch(home, /GROUP_BUY_COLORS|styles\.groupBuyEntry|LotteryRepo|styles\.lotteryInline/);
  assert.match(home, /home-lobster\.png/);
  assert.match(home, /home-king-crab\.png/);
});

test('home hides the VIP promo section when no package data is available', () => {
  const home = read('app/(tabs)/home.tsx');

  assert.match(home, /vipPackages\.length > 0 \?/);
  assert.match(home, /<VipHomePromoCarousel/);
});
