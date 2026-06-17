import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('checkout auth success merges pending local cart prizes before refreshing checkout data', () => {
  const checkout = read('app/checkout.tsx');
  const handlerStart = checkout.indexOf('const handleVipAuthSuccess = async');
  const modalStart = checkout.indexOf('<AuthModal', handlerStart);
  const handlerBlock = checkout.slice(handlerStart, modalStart);

  assert.notEqual(handlerStart, -1);
  assert.match(handlerBlock, /useCartStore\.getState\(\)\.syncLocalCartToServer\(\)/);
  assert.match(handlerBlock, /invalidateQueries\(\{\s*queryKey:\s*\['lottery-today'\]/);
  assert.match(checkout, /onSuccess=\{handleVipAuthSuccess\}/);
});
