import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const meTab = () => readFileSync('app/(tabs)/me.tsx', 'utf8');

test('me identity card removes greeting copy from signed-in profile card', () => {
  const source = meTab();

  assert.doesNotMatch(source, /const greeting = useMemo/);
  assert.doesNotMatch(source, /早上好|下午好|晚上好/);
});

test('me identity card prefixes buyer number with ID label', () => {
  const source = meTab();

  assert.match(source, /profile\.buyerNo \? `ID: \$\{profile\.buyerNo\}` : 'ID: 用户编号生成中'/);
});
