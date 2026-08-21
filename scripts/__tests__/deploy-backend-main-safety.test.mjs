import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/deploy-website.yml', import.meta.url),
  'utf8',
);
const e2eWorkflow = await readFile(
  new URL('../../.github/workflows/e2e.yml', import.meta.url),
  'utf8',
);
const staticDeployScript = await readFile(
  new URL('../deploy-static-with-rollback.sh', import.meta.url),
  'utf8',
);
const databaseBackupScript = await readFile(
  new URL('../../backend/scripts/create-production-database-backup.cjs', import.meta.url),
  'utf8',
);

const deployBlockStart = workflow.indexOf('      - name: Deploy backend on server');
const deployBlockEnd = workflow.indexOf('  # 华海农科母公司官网', deployBlockStart);
const deployBlock = workflow.slice(deployBlockStart, deployBlockEnd);

function jobBlock(name) {
  const start = workflow.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `${name} must exist`);
  const remaining = workflow.slice(start + name.length + 3);
  const nextMatch = remaining.match(/\n  [a-zA-Z0-9_-]+:\n/);
  return workflow.slice(start, nextMatch ? start + name.length + 3 + nextMatch.index : undefined);
}

test('main production deployment is manual and fail-closed', () => {
  assert.match(workflow, /branches: \[staging\]/);
  assert.doesNotMatch(workflow, /branches: \[main, staging\]/);
  assert.match(workflow, /confirm_production:/);
  assert.match(workflow, /DEPLOY_PRODUCTION/);
  assert.match(workflow, /migration_rehearsal_sha:/);
  assert.match(workflow, /test "\$MIGRATION_REHEARSAL_SHA" = "\$\{\{ github\.sha \}\}"/);
  assert.match(workflow, /Only main or staging may deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /\[ "\$TARGET" = "huahai" \] && echo "huahai=true"/);
  assert.doesNotMatch(workflow, /\[ "\$TARGET" = "all" \] \|\| \[ "\$TARGET" = "huahai" \]/);
});

test('workflow-only changes cannot trigger backend deployment', () => {
  const changedPathLine = workflow
    .split('\n')
    .find((line) => line.includes('echo "$CHANGED"') && line.includes('backend=true'));
  assert.ok(changedPathLine, 'backend changed-path detector must exist');
  assert.match(changedPathLine, /\^backend\//);
  assert.doesNotMatch(changedPathLine, /deploy-website/);
});

test('backend quality and E2E gates run before deployment', () => {
  assert.match(workflow, /backend-quality-gate:/);
  assert.match(workflow, /backend-e2e-gate:/);
  assert.match(workflow, /npm test -- --runInBand/);
  assert.match(workflow, /needs: \[detect-changes, backend-quality-gate, backend-e2e-gate\]/);
  assert.match(workflow, /release-approval:/);
  assert.match(workflow, /environment:\n\s+name: \$\{\{ needs\.detect-changes\.outputs\.env_name \}\}/);
  assert.match(e2eWorkflow, /workflow_call:/);
});

test('independent Delivery system is excluded from production workflow', () => {
  assert.doesNotMatch(workflow, /delivery-admin|delivery-seller|prisma-delivery|DELIVERY_DATABASE_URL/);
});

test('web consoles wait for a changed backend to deploy successfully', () => {
  for (const job of ['deploy-website', 'deploy-admin', 'deploy-seller']) {
    const block = jobBlock(job);
    assert.match(block, /needs: \[detect-changes, release-approval, deploy-backend\]/);
    assert.match(block, /needs\.release-approval\.result == 'success'/);
    assert.match(block, /needs\.detect-changes\.outputs\.backend != 'true'/);
    assert.match(block, /needs\.deploy-backend\.result == 'success'/);
  }
});

test('production backend deployment verifies dependencies and builds before migration', () => {
  assert.ok(deployBlockStart >= 0 && deployBlockEnd > deployBlockStart, 'backend deploy block must exist');
  assert.match(deployBlock, /npm ls --depth=0 --omit=optional --loglevel=error/);
  assert.match(deployBlock, /test -x node_modules\/\.bin\/prisma/);
  assert.match(deployBlock, /https:\/\/registry\.npmmirror\.com/);
  assert.match(deployBlock, /npx --no-install prisma generate/);
  assert.match(deployBlock, /npx --no-install prisma migrate deploy/);

  const buildStepIndex = deployBlock.indexOf('服务器环境构建（任何数据库写入前）');
  const buildIndex = deployBlock.indexOf('\n            build_backend', buildStepIndex);
  const migrateIndex = deployBlock.indexOf('npx --no-install prisma migrate deploy');
  assert.ok(buildStepIndex >= 0 && buildIndex > buildStepIndex, 'backend build call must exist in build step');
  assert.ok(migrateIndex > buildIndex, 'database migration must run only after a successful build');
});

test('backend deployment records previous SHA and automatically restores code on failure', () => {
  assert.match(deployBlock, /PREVIOUS_SHA=\$\(git rev-parse HEAD\)/);
  assert.match(deployBlock, /trap rollback_backend EXIT/);
  assert.match(deployBlock, /git reset --hard "\$PREVIOUS_SHA"/);
  assert.match(deployBlock, /backend_rollback=healthy/);
  assert.match(deployBlock, /api\/v1\/health\/ready/);
  assert.match(deployBlock, /RELEASE_SHA='\$RELEASE_SHA'/);
  assert.match(deployBlock, /git reset --hard "\$RELEASE_SHA"/);
  assert.match(deployBlock, /test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA"/);
});

test('production migration creates and verifies a secret-safe database backup first', () => {
  const backupIndex = deployBlock.indexOf('node scripts/create-production-database-backup.cjs');
  const migrateIndex = deployBlock.indexOf('npx --no-install prisma migrate deploy');
  assert.ok(backupIndex >= 0 && migrateIndex > backupIndex);
  assert.match(databaseBackupScript, /const BACKUP_ROOT = '\/www\/backup\/database\/aimaimai'/);
  assert.match(databaseBackupScript, /run\('pg_dump'/);
  assert.match(databaseBackupScript, /run\('pg_restore'/);
  assert.match(databaseBackupScript, /PGPASSWORD/);
  assert.match(databaseBackupScript, /sha256/);
  assert.match(databaseBackupScript, /verifiedDigest !== digest/);
  assert.match(databaseBackupScript, /\.slice\(10\)/);
  assert.doesNotMatch(databaseBackupScript, /console\.log\([^\n]*DATABASE_URL/);
});

test('website, admin and seller keep rollback snapshots before static deployment', () => {
  assert.equal((workflow.match(/scripts\/deploy-static-with-rollback\.sh/g) || []).length, 3);
  assert.match(staticDeployScript, /trap restore_static EXIT/);
  assert.match(staticDeployScript, /tar -C "\$STATIC_TARGET" -czf "\$BACKUP_PATH" \./);
  assert.match(staticDeployScript, /rsync -avz --delete --delay-updates/);
  assert.match(staticDeployScript, /rsync -a --delete --delay-updates "\$restore_dir\/" "\$STATIC_TARGET\/"/);
  assert.match(staticDeployScript, /static_rollback=healthy/);
  assert.match(staticDeployScript, /release-sha\.txt\?release=\$RELEASE_SHA/);
  assert.match(staticDeployScript, /asset_relative/);
  assert.match(staticDeployScript, /remote_asset_sha/);
  assert.match(staticDeployScript, /test "\$remote_asset_sha" = "\$asset_sha"/);
  assert.match(staticDeployScript, /tail -n \+21/);
});
