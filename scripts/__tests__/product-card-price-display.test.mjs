import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const productCardSource = readFileSync('src/components/cards/ProductCard.tsx', 'utf8');

test('product cards render item price without per-unit suffix', () => {
  assert.doesNotMatch(
    productCardSource,
    /<Price[^>]*\bunit=\{product\.unit\}/s,
    'ProductCard price should not pass product.unit because card price is the whole item price',
  );
});
