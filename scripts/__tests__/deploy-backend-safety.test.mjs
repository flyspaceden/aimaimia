import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/deploy-website.yml', import.meta.url), 'utf8');

test('backend deployment bounds dependency install, fails over registry, and keeps SSH alive', () => {
  assert.match(workflow, /deploy-backend:[\s\S]*timeout-minutes: 45/);
  assert.match(workflow, /ServerAliveInterval=30/);
  assert.match(workflow, /ServerAliveCountMax=10/);
  assert.match(workflow, /npm_config_replace_registry_host=always/);
  assert.match(workflow, /run_npm_ci "https:\/\/registry\.npmjs\.org" 0 45000 3m official/);
  assert.match(workflow, /npm_install_fallback=registry\.npmmirror\.com/);
  assert.match(workflow, /run_npm_ci "https:\/\/registry\.npmmirror\.com" 2 120000 12m mirror/);
  assert.match(workflow, /npm ci --no-audit --no-fund --timing --loglevel=notice/);
  assert.match(workflow, /npm_install_failed_status=\$status/);
  assert.doesNotMatch(workflow, /\bnpx prisma\b/);
  assert.equal((workflow.match(/npx --no-install prisma/g) ?? []).length, 6);
  assert.equal((workflow.match(/install_backend_dependencies/g) ?? []).length, 3);
});
