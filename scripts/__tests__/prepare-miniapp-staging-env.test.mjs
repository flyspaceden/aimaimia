import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../../backend/scripts/prepare-miniapp-staging-env.cjs', import.meta.url));

test('staging env preparation is confirmation-gated, backup-first and secret-safe', () => {
  const root = mkdtempSync(join(tmpdir(), 'aimaimai-staging-env-'));
  try {
    const envPath = join(root, '.env');
    const backupRoot = join(root, 'backups');
    const original = [
      "SECRET_VALUE='must-not-print'",
      "WECHAT_MINIAPP_SUBSCRIBE_STATE='develop'",
      "WECHAT_MINIAPP_CODE_ENV_VERSION='develop'",
      "WECHAT_MINIAPP_CODE_CHECK_PATH='false'",
      '',
    ].join('\n');
    writeFileSync(envPath, original, { mode: 0o600 });
    const baseEnv = {
      ...process.env,
      AIMAI_STAGING_ENV_PATH: envPath,
      AIMAI_STAGING_BACKUP_ROOT: backupRoot,
      ALLOW_STAGING_ENV_TEST_PATHS: 'true',
    };

    const denied = spawnSync(process.execPath, [script], { encoding: 'utf8', env: baseEnv });
    assert.notEqual(denied.status, 0);
    assert.equal(readFileSync(envPath, 'utf8'), original);

    const prepared = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...baseEnv, CONFIRM_MINIAPP_STAGING_ENV: 'PREPARE_STAGING_WITHOUT_RESTART' },
    });
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.doesNotMatch(`${prepared.stdout}${prepared.stderr}`, /must-not-print/);
    const updated = readFileSync(envPath, 'utf8');
    assert.match(updated, /WECHAT_MINIAPP_SUBSCRIBE_STATE='developer'/);
    assert.match(updated, /WECHAT_MINIAPP_SUBSCRIBE_ORDER_SHIPPED_TEMPLATE_ID=/);
    assert.match(updated, /WECHAT_MINIAPP_SUBSCRIBE_WITHDRAW_RESULT_FIELDS=/);
    assert.match(updated, /SECRET_VALUE='must-not-print'/);
    assert.equal(statSync(envPath).mode & 0o777, 0o600);

    const backups = readdirSync(backupRoot);
    const envBackup = backups.find((name) => name.endsWith('.env'));
    assert.ok(envBackup);
    assert.equal(readFileSync(join(backupRoot, envBackup), 'utf8'), original);
    assert.ok(backups.some((name) => name.endsWith('.sha256')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
