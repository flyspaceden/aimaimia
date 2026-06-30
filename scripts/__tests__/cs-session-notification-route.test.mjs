import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync('app/cs/index.tsx', 'utf8');

test('客服页 supports notification deep links with a concrete sessionId', () => {
  assert.match(source, /sessionId:\s*initialSessionId/);
  assert.match(source, /if\s*\(\s*initialSessionId\s*\)/);
  assert.match(source, /setSessionId\(initialSessionId\)/);
  assert.match(source, /CsRepo\.getMessages\(initialSessionId\)/);
});

test('客服页 does not create a default MY_PAGE session when notification sessionId exists', () => {
  const initialSessionBlock = source.match(/if\s*\(\s*initialSessionId\s*\)\s*\{[\s\S]*?return;\s*\}/)?.[0] ?? '';
  assert.ok(initialSessionBlock.length > 0);
  assert.doesNotMatch(initialSessionBlock, /CsRepo\.createSession/);
});
