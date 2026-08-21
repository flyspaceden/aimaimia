import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/deploy-website.yml', import.meta.url), 'utf8');
const e2eWorkflow = readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
const playwrightConfig = readFileSync(new URL('../../tests/playwright.config.ts', import.meta.url), 'utf8');

test('backend deployment bounds dependency install, fails over registry, and keeps SSH alive', () => {
  assert.match(workflow, /backend-quality-gate:[\s\S]*services:[\s\S]*postgres:/);
  assert.match(workflow, /backend-quality-gate:[\s\S]*npx --no-install prisma validate/);
  assert.match(workflow, /backend-quality-gate:[\s\S]*npx --no-install prisma migrate deploy/);
  assert.match(workflow, /backend-quality-gate:[\s\S]*npm run build/);
  assert.match(workflow, /backend-quality-gate:[\s\S]*npm test -- --runInBand/);
  assert.match(workflow, /NORMAL_TREE_POSTGRES_TEST_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/aimaimai_test_ci\?schema=public/);
  assert.match(workflow, /PROFIT_SAFETY_POSTGRES_TEST_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/aimaimai_test_ci\?schema=public/);
  assert.match(workflow, /Install PDF verification tools[\s\S]*poppler-utils/);
  assert.match(workflow, /Install PDF verification tools[\s\S]*poppler-data/);
  assert.match(playwrightConfig, /npm run start:e2e/);
  assert.match(workflow, /RUN_DB_CONCURRENCY_TESTS: '1'/);
  assert.match(e2eWorkflow, /workflow_call:/);
  assert.match(e2eWorkflow, /DELIVERY_DATABASE_URL: postgresql:\/\/postgres:postgres@localhost:5432\/aimaimai_test\?schema=delivery_ci/);
  assert.match(e2eWorkflow, /DELIVERY_USER_JWT_SECRET: e2e-delivery-user-jwt-secret/);
  assert.match(e2eWorkflow, /prisma migrate deploy --schema prisma-delivery\/schema\.prisma/);
  assert.match(workflow, /backend-e2e-gate:[\s\S]*uses: \.\/\.github\/workflows\/e2e\.yml/);
  assert.match(workflow, /deploy-backend:\n\s+needs: \[detect-changes, backend-quality-gate, backend-e2e-gate\]/);
  assert.match(workflow, /needs\.backend-quality-gate\.result == 'success'/);
  assert.match(workflow, /needs\.backend-e2e-gate\.result == 'success'/);
  assert.match(
    workflow,
    /if \[ "\$BRANCH" = "main" \]; then\n\s+node scripts\/verify-miniapp-production-config\.cjs\n\s+fi[\s\S]*prisma migrate deploy/,
  );
  assert.match(
    workflow,
    /生产小程序配置预检[\s\S]*prisma generate\n\s+npx --no-install prisma generate --schema prisma-delivery\/schema\.prisma[\s\S]*build_backend[\s\S]*npx --no-install prisma migrate deploy\n\s+npx --no-install prisma migrate deploy --schema prisma-delivery\/schema\.prisma/,
  );
  assert.match(workflow, /deploy-backend:[\s\S]*timeout-minutes: 45/);
  assert.match(workflow, /ServerAliveInterval=30/);
  assert.match(workflow, /ServerAliveCountMax=10/);
  assert.match(workflow, /API_HEALTH_URL="http:\/\/127\.0\.0\.1:\$\{API_PORT\}\/api\/v1\/health\/ready"/);
  assert.doesNotMatch(workflow, /API_HEALTH_URL=.*\/products\?page=1/);
  assert.match(workflow, /LEGACY_HEALTH_URL="http:\/\/127\.0\.0\.1:\$\{API_PORT\}\/api\/v1\/products\?page=1&pageSize=1"/);
  assert.match(workflow, /health_check true/);
  assert.match(workflow, /npm_config_replace_registry_host=always/);
  assert.match(workflow, /run_npm_ci "https:\/\/registry\.npmjs\.org" 0 45000 3m official/);
  assert.match(workflow, /verify_backend_dependencies/);
  assert.match(workflow, /npm ls --depth=0 --omit=optional --loglevel=error/);
  assert.match(workflow, /test -x node_modules\/\.bin\/prisma/);
  assert.match(workflow, /dependency_verification_failed_status=\$status/);
  assert.match(workflow, /npm_install_fallback=registry\.npmmirror\.com/);
  assert.match(workflow, /run_npm_ci "https:\/\/registry\.npmmirror\.com" 2 120000 12m mirror/);
  assert.match(workflow, /npm ci --no-audit --no-fund --timing --loglevel=notice/);
  assert.match(workflow, /npm_install_failed_status=\$status/);
  assert.doesNotMatch(workflow, /\bnpx prisma\b/);
  assert.equal((workflow.match(/npx --no-install prisma/g) ?? []).length, 12);
  assert.equal((workflow.match(/install_backend_dependencies/g) ?? []).length, 3);
});
