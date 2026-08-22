#!/usr/bin/env node

const {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FINGERPRINT_TABLES = [
  ['User', 'User', []],
  ['Session', 'Session', ['authIdentityId']],
  ['Company', 'Company', []],
  ['Product', 'Product', []],
  ['ProductSKU', 'ProductSKU', []],
  ['Cart', 'Cart', []],
  ['CartItem', 'CartItem', []],
  ['CheckoutSession', 'CheckoutSession', ['paymentScene', 'miniProgramPayerOpenId', 'fulfillmentMode', 'pickupRecipientSnapshot', 'pickupSelectionsSnapshot']],
  ['Order', 'Order', ['fulfillmentMode']],
  ['OrderItem', 'OrderItem', []],
  ['Payment', 'Payment', []],
  ['Refund', 'Refund', []],
  ['AfterSaleRequest', 'after_sale_request', []],
  ['Booking', 'Booking', []],
  ['Address', 'Address', []],
  ['RewardAccount', 'RewardAccount', []],
  ['RewardLedger', 'RewardLedger', []],
  ['CouponInstance', 'CouponInstance', ['triggerIdempotencyKey']],
  ['DigitalAssetAccount', 'DigitalAssetAccount', []],
  ['OrderProfitSnapshot', 'OrderProfitSnapshot', []],
  ['WithdrawRequest', 'WithdrawRequest', ['providerStateUpdatedAt', 'nextReconcileAt']],
  ['InviteH5LandingEvent', 'InviteH5LandingEvent', ['miniProgramUrlLink', 'miniProgramUrlLinkExpiresAt', 'miniProgramUrlLinkClaimUntil']],
  ['AfterSaleShippingPayment', 'after_sale_shipping_payments', ['paymentScene', 'miniProgramPayerOpenId', 'paymentParamState']],
];

function required(key) {
  const current = String(process.env[key] || '').trim();
  if (!current) throw new Error(`${key} is missing`);
  return current;
}

function assertRehearsalDatabase(name, key) {
  if (!/^aimaimai_rehearsal_[a-z0-9_]{8,64}$/.test(name)) {
    throw new Error(`${key} must use the isolated aimaimai_rehearsal_ prefix`);
  }
}

function readDatabaseUrl(envPath) {
  const contents = readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1 || line.slice(0, separator).trim() !== 'DATABASE_URL') continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error('DATABASE_URL is missing from the source environment');
}

function resolvePsql() {
  const configuredDir = String(process.env.PG_BIN_DIR || '').trim();
  const candidates = [
    configuredDir && path.join(configuredDir, 'psql'),
    '/www/server/pgsql/bin/psql',
    '/usr/local/pgsql/bin/psql',
    '/usr/bin/psql',
    'psql',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'psql') return candidate;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next known installation location.
    }
  }
  return 'psql';
}

function pgEnv(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username) {
    throw new Error('source database URL is incomplete or not PostgreSQL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) throw new Error('database name is missing');
  const env = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGOPTIONS: '-c default_transaction_read_only=on',
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
}

function queryJson(databaseUrl, sql) {
  const result = spawnSync(resolvePsql(), ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    env: pgEnv(databaseUrl),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2 * 60_000,
  });
  if (result.error || result.status !== 0) {
    const diagnostic = String(result.stderr || '')
      .replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-database-url>')
      .replace(/password\s*=\s*\S+/gi, 'password=<redacted>')
      .trim()
      .slice(0, 500);
    throw new Error(`psql verification failed with status ${result.status ?? 'unknown'}${diagnostic ? `: ${diagnostic}` : ''}`);
  }
  return JSON.parse(result.stdout.trim());
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sha256(filePath) {
  const result = spawnSync('sha256sum', ['--', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000 });
  if (result.error || result.status !== 0) throw new Error('sha256sum failed');
  const digest = result.stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('sha256sum returned an invalid digest');
  return digest;
}

function migrationTreeSha256(root) {
  const hash = createHash('sha256');
  const visit = (current, relative = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) {
        hash.update(childRelative);
        hash.update('\0');
        hash.update(readFileSync(child));
        hash.update('\0');
      }
    }
  };
  visit(root);
  return hash.digest('hex');
}

