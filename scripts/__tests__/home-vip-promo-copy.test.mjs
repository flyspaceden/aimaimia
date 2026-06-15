import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('home VIP promo removes referral header row and high reward suffix', () => {
  const carousel = read('src/components/data/VipHomePromoCarousel.tsx');
  const promo = read('src/utils/vipHomePromo.ts');

  assert.equal(carousel.includes('styles.headerRow'), false);
  assert.equal(carousel.includes('个档位可选'), false);
  assert.equal(promo.includes('，有高额奖励'), false);
  assert.ok(promo.includes("title: '推荐好友开通 VIP'"));
});
