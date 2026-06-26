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

test('home VIP promo keeps package label beside price in a shorter card', () => {
  const carousel = read('src/components/data/VipHomePromoCarousel.tsx');

  assert.match(
    carousel,
    /<View style=\{styles\.priceLine\}>[\s\S]*?<Text \{\.\.\.priceTextProps\}[\s\S]*?>[\s\S]*?<\/Text>[\s\S]*?<Text[\s\S]*styles\.packageLabel[\s\S]*?>\s*VIP 礼包\s*<\/Text>[\s\S]*?<\/View>/,
  );

  const cardHeights = [...carousel.matchAll(/card(?:Pressable)?: \{[\s\S]*?height: (\d+)/g)]
    .map((match) => Number(match[1]));

  assert.deepEqual(cardHeights, [132, 132]);
});
