#!/usr/bin/env node

const { accessSync, constants, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readDatabaseUrl() {
  const fromProcess = String(process.env.DATABASE_URL || '').trim();
  if (fromProcess) return fromProcess;

  const contents = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
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
  throw new Error('DATABASE_URL is missing');
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

function main() {
  const parsed = new URL(readDatabaseUrl());
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !database || !parsed.username) {
    throw new Error('DATABASE_URL is incomplete');
  }
  if (database.startsWith('aimaimai_rehearsal_')) {
    throw new Error('readiness source must be the non-rehearsal production database');
  }
  const releaseSha = String(process.env.RELEASE_SHA || '').trim();
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('RELEASE_SHA must be a full commit SHA');
  const attestationPath = `/www/backup/releases/miniapp-rehearsal/attestations/${releaseSha}.json`;
  const attestation = JSON.parse(readFileSync(attestationPath, 'utf8'));
  if (attestation.status !== 'complete' || attestation.candidateSha !== releaseSha) {
    throw new Error('release rehearsal attestation identity is invalid');
  }
  const sourceIdentityHash = createHash('sha256')
    .update(`${parsed.hostname}:${parsed.port || '5432'}/${database}`)
    .digest('hex');
  if (attestation.sourceIdentityHash !== sourceIdentityHash) {
    throw new Error('release rehearsal source database does not match production');
  }

  const pgEnv = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGOPTIONS: '-c default_transaction_read_only=on',
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) pgEnv.PGSSLMODE = sslMode;

  const sql = `
    SELECT 'role_can_create_db=' || r.rolcreatedb::text
      FROM pg_roles r WHERE r.rolname = current_user;
    SELECT 'db_size_bytes=' || pg_database_size(current_database())::text;
    SELECT 'active_connections=' || count(*)::text
      FROM pg_stat_activity WHERE datname = current_database();
    SELECT 'migration_count=' || count(*)::text
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
    SELECT 'failed_migration_count=' || count(*)::text
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL;
    SELECT 'latest_migration=' || migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC LIMIT 1;
    SELECT 'booking_duplicate_groups=' || count(*)::text
      FROM (
        SELECT 1 FROM "Booking" WHERE "groupId" IS NOT NULL
        GROUP BY "userId", "groupId" HAVING count(*) > 1
      ) duplicates;
    SELECT 'address_users_multiple_active_defaults=' || count(*)::text
      FROM (
        SELECT "userId" FROM "Address"
        WHERE "deletedAt" IS NULL AND "isDefault" = true
        GROUP BY "userId" HAVING count(*) > 1
      ) duplicates;
    SELECT 'address_users_active_without_default=' || count(*)::text
      FROM (
        SELECT "userId" FROM "Address" WHERE "deletedAt" IS NULL
        GROUP BY "userId"
        HAVING count(*) FILTER (WHERE "isDefault" = true) = 0
      ) missing_defaults;
    SELECT 'active_address_count=' || count(*)::text
      FROM "Address" WHERE "deletedAt" IS NULL;
  `;
  const result = spawnSync(resolvePsql(), ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    env: pgEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`migration readiness query failed with status ${result.status ?? 'unknown'}`);
  }
  const values = Object.fromEntries(result.stdout.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  if (
    Number(values.migration_count) !== Number(attestation.baselineMigrationCount)
    || Number(values.failed_migration_count) !== 0
    || values.latest_migration !== attestation.baselineMigrationHead
    || Number(values.active_connections) !== 1
  ) {
    throw new Error('production migration baseline drifted after rehearsal');
  }
  for (const key of [
    'booking_duplicate_groups',
    'address_users_multiple_active_defaults',
    'address_users_active_without_default',
  ]) {
    if (Number(values[key]) !== 0) throw new Error(`production migration precondition failed: ${key}`);
  }
  process.stdout.write(result.stdout);
  process.stdout.write(`migration_readiness=valid release_sha=${releaseSha}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`migration_readiness=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
