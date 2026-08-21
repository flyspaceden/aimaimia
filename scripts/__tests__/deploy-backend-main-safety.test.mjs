import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/deploy-website.yml', import.meta.url),
  'utf8',
);

test('production backend deployment verifies dependencies and builds before migration', () => {
  assert.match(workflow, /npm ls --depth=0 --omit=optional --loglevel=error/);
  assert.match(workflow, /test -x node_modules\/\.bin\/prisma/);
  assert.match(workflow, /npm_config_registry=https:\/\/registry\.npmmirror\.com/);
  assert.match(workflow, /npx --no-install prisma generate/);
  assert.match(workflow, /npx --no-install prisma migrate deploy/);

  const buildIndex = workflow.indexOf('NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" npm run build');
  const migrateIndex = workflow.indexOf('npx --no-install prisma migrate deploy');
  assert.ok(buildIndex >= 0, 'backend build command must exist');
  assert.ok(migrateIndex > buildIndex, 'database migration must run only after a successful build');
});
