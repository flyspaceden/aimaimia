import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('buyer app sold-out labels use 已售完 copy', () => {
  const productCard = read('src/components/cards/ProductCard.tsx');
  const vipGifts = read('app/vip/gifts.tsx');

  assert.match(productCard, /已售完/);
  assert.doesNotMatch(productCard, /已售罄/);
  assert.match(vipGifts, /已售完/);
  assert.doesNotMatch(vipGifts, /已售罄/);
});

test('buyer app refreshes product inventory whenever the discovery tab regains focus', () => {
  const museum = read('app/(tabs)/museum.tsx');

  assert.match(museum, /useFocusEffect\(/);
  assert.match(museum, /AppState\.addEventListener\('change'/);
  assert.match(museum, /if \(becameActive\) refreshProductQueries\(\)/);
  assert.match(museum, /if \(tab === 'products'\) refreshProductQueries\(\)/);
  assert.match(museum, /refreshDiscoveryProducts\(queryClient\)/);
});
