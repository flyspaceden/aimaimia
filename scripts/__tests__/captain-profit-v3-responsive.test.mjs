import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../app/me/captain.tsx', import.meta.url), 'utf8');

test('captain center protects compact codes and money values on narrow screens', () => {
  assert.match(source, /fitTextProps/);
  assert.match(source, /codeText[^\n]*fitTextProps|fitTextProps[^\n]*codeText/);
  assert.match(source, /function Stat[\s\S]*priceTextProps/);
  assert.match(source, /function ProgressRow[\s\S]*fitTextProps/);
  assert.match(source, /rewardAmount[\s\S]*priceTextProps/);
  assert.match(source, /useInfiniteQuery/);
  assert.match(source, /fetchNextPage/);
  assert.match(source, /hasNextPage/);
  assert.match(source, /加载更多/);
  assert.match(source, /orderQuery\.isError/);
  assert.match(source, /ledgerQuery\.isError/);
  assert.match(source, /重新加载/);
});
