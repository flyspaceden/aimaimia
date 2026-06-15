import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('me tab VIP card uses shipping discount entitlement copy', () => {
  const meTab = read('app/(tabs)/me.tsx');

  assert.match(meTab, /· 减免运费权益/);
  assert.doesNotMatch(meTab, /· 免运费/);
});