function candidateMigrationChecksums(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const migrationSql = path.join(root, entry.name, 'migration.sql');
      return {
        name: entry.name,
        checksum: createHash('sha256').update(readFileSync(migrationSql)).digest('hex'),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function fingerprintSql() {
  const selects = FINGERPRINT_TABLES.map(([key, table, excluded]) => {
    const exclusions = excluded.length
      ? `ARRAY[${excluded.map((column) => `'${column}'`).join(',')}]::text[]`
      : 'ARRAY[]::text[]';
    return `SELECT '${key}' AS key, json_build_object(
      'count', count(*),
      'primaryKeyHash', md5(COALESCE(string_agg(t."id", E'\\n' ORDER BY t."id"), '')),
      'rowHash', md5(COALESCE(string_agg((to_jsonb(t) - ${exclusions})::text, E'\\n' ORDER BY t."id"), ''))
    ) AS fingerprint FROM ${quoteIdentifier(table)} t`;
  });
  return `SELECT json_object_agg(key, fingerprint ORDER BY key)::text FROM (${selects.join('\nUNION ALL\n')}) fingerprints`;
}

function main() {
  const baselineDatabase = required('BASELINE_DATABASE_NAME');
  const rehearsalDatabase = required('REHEARSAL_DATABASE_NAME');
  assertRehearsalDatabase(baselineDatabase, 'BASELINE_DATABASE_NAME');
  assertRehearsalDatabase(rehearsalDatabase, 'REHEARSAL_DATABASE_NAME');
  if (baselineDatabase === rehearsalDatabase) throw new Error('baseline and migrated rehearsal databases must differ');

  const sourceUrl = new URL(readDatabaseUrl(path.resolve(required('SOURCE_DATABASE_ENV_PATH'))));
  if (!['postgres:', 'postgresql:'].includes(sourceUrl.protocol) || !sourceUrl.hostname || !sourceUrl.username) {
    throw new Error('source database URL is incomplete or not PostgreSQL');
  }
  const sourceDatabase = decodeURIComponent(sourceUrl.pathname.replace(/^\//, ''));
  if (!sourceDatabase || sourceDatabase.startsWith('aimaimai_rehearsal_')) {
    throw new Error('source environment must identify the non-rehearsal production database');
  }
  const baselineUrl = new URL(sourceUrl.toString());
  baselineUrl.pathname = `/${baselineDatabase}`;
  const rehearsalUrl = new URL(sourceUrl.toString());
  rehearsalUrl.pathname = `/${rehearsalDatabase}`;

  const backupPath = path.resolve(required('DATABASE_BACKUP_PATH'));
  if (!backupPath.startsWith('/www/backup/database/aimaimai/') || !backupPath.endsWith('.dump') || !existsSync(backupPath)) {
    throw new Error('DATABASE_BACKUP_PATH is outside the approved backup root or missing');
  }
  const checksumPath = `${backupPath}.sha256`;
  if (!existsSync(checksumPath)) throw new Error('verified backup checksum sidecar is missing');
  const backupSha256 = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(backupSha256) || sha256(backupPath) !== backupSha256) {
    throw new Error('attestation backup checksum verification failed');
  }
  const backupManifestPath = path.join(path.dirname(backupPath), 'backup-manifest.json');
  if (!existsSync(backupManifestPath)) throw new Error('database backup source manifest is missing');
  const backupManifest = JSON.parse(readFileSync(backupManifestPath, 'utf8'));
  if (backupManifest.version !== 1 || backupManifest.backupSha256 !== backupSha256) {
    throw new Error('database backup source manifest is invalid');
  }
  const sourceIdentityHash = createHash('sha256')
    .update(`${sourceUrl.hostname}:${sourceUrl.port || '5432'}/${sourceDatabase}`)
    .digest('hex');
  if (backupManifest.sourceIdentityHash !== sourceIdentityHash) {
    throw new Error('database backup source manifest does not match production');
  }
  const provenanceSql = `SELECT json_build_object(
    'rows', count(*),
    'backupSha256', min("backupSha256"),
    'sourceIdentityHash', min("sourceIdentityHash")
  )::text FROM "_aimaimai_rehearsal_provenance"`;
  const baselineProvenance = queryJson(baselineUrl.toString(), provenanceSql);
  const rehearsalProvenance = queryJson(rehearsalUrl.toString(), provenanceSql);
  for (const provenance of [baselineProvenance, rehearsalProvenance]) {
    if (
      Number(provenance.rows) !== 1
      || provenance.backupSha256 !== backupSha256
      || provenance.sourceIdentityHash !== sourceIdentityHash
    ) {
      throw new Error('rehearsal database provenance does not match the verified production backup');
    }
  }

  const baselineFingerprint = queryJson(baselineUrl.toString(), fingerprintSql());
  const rehearsalFingerprint = queryJson(rehearsalUrl.toString(), fingerprintSql());
  if (JSON.stringify(baselineFingerprint) !== JSON.stringify(rehearsalFingerprint)) {
    throw new Error('business primary keys or stable row fields changed during rehearsal migration');
  }

  const expected = queryJson(baselineUrl.toString(), `SELECT COALESCE(json_agg(row_to_json(expected) ORDER BY "refundId", kind), '[]'::json)::text
    FROM (
      SELECT r."id" AS "refundId", 'DIGITAL_ASSET_REVERSAL' AS kind, r."orderId" AS "orderId",
        r."amount" AS "refundAmount", 'HISTORICAL_BACKFILL' AS source, 'PENDING' AS status
      FROM "Refund" r
      WHERE r."status" = 'REFUNDED' AND r."deletedAt" IS NULL AND r."afterSaleId" IS NULL
        AND r."merchantRefundNo" NOT LIKE 'AS-%'
      UNION ALL
      SELECT r."id" AS "refundId", 'CAPTAIN_COMMISSION_VOID' AS kind, r."orderId" AS "orderId",
        r."amount" AS "refundAmount", 'HISTORICAL_BACKFILL' AS source, 'PENDING' AS status
      FROM "Refund" r
      WHERE r."status" = 'REFUNDED' AND r."deletedAt" IS NULL AND r."afterSaleId" IS NULL
        AND r."merchantRefundNo" NOT LIKE 'AS-%'
        AND NOT EXISTS (
          SELECT 1 FROM "OrderProfitSnapshot" s
          WHERE s."orderId" = r."orderId" AND s."isCurrent" = true AND s."status" = 'READY'
        )
    ) expected`);
  const actual = queryJson(rehearsalUrl.toString(), `SELECT COALESCE(json_agg(row_to_json(actual) ORDER BY "refundId", kind), '[]'::json)::text
    FROM (
      SELECT "refundId", "kind"::text AS kind, "orderId", "refundAmount", source, "status"::text AS status
      FROM "RefundSideEffectOutbox"
    ) actual`);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('refund side-effect historical backfill rows mismatch');
  }

  const migrationState = queryJson(rehearsalUrl.toString(), `SELECT json_build_object(
    'complete', count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
    'failed', count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
  )::text FROM "_prisma_migrations"`);
  if (Number(migrationState.complete) !== 120 || Number(migrationState.failed) !== 0) {
    throw new Error('rehearsal migration history is not 120 complete and 0 failed');
  }

  const compatibilityDefaults = queryJson(rehearsalUrl.toString(), `SELECT json_build_object(
    'session', (SELECT count(*) FROM "Session" WHERE "authIdentityId" IS NOT NULL),
    'checkout', (SELECT count(*) FROM "CheckoutSession" WHERE "paymentScene" <> 'APP'
      OR "miniProgramPayerOpenId" IS NOT NULL OR "fulfillmentMode" <> 'DELIVERY'
      OR "pickupRecipientSnapshot" IS NOT NULL OR "pickupSelectionsSnapshot" IS NOT NULL),
    'order', (SELECT count(*) FROM "Order" WHERE "fulfillmentMode" <> 'DELIVERY'),
    'withdraw', (SELECT count(*) FROM "WithdrawRequest" WHERE "providerStateUpdatedAt" IS NOT NULL OR "nextReconcileAt" IS NOT NULL),
    'coupon', (SELECT count(*) FROM "CouponInstance" WHERE "triggerIdempotencyKey" IS NOT NULL),
    'afterSaleShipping', (SELECT count(*) FROM after_sale_shipping_payments WHERE "paymentScene" <> 'APP'
      OR "miniProgramPayerOpenId" IS NOT NULL OR "paymentParamState" IS NOT NULL),
    'inviteH5', (SELECT count(*) FROM "InviteH5LandingEvent" WHERE "miniProgramUrlLink" IS NOT NULL
      OR "miniProgramUrlLinkExpiresAt" IS NOT NULL OR "miniProgramUrlLinkClaimUntil" IS NOT NULL)
  )::text`);
  if (Object.values(compatibilityDefaults).some((count) => Number(count) !== 0)) {
    throw new Error('historical compatibility defaults were not preserved');
  }

  const baselineMigrationState = queryJson(baselineUrl.toString(), `SELECT json_build_object(
    'complete', count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
    'failed', count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL),
    'latest', (SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1)
  )::text FROM "_prisma_migrations"`);
  if (Number(baselineMigrationState.failed) !== 0 || Number(baselineMigrationState.complete) >= Number(migrationState.complete)) {
    throw new Error('baseline migration history is invalid');
  }
  if (
    Number(backupManifest.sourceMigrationCount) !== Number(baselineMigrationState.complete)
    || backupManifest.sourceMigrationHead !== baselineMigrationState.latest
  ) {
    throw new Error('baseline migration history does not match the backup source manifest');
  }

  const candidateSha = required('REHEARSAL_CANDIDATE_SHA');
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) throw new Error('REHEARSAL_CANDIDATE_SHA must be a full commit SHA');
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const currentSha = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (currentSha !== candidateSha) throw new Error('rehearsal checkout does not match REHEARSAL_CANDIDATE_SHA');
  const trackedChanges = execFileSync('git', ['-C', repositoryRoot, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
  if (trackedChanges) throw new Error('rehearsal checkout has tracked changes');
  const migrationTreeGitObject = execFileSync(
    'git',
    ['-C', repositoryRoot, 'rev-parse', `${candidateSha}:backend/prisma/migrations`],
    { encoding: 'utf8' },
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(migrationTreeGitObject)) throw new Error('candidate migration Git tree is invalid');
  const migrationRoot = path.resolve(process.cwd(), 'prisma/migrations');
  const candidateChecksums = candidateMigrationChecksums(migrationRoot);
  const rehearsalChecksums = queryJson(rehearsalUrl.toString(), `SELECT COALESCE(json_agg(
    json_build_object('name', migration_name, 'checksum', checksum) ORDER BY migration_name
  ), '[]'::json)::text FROM "_prisma_migrations"
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  if (JSON.stringify(rehearsalChecksums) !== JSON.stringify(candidateChecksums)) {
    throw new Error('rehearsal migration checksums do not match the final candidate');
  }
  const candidateChecksumMap = new Map(candidateChecksums.map((migration) => [migration.name, migration.checksum]));
  const baselineChecksums = queryJson(baselineUrl.toString(), `SELECT COALESCE(json_agg(
    json_build_object('name', migration_name, 'checksum', checksum) ORDER BY migration_name
  ), '[]'::json)::text FROM "_prisma_migrations"
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  if (
    baselineChecksums.length !== Number(baselineMigrationState.complete)
    || baselineChecksums.some((migration) => candidateChecksumMap.get(migration.name) !== migration.checksum)
  ) {
    throw new Error('baseline migration checksums are not a valid subset of the final candidate');
  }
  const migrationSha256 = migrationTreeSha256(migrationRoot);
  const attestationRoot = '/www/backup/releases/miniapp-rehearsal/attestations';
  mkdirSync(attestationRoot, { recursive: true, mode: 0o700 });
  chmodSync(attestationRoot, 0o700);
  const attestationPath = path.join(attestationRoot, `${candidateSha}.json`);
  if (existsSync(attestationPath)) throw new Error('rehearsal attestation already exists');
  const temporaryPath = `${attestationPath}.tmp-${process.pid}`;
  const attestation = {
    version: 1,
    status: 'complete',
    candidateSha,
    migrationTreeGitObject,
    migrationTreeSha256: migrationSha256,
    migrationChecksumsVerified: true,
    backupPath,
    backupSha256,
    backupManifestPath,
    backupManifestSha256: sha256(backupManifestPath),
    sourceIdentityHash,
    baselineDatabase,
    rehearsalDatabase,
    baselineMigrationCount: Number(baselineMigrationState.complete),
    baselineMigrationHead: String(baselineMigrationState.latest || ''),
    rehearsalMigrationCount: Number(migrationState.complete),
    rehearsalFailedMigrationCount: Number(migrationState.failed),
    stableTableFingerprints: FINGERPRINT_TABLES.length,
    refundBackfillTasks: actual.length,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(temporaryPath, `${JSON.stringify(attestation, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporaryPath, attestationPath);

  process.stdout.write(`rehearsal_data_conservation=ok tables=${FINGERPRINT_TABLES.length}\n`);
  process.stdout.write(`rehearsal_refund_backfill=ok tasks=${actual.length}\n`);
  process.stdout.write(`rehearsal_attestation=created candidate_sha=${candidateSha}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`rehearsal_data_verification=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
