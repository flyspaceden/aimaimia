import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Expo TypeScript project excludes the independent mini-program project', () => {
  const rootConfig = JSON.parse(readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8'));
  const miniappConfig = JSON.parse(readFileSync(new URL('../../miniapp/tsconfig.json', import.meta.url), 'utf8'));

  assert.ok(rootConfig.exclude.includes('miniapp'));
  assert.equal(miniappConfig.compilerOptions.baseUrl, '.');
  assert.deepEqual(miniappConfig.compilerOptions.paths['@/*'], ['src/*']);
});
