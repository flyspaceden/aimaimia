import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/deploy-website.yml', import.meta.url), 'utf8');

test('backend deployment bounds dependency install and keeps SSH alive', () => {
  assert.match(workflow, /deploy-backend:[\s\S]*timeout-minutes: 45/);
  assert.match(workflow, /ServerAliveInterval=30/);
  assert.match(workflow, /ServerAliveCountMax=10/);
  assert.match(workflow, /npm_config_fetch_timeout=120000/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=30s 15m/);
  assert.match(workflow, /npm ci --no-audit --no-fund --timing --loglevel=notice/);
  assert.equal((workflow.match(/install_backend_dependencies/g) ?? []).length, 3);
});
