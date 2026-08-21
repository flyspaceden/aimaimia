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
const backendDeployScript = await readFile(
  new URL('../deploy-backend-versioned.sh', import.meta.url),
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
  assert.match(workflow, /手动发布无论目标为何都先验证当前提交中的部署脚本与排除守卫。[\s\S]*echo "workflow=true"/);
});

test('backend quality and E2E gates run before deployment', () => {
  assert.match(workflow, /backend-quality-gate:/);
  assert.match(workflow, /backend-e2e-gate:/);
  assert.match(workflow, /npm test -- --runInBand/);
  assert.match(workflow, /release-approval:/);
  assert.match(workflow, /needs: \[detect-changes, validate-deployment-workflow, backend-quality-gate, backend-e2e-gate\]/);
  assert.match(workflow, /needs\.validate-deployment-workflow\.result == 'success'/);
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
  assert.match(deployBlock, /scripts\/deploy-backend-versioned\.sh/);
  assert.match(backendDeployScript, /npm ls --depth=0 --omit=optional --loglevel=error/);
  assert.match(backendDeployScript, /test -x node_modules\/\.bin\/prisma/);
  assert.match(backendDeployScript, /https:\/\/registry\.npmmirror\.com/);
  assert.match(backendDeployScript, /npx --no-install prisma generate/);
  assert.match(backendDeployScript, /npx --no-install prisma migrate deploy/);

  const candidateIndex = backendDeployScript.indexOf('git worktree add --detach');
  const buildIndex = backendDeployScript.indexOf('\nbuild_backend', candidateIndex);
  const preparedIndex = backendDeployScript.indexOf('record_stage PREPARED', buildIndex);
  const stopIndex = backendDeployScript.indexOf('pm2 stop "$old_pm_id"', preparedIndex);
  const migrateIndex = backendDeployScript.indexOf('npx --no-install prisma migrate deploy');
  assert.ok(candidateIndex >= 0 && buildIndex > candidateIndex, 'candidate must build in a versioned worktree');
  assert.ok(migrateIndex > buildIndex, 'database migration must run only after a successful build');
  assert.ok(preparedIndex > buildIndex && stopIndex > preparedIndex && migrateIndex > stopIndex, 'maintenance stop must happen after build and before migration');
});

test('backend deployment records previous SHA and automatically restores code on failure', () => {
  assert.match(backendDeployScript, /trap restore_old_release EXIT/);
  assert.match(backendDeployScript, /pm2 jlist > "\$pm2_snapshot"/);
  assert.match(backendDeployScript, /PM2 process must be unique/);
  assert.match(backendDeployScript, /pm2 delete "\$PM2_NAME"/);
  assert.match(backendDeployScript, /start_release "\$old_exec" "\$old_cwd" "\$previous_sha"/);
  assert.match(backendDeployScript, /backend_rollback=healthy/);
  assert.match(backendDeployScript, /api\/v1\/health\/ready/);
  assert.match(deployBlock, /RELEASE_SHA='\$RELEASE_SHA'/);
  assert.match(backendDeployScript, /test "\$\(git rev-parse "origin\/\$BRANCH"\)" = "\$RELEASE_SHA"/);
  assert.match(backendDeployScript, /git worktree add --detach "\$candidate_dir" "\$RELEASE_SHA"/);
  assert.match(backendDeployScript, /flock -n 9/);
  assert.match(backendDeployScript, /record_stage MIGRATED/);
  assert.match(backendDeployScript, /record_stage MIGRATION_FAILED_NEEDS_RECONCILIATION/);
  assert.match(backendDeployScript, /migration_completed=true/);
  assert.match(backendDeployScript, /record_stage COMPLETE/);
  assert.ok(
    backendDeployScript.indexOf('record_stage COMPLETE') < backendDeployScript.indexOf('deploy_complete=true', backendDeployScript.indexOf('record_stage COMPLETE')),
    'COMPLETE journal must persist before rollback is disabled',
  );
  assert.match(backendDeployScript, /assert_public_status GET '\/cart' 401/);
  assert.match(backendDeployScript, /assert_public_status GET '\/bonus\/wallet' 401/);
  assert.match(backendDeployScript, /assert_public_status GET '\/after-sale' 401/);
  assert.match(backendDeployScript, /assert_public_status POST '\/orders\/checkout' 401/);
  assert.match(backendDeployScript, /assert_public_status POST '\/orders\/vip-checkout' 401/);
  assert.match(backendDeployScript, /assert_public_status POST '\/group-buy\/checkout' 401/);
  assert.match(backendDeployScript, /data\.releaseSha !== process\.env\.EXPECTED_SHA/);
  assert.match(backendDeployScript, /pm2 save/);
  assert.match(backendDeployScript, /git -C "\$SRC_DIR" worktree remove --force "\$old_dir"/);
  assert.match(backendDeployScript, /tail -n \+6/);
  assert.match(backendDeployScript, /ln -s "\$live_backend\/\.env" "\$candidate_backend\/\.env"/);
  assert.match(backendDeployScript, /ln -s "\$live_backend\/uploads" "\$candidate_backend\/uploads"/);
  assert.match(backendDeployScript, /PM2 NODE_ENV is unexpected/);
  assert.match(backendDeployScript, /backend_maintenance=failed_port_still_serving/);
  assert.match(backendDeployScript, /umask 077/);
  assert.match(backendDeployScript, /chmod 600 "\$pm2_snapshot"/);
  assert.match(backendDeployScript, /OLD_HEALTH_MODE/);
  assert.doesNotMatch(backendDeployScript, /cd "\$live_backend"[\s\S]{0,300}npm ci/);
});

test('production migration creates and verifies a secret-safe database backup first', () => {
  const backupIndex = backendDeployScript.indexOf('node scripts/create-production-database-backup.cjs');
  const migrateIndex = backendDeployScript.indexOf('npx --no-install prisma migrate deploy');
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
  assert.equal((workflow.match(/run: scripts\/deploy-static-with-rollback\.sh/g) || []).length, 3);
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
