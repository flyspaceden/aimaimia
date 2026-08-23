import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/deploy-release.yml', import.meta.url),
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
const databaseBackupScriptUrl = new URL('../../backend/scripts/create-production-database-backup.cjs', import.meta.url);
const databaseBackupScript = await readFile(databaseBackupScriptUrl, 'utf8');
const migrationReadinessScriptUrl = new URL('../../backend/scripts/inspect-miniapp-migration-readiness.cjs', import.meta.url);
const migrationReadinessScript = await readFile(migrationReadinessScriptUrl, 'utf8');
const databaseRehearsalScriptUrl = new URL('../../backend/scripts/create-database-rehearsal.cjs', import.meta.url);
const databaseRehearsalScript = await readFile(databaseRehearsalScriptUrl, 'utf8');
const rehearsalMigrationScriptUrl = new URL('../../backend/scripts/run-database-rehearsal-migrations.cjs', import.meta.url);
const rehearsalMigrationScript = await readFile(rehearsalMigrationScriptUrl, 'utf8');
const rehearsalDataVerifierUrl = new URL('../../backend/scripts/verify-database-rehearsal-data.cjs', import.meta.url);
const rehearsalDataVerifier = await readFile(rehearsalDataVerifierUrl, 'utf8');
const rehearsalAttestationVerifierUrl = new URL('../../backend/scripts/verify-production-rehearsal-attestation.cjs', import.meta.url);
const rehearsalAttestationVerifier = await readFile(rehearsalAttestationVerifierUrl, 'utf8');
const productionEnvPreparationScriptUrl = new URL('../../backend/scripts/prepare-miniapp-production-env.cjs', import.meta.url);
const productionEnvPreparationScript = await readFile(productionEnvPreparationScriptUrl, 'utf8');
const backendDeployScript = await readFile(
  new URL('../deploy-backend-versioned.sh', import.meta.url),
  'utf8',
);
const miniappProductionVerifier = await readFile(
  new URL('../../backend/scripts/verify-miniapp-production-config.cjs', import.meta.url),
  'utf8',
);
const miniappConfigVerifier = await readFile(
  new URL('../../backend/scripts/verify-miniapp-config.cjs', import.meta.url),
  'utf8',
);
const sfExpressService = await readFile(
  new URL('../../backend/src/modules/shipment/sf-express.service.ts', import.meta.url),
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

function runScript(scriptUrl, env) {
  return spawnSync(process.execPath, [fileURLToPath(scriptUrl)], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('main production deployment is manual and fail-closed', () => {
  assert.match(workflow, /branches: \[staging-next\]/);
  assert.doesNotMatch(workflow, /branches: \[main,/);
  assert.match(workflow, /confirm_production:/);
  assert.match(workflow, /DEPLOY_PRODUCTION/);
  assert.match(workflow, /migration_rehearsal_sha:/);
  assert.match(workflow, /test "\$MIGRATION_REHEARSAL_SHA" = "\$\{\{ github\.sha \}\}"/);
  assert.match(workflow, /Only main or staging-next may deploy during staging convergence/);
  assert.match(workflow, /git fetch --no-tags origin main/);
  assert.match(workflow, /git diff --name-only origin\/main\.\.\.HEAD/);
  assert.match(workflow, /'miniapp\/\*\*'/);
  assert.match(workflow, /\^\(backend\/\|admin\/\|seller\/\|miniapp\/\)/);
  assert.match(workflow, /backend_branch=\$\{\{ github\.ref_name \}\}/);
  assert.match(workflow, /group: deploy-sites-backend-\$\{\{ github\.ref == 'refs\/heads\/main' && 'production' \|\| 'staging' \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(e2eWorkflow, /branches: \[main, dev, staging, staging-next\]/);
  assert.match(workflow, /\[ "\$TARGET" = "huahai" \] && echo "huahai=true"/);
  assert.doesNotMatch(workflow, /\[ "\$TARGET" = "all" \] \|\| \[ "\$TARGET" = "huahai" \]/);
});

test('workflow-only changes cannot trigger backend deployment', () => {
  const changedPathLine = workflow
    .split('\n')
    .find((line) => line.includes('echo "$CHANGED"') && line.includes('backend=true'));
  assert.ok(changedPathLine, 'backend changed-path detector must exist');
  assert.match(changedPathLine, /\^\(backend\/\|admin\/\|seller\/\|miniapp\/\)/);
  assert.doesNotMatch(changedPathLine, /deploy-release/);
  assert.match(workflow, /手动发布无论目标为何都先验证当前提交中的部署脚本与排除守卫。[\s\S]*echo "workflow=true"/);
});

test('backend quality and E2E gates run before deployment', () => {
  assert.match(workflow, /backend-quality-gate:/);
  assert.match(workflow, /backend-e2e-gate:/);
  assert.match(workflow, /npm test -- --runInBand/);
  assert.match(workflow, /release-approval:/);
  assert.match(workflow, /needs: \[detect-changes, validate-deployment-workflow, backend-quality-gate, backend-e2e-gate\]/);
  assert.match(workflow, /needs\.validate-deployment-workflow\.result == 'success'/);
  const lightweightValidation = jobBlock('validate-deployment-workflow');
  const backendQuality = jobBlock('backend-quality-gate');
  assert.doesNotMatch(lightweightValidation, /prepare-miniapp-staging-env\.test\.mjs/);
  const installIndex = backendQuality.indexOf('Install backend dependencies');
  const preparationTestIndex = backendQuality.indexOf('prepare-miniapp-staging-env.test.mjs');
  assert.ok(installIndex >= 0 && preparationTestIndex > installIndex, 'staging env test must run after backend npm ci');
  assert.match(workflow, /environment:\n\s+name: \$\{\{ needs\.detect-changes\.outputs\.env_name \}\}/);
  assert.match(e2eWorkflow, /workflow_call:/);
});

test('E2E backend boot uses three explicit independent test JWT secrets', () => {
  const secrets = ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'SELLER_JWT_SECRET'].map((key) => {
    const match = e2eWorkflow.match(new RegExp(`^  ${key}: (.+)$`, 'm'));
    assert.ok(match, `${key} must be explicit in E2E`);
    return match[1];
  });
  assert.equal(new Set(secrets).size, 3);
  assert.ok(secrets.every((secret) => secret.length >= 24));
  assert.match(e2eWorkflow, /NODE_ENV: test/);
  assert.match(e2eWorkflow, /^  SF_ENV: UAT$/m);
  assert.match(e2eWorkflow, /^  SF_ALLOW_E2E_MOCK: "true"$/m);
  assert.match(
    sfExpressService,
    /this\.sfEnv !== 'PROD'[\s\S]*process\.env\.NODE_ENV !== 'production'[\s\S]*SF_ALLOW_E2E_MOCK/,
  );
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

test('static-only deployments require the already deployed backend to match the exact release SHA', () => {
  for (const job of ['deploy-website', 'deploy-admin', 'deploy-seller']) {
    const block = jobBlock(job);
    assert.match(block, /name: Require exact backend SHA for static-only deploy/);
    assert.match(block, /if: needs\.detect-changes\.outputs\.backend != 'true'/);
    assert.match(block, /READY_URL: \$\{\{ needs\.detect-changes\.outputs\.api_base \}\}\/health\/ready/);
    assert.match(block, /EXPECTED_SHA: \$\{\{ github\.sha \}\}/);
    assert.match(block, /data\.releaseSha !== process\.env\.EXPECTED_SHA/);
  }
});

test('admin and seller contract tests run before their production builds', () => {
  for (const job of ['deploy-admin', 'deploy-seller']) {
    const block = jobBlock(job);
    const testIndex = block.indexOf('npm test');
    const buildIndex = block.indexOf('npm run build');
    assert.ok(testIndex >= 0 && buildIndex > testIndex, `${job} must test before build`);
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
  assert.match(backendDeployScript, /node scripts\/verify-miniapp-production-config\.cjs/);
  assert.match(backendDeployScript, /node scripts\/verify-miniapp-staging-config\.cjs/);
  assert.match(backendDeployScript, /CONFIRM_MINIAPP_STAGING_ENV=PREPARE_STAGING_WITHOUT_RESTART/);
  assert.match(backendDeployScript, /node scripts\/prepare-miniapp-staging-env\.cjs/);
  assert.match(
    backendDeployScript,
    /if \[ "\$BRANCH" = main \]; then\s+node scripts\/verify-miniapp-production-config\.cjs\s+else\s+CONFIRM_MINIAPP_STAGING_ENV=PREPARE_STAGING_WITHOUT_RESTART\s+\\\s+node scripts\/prepare-miniapp-staging-env\.cjs\s+node scripts\/verify-miniapp-staging-config\.cjs\s+fi/,
  );
  assert.match(backendDeployScript, /unsupported_node_version=/);
  assert.match(backendDeployScript, /required=>=20\.9\.0/);

  const candidateIndex = backendDeployScript.indexOf('git worktree add --detach');
  const configIndex = backendDeployScript.indexOf('node scripts/verify-miniapp-production-config.cjs', candidateIndex);
  const stagingPrepareIndex = backendDeployScript.indexOf('node scripts/prepare-miniapp-staging-env.cjs', candidateIndex);
  const stagingConfigIndex = backendDeployScript.indexOf('node scripts/verify-miniapp-staging-config.cjs', candidateIndex);
  const buildIndex = backendDeployScript.indexOf('\nbuild_backend', candidateIndex);
  const preparedIndex = backendDeployScript.indexOf('record_stage PREPARED', buildIndex);
  const stopIndex = backendDeployScript.indexOf('pm2 stop "$old_pm_id"', preparedIndex);
  const migrateIndex = backendDeployScript.indexOf('npx --no-install prisma migrate deploy');
  assert.ok(candidateIndex >= 0 && configIndex > candidateIndex, 'candidate must verify production configuration');
  assert.ok(stagingPrepareIndex > configIndex, 'staging config preparation must stay outside the production branch');
  assert.ok(stagingConfigIndex > stagingPrepareIndex, 'staging config must be verified after backup-first preparation');
  assert.ok(buildIndex > stagingConfigIndex, 'candidate must verify the selected environment configuration before build');
  assert.ok(migrateIndex > buildIndex, 'database migration must run only after a successful build');
  assert.ok(preparedIndex > buildIndex && stopIndex > preparedIndex && migrateIndex > stopIndex, 'maintenance stop must happen after build and before migration');
});

test('miniapp production verifier excludes the independent Delivery system', () => {
  assert.match(miniappProductionVerifier, /MINIAPP_CONFIG_PROFILE = 'production'/);
  assert.doesNotMatch(
    miniappConfigVerifier,
    /DELIVERY_DATABASE_URL|DELIVERY_USER_JWT_SECRET|DELIVERY_ADMIN_JWT_SECRET|DELIVERY_SELLER_JWT_SECRET|DELIVERY_SMS_MOCK|DELIVERY_WECHAT_MOCK/,
  );
  assert.match(miniappConfigVerifier, /PICKUP_FULFILLMENT_ENABLED/);
  assert.match(miniappConfigVerifier, /WECHAT_MINIAPP_CODE_ENV_VERSION/);
  assert.match(miniappConfigVerifier, /SF_API_URL/);
});

test('backend deployment records previous SHA and automatically restores code on failure', () => {
  assert.match(
    backendDeployScript,
    /staging-next:\/www\/wwwroot\/aimaimai-staging-src:aimaimai-api-test/,
  );
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
  assert.match(databaseBackupScript, /resolvePostgresBinary\('pg_dump'\)/);
  assert.match(databaseBackupScript, /resolvePostgresBinary\('pg_restore'\)/);
  assert.match(databaseBackupScript, /\/www\/server\/pgsql\/bin/);
  assert.match(databaseBackupScript, /PGPASSWORD/);
  assert.match(databaseBackupScript, /sha256/);
  assert.match(databaseBackupScript, /verifiedDigest !== digest/);
  assert.match(databaseBackupScript, /partialDir/);
  assert.match(databaseBackupScript, /renameSync\(partialDir, backupDir\)/);
  assert.match(databaseBackupScript, /fsyncPath\(BACKUP_ROOT\)/);
  assert.match(databaseBackupScript, /backup-manifest\.json/);
  assert.match(databaseBackupScript, /sourceIdentityHash/);
  assert.match(databaseBackupScript, /\.slice\(10\)/);
  assert.doesNotMatch(databaseBackupScript, /console\.log\([^\n]*DATABASE_URL/);
});

test('production migration readiness probe is read-only and covers destructive preconditions', () => {
  assert.match(migrationReadinessScript, /\/www\/server\/pgsql\/bin\/psql/);
  assert.match(migrationReadinessScript, /booking_duplicate_groups/);
  assert.match(migrationReadinessScript, /address_users_multiple_active_defaults/);
  assert.match(migrationReadinessScript, /address_users_active_without_default/);
  assert.match(migrationReadinessScript, /default_transaction_read_only=on/);
});

test('database rehearsal can only restore into an explicitly isolated database', () => {
  assert.match(databaseRehearsalScript, /\^aimaimai_rehearsal_/);
  assert.match(databaseRehearsalScript, /\/www\/backup\/database\/aimaimai\//);
  assert.match(databaseRehearsalScript, /rehearsal database already exists/);
  assert.match(databaseRehearsalScript, /database backup checksum verification failed/);
  assert.match(databaseRehearsalScript, /database backup was created from a different source database/);
  assert.match(databaseRehearsalScript, /_aimaimai_rehearsal_provenance/);
  assert.match(databaseRehearsalScript, /I_UNDERSTAND_THIS_USES_PRODUCTION_CLUSTER/);
  assert.match(databaseRehearsalScript, /requiredFreeBytes/);
  assert.match(databaseRehearsalScript, /pg_tablespace_location/);
  assert.match(databaseRehearsalScript, /CREATE DATABASE/);
  assert.match(databaseRehearsalScript, /OWNER \$\{quoteIdentifier\(appUser\)\}/);
  assert.match(databaseRehearsalScript, /--exit-on-error/);
  assert.match(databaseRehearsalScript, /DROP DATABASE/);
  assert.doesNotMatch(databaseRehearsalScript, /DROP DATABASE.*current_database/i);
});

test('migration rehearsal cannot target the live production database name', () => {
  assert.match(rehearsalMigrationScript, /\^aimaimai_rehearsal_/);
  assert.match(rehearsalMigrationScript, /databaseUrl\.pathname = `\/\$\{rehearsalDatabase\}`/);
  assert.match(rehearsalMigrationScript, /prisma', 'migrate', 'deploy/);
  assert.match(rehearsalMigrationScript, /Following migrations have not yet been applied:/);
  assert.match(rehearsalMigrationScript, /migration_count=/);
  assert.match(rehearsalMigrationScript, /failed_migration_count=/);
});

test('rehearsal verifier checks business-row conservation and exact refund backfill', () => {
  assert.match(rehearsalDataVerifier, /\^aimaimai_rehearsal_/);
  assert.match(rehearsalDataVerifier, /baseline and migrated rehearsal databases must differ/);
  assert.match(rehearsalDataVerifier, /primaryKeyHash/);
  assert.match(rehearsalDataVerifier, /rowHash/);
  assert.match(rehearsalDataVerifier, /business primary keys or stable row fields changed/);
  assert.match(rehearsalDataVerifier, /refund side-effect historical backfill rows mismatch/);
  assert.match(rehearsalDataVerifier, /default_transaction_read_only=on/);
  assert.match(rehearsalDataVerifier, /migrationTreeSha256/);
  assert.match(rehearsalDataVerifier, /migrationTreeGitObject/);
  assert.match(rehearsalDataVerifier, /REHEARSAL_CANDIDATE_SHA/);
  assert.match(rehearsalDataVerifier, /rehearsal checkout does not match/);
  assert.match(rehearsalDataVerifier, /historical compatibility defaults were not preserved/);
  assert.match(rehearsalDataVerifier, /rehearsal database provenance does not match/);
  assert.match(rehearsalDataVerifier, /rehearsal migration checksums do not match/);
  assert.match(rehearsalDataVerifier, /baseline migration checksums are not a valid subset/);
  assert.match(rehearsalDataVerifier, /complete\) !== 120/);
  assert.match(rehearsalDataVerifier, /failed\) !== 0/);
});

test('production deploy requires a fresh SHA-bound rehearsal attestation', () => {
  assert.match(backendDeployScript, /RELEASE_SHA="\$RELEASE_SHA" node scripts\/verify-production-rehearsal-attestation\.cjs/);
  assert.match(rehearsalAttestationVerifier, /candidate checkout does not match RELEASE_SHA/);
  assert.match(rehearsalAttestationVerifier, /migration tree does not match the release candidate/);
  assert.match(rehearsalAttestationVerifier, /migration Git tree does not match the release candidate/);
  assert.match(rehearsalAttestationVerifier, /backup checksum no longer matches/);
  assert.match(rehearsalAttestationVerifier, /backup source manifest no longer matches/);
  assert.match(rehearsalAttestationVerifier, /older than 14 days/);
  assert.match(rehearsalAttestationVerifier, /stableTableFingerprints/);
  const stoppedIndex = backendDeployScript.indexOf('record_stage PM2_STOPPED');
  const readinessIndex = backendDeployScript.indexOf('node scripts/inspect-miniapp-migration-readiness.cjs');
  const backupIndex = backendDeployScript.indexOf('node scripts/create-production-database-backup.cjs');
  assert.ok(stoppedIndex >= 0 && readinessIndex > stoppedIndex && backupIndex > readinessIndex);
  assert.match(migrationReadinessScript, /active_connections\) !== 1/);
  assert.match(migrationReadinessScript, /source database does not match production/);
});

test('database tools reject unsafe targets before opening a database connection', () => {
  const invalidBackup = runScript(databaseBackupScriptUrl, { DATABASE_BACKUP_LABEL: 'bad' });
  assert.notEqual(invalidBackup.status, 0);
  assert.match(invalidBackup.stderr, /DATABASE_BACKUP_LABEL is invalid/);

  const invalidRestoreTarget = runScript(databaseRehearsalScriptUrl, { REHEARSAL_DATABASE_NAME: 'aimaimai' });
  assert.notEqual(invalidRestoreTarget.status, 0);
  assert.match(invalidRestoreTarget.stderr, /isolated aimaimai_rehearsal_ prefix/);

  const unapprovedBackup = runScript(databaseRehearsalScriptUrl, {
    REHEARSAL_DATABASE_NAME: 'aimaimai_rehearsal_12345678',
    DATABASE_BACKUP_PATH: '/tmp/not-an-approved-production-backup.dump',
  });
  assert.notEqual(unapprovedBackup.status, 0);
  assert.match(unapprovedBackup.stderr, /outside the approved backup root or missing/);

  const invalidMigrationTarget = runScript(rehearsalMigrationScriptUrl, { REHEARSAL_DATABASE_NAME: 'production' });
  assert.notEqual(invalidMigrationTarget.status, 0);
  assert.match(invalidMigrationTarget.stderr, /isolated aimaimai_rehearsal_ prefix/);

  const identicalComparisonTargets = runScript(rehearsalDataVerifierUrl, {
    BASELINE_DATABASE_NAME: 'aimaimai_rehearsal_12345678',
    REHEARSAL_DATABASE_NAME: 'aimaimai_rehearsal_12345678',
  });
  assert.notEqual(identicalComparisonTargets.status, 0);
  assert.match(identicalComparisonTargets.stderr, /baseline and migrated rehearsal databases must differ/);

  const rehearsalAsProduction = runScript(migrationReadinessScriptUrl, {
    DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5432/aimaimai_rehearsal_12345678',
  });
  assert.notEqual(rehearsalAsProduction.status, 0);
  assert.match(rehearsalAsProduction.stderr, /non-rehearsal production database/);
  assert.doesNotMatch(rehearsalAsProduction.stderr, /secret/);

  const invalidAttestationSha = runScript(rehearsalAttestationVerifierUrl, { RELEASE_SHA: 'not-a-full-sha' });
  assert.notEqual(invalidAttestationSha.status, 0);
  assert.match(invalidAttestationSha.stderr, /RELEASE_SHA must be a full commit SHA/);

  const missingEnvConfirmation = runScript(productionEnvPreparationScriptUrl, {});
  assert.notEqual(missingEnvConfirmation.status, 0);
  assert.match(missingEnvConfirmation.stderr, /explicit production env preparation confirmation is missing/);
});

test('production miniapp env preparation is backup-first, atomic and does not restart PM2', () => {
  assert.match(productionEnvPreparationScript, /before-miniapp-production/);
  assert.match(productionEnvPreparationScript, /production env backup checksum changed/);
  assert.match(productionEnvPreparationScript, /renameSync\(partialBackupDir, backupDir\)/);
  assert.match(productionEnvPreparationScript, /fsyncPath\(BACKUP_ROOT\)/);
  assert.match(productionEnvPreparationScript, /renameSync\(temporaryPath, ENV_PATH\)/);
  assert.match(productionEnvPreparationScript, /chownSync\(temporaryPath, originalStat\.uid, originalStat\.gid\)/);
  assert.match(productionEnvPreparationScript, /PREPARE_WITHOUT_RESTART/);
  assert.match(productionEnvPreparationScript, /randomBytes\(32\)/);
  assert.match(productionEnvPreparationScript, /return `'\$\{value\}'`/);
  assert.doesNotMatch(productionEnvPreparationScript, /nextLines\.push\(`\$\{key\}=\$\{JSON\.stringify/);
  assert.doesNotMatch(productionEnvPreparationScript, /node:child_process|\bpm2\b/i);
  assert.match(productionEnvPreparationScript, /const dotenv = require\('dotenv'\)/);
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
