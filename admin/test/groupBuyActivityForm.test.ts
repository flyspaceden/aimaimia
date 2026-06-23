import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('group buy activity form exposes activity detail description but not rule summary', () => {
  const source = readFileSync(resolve(__dirname, '../src/pages/group-buy/activities.tsx'), 'utf8');

  assert.equal(source.includes('label="团购详情介绍"'), true);
  assert.equal(source.includes('name="description"'), true);
  assert.equal(source.includes('label="规则摘要"'), false);
  assert.equal(source.includes('name="ruleSummary"'), false);
});
