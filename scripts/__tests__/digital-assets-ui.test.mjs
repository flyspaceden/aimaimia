import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('digital asset page does not expose unfinished long-term modules', () => {
  const page = read('app/me/digital-assets.tsx');

  assert.doesNotMatch(page, /PENDING_MODULES/);
  assert.doesNotMatch(page, /长期模块/);
  assert.doesNotMatch(page, /未来权益模块/);
  assert.doesNotMatch(page, /权益规则待开放/);
});
