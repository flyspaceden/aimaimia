import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/layouts/SellerLayout.tsx', import.meta.url), 'utf8');

test('seller side menu renders real href links with SPA navigation guard', () => {
  assert.match(source, /href=\{item\.path \|\| '#'\}/);
  assert.match(source, /onClick=\{\(event\) => \{/);
  assert.match(source, /event\.preventDefault\(\);/);
  assert.match(source, /navigate\(item\.path\);/);
});
