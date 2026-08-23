#!/usr/bin/env node

const { accessSync, constants, existsSync, readFileSync, statfsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function required(key) {
  const current = String(process.env[key] || '').trim();
  if (!current) throw new Error(`${key} is missing`);
  return current;
}

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

function resolveBinary(name) {
  const configuredDir = String(process.env.PG_BIN_DIR || '').trim();
  const candidates = [
    configuredDir && path.join(configuredDir, name),
    path.join('/www/server/pgsql/bin', name),
    path.join('/usr/local/pgsql/bin', name),
    path.join('/usr/bin', name),
    name,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === name) return candidate;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next known installation location.
    }
  }
  return name;
}

function run(command, args, env, timeout) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} failed with status ${result.status ?? 'unknown'}`);
  }
  return result.stdout.trim();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sha256File(filePath) {
  const result = spawnSync('sha256sum', ['--', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000 });
  if (result.error || result.status !== 0) throw new Error('sha256sum failed');
  const digest = result.stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('sha256sum returned an invalid digest');
  return digest;
}

function main() {
  const rehearsalDatabase = required('REHEARSAL_DATABASE_NAME');
  if (!/^aimaimai_rehearsal_[a-z0-9_]{8,64}$/.test(rehearsalDatabase)) {
    throw new Error('REHEARSAL_DATABASE_NAME must use the isolated aimaimai_rehearsal_ prefix');
  }
  const backupPath = path.resolve(required('DATABASE_BACKUP_PATH'));
  if (!backupPath.startsWith('/www/backup/database/aimaimai/') || !backupPath.endsWith('.dump') || !existsSync(backupPath)) {
    throw new Error('DATABASE_BACKUP_PATH is outside the approved backup root or missing');
  }
  const checksumPath = `${backupPath}.sha256`;
  if (!existsSync(checksumPath)) throw new Error('verified backup checksum sidecar is missing');
  const recordedChecksum = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  const actualChecksum = sha256File(backupPath);
  if (!/^[0-9a-f]{64}$/.test(recordedChecksum) || actualChecksum !== recordedChecksum) {
    throw new Error('database backup checksum verification failed');
  }
  const manifestPath = path.join(path.dirname(backupPath), 'backup-manifest.json');
  if (!existsSync(manifestPath)) throw new Error('database backup source manifest is missing');
  const backupManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (backupManifest.version !== 1 || backupManifest.backupSha256 !== actualChecksum) {
    throw new Error('database backup source manifest is invalid');
  }

  const parsed = new URL(readDatabaseUrl());
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const sourceDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!sourceDatabase || sourceDatabase.startsWith('aimaimai_rehearsal_')) {
    throw new Error('source database must be a non-rehearsal PostgreSQL database');
  }
  const sourceIdentityHash = createHash('sha256')
    .update(`${parsed.hostname}:${parsed.port || '5432'}/${sourceDatabase}`)
    .digest('hex');
  if (backupManifest.sourceIdentityHash !== sourceIdentityHash) {
    throw new Error('database backup was created from a different source database');
  }
  if (required('ALLOW_SAME_CLUSTER_REHEARSAL') !== 'I_UNDERSTAND_THIS_USES_PRODUCTION_CLUSTER') {
    throw new Error('same-cluster rehearsal requires the explicit production-resource acknowledgement');
  }
  const sourceEnv = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: sourceDatabase,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGOPTIONS: '-c default_transaction_read_only=on',
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) sourceEnv.PGSSLMODE = sslMode;
  const sourceSize = Number(run(resolveBinary('psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', 'SELECT pg_database_size(current_database())'], sourceEnv, 60_000));
  const adminEnv = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: 'postgres',
    PGUSER: required('PG_ADMIN_USER'),
    PGPASSWORD: required('PG_ADMIN_PASSWORD'),
  };
  if (sslMode) adminEnv.PGSSLMODE = sslMode;
  const adminSourceEnv = { ...adminEnv, PGDATABASE: sourceDatabase, PGOPTIONS: '-c default_transaction_read_only=on' };
  const requiredFreeBytes = Math.max(5 * 1024 ** 3, sourceSize * 5);
  const storagePaths = run(
    resolveBinary('psql'),
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', `SELECT DISTINCT path FROM (
      SELECT current_setting('data_directory') AS path
      UNION ALL
      SELECT NULLIF(pg_tablespace_location(oid), '') AS path FROM pg_tablespace
    ) storage WHERE path IS NOT NULL`],
    adminSourceEnv,
    60_000,
  ).split(/\r?\n/).filter(Boolean);
  const freeBytes = Math.min(...storagePaths.map((storagePath) => {
    const fileSystem = statfsSync(storagePath);
    return Number(fileSystem.bavail) * Number(fileSystem.bsize);
  }));
  if (!Number.isSafeInteger(sourceSize) || sourceSize <= 0 || !Number.isFinite(freeBytes) || freeBytes < requiredFreeBytes) {
    throw new Error('same-cluster rehearsal has insufficient verified free space');
  }

  const psql = resolveBinary('psql');
  const pgRestore = resolveBinary('pg_restore');
  const existing = run(
    psql,
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', `SELECT count(*) FROM pg_database WHERE datname = '${rehearsalDatabase}'`],
    adminEnv,
    60_000,
  );
  if (existing !== '0') throw new Error('rehearsal database already exists');

  const quotedName = quoteIdentifier(rehearsalDatabase);
  const appUser = decodeURIComponent(parsed.username);
  const restoreEnv = {
    ...adminEnv,
    PGDATABASE: rehearsalDatabase,
    PGUSER: appUser,
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
  run(
    psql,
    ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${quotedName} OWNER ${quoteIdentifier(appUser)}`],
    adminEnv,
    60_000,
  );
  try {
    run(
      pgRestore,
      ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', rehearsalDatabase, backupPath],
      restoreEnv,
      15 * 60_000,
    );
    run(
      psql,
      ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `
        CREATE TABLE "_aimaimai_rehearsal_provenance" (
          "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
          "backupSha256" CHAR(64) NOT NULL,
          "sourceIdentityHash" CHAR(64) NOT NULL,
          "restoredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO "_aimaimai_rehearsal_provenance" ("id", "backupSha256", "sourceIdentityHash")
        VALUES (1, '${actualChecksum}', '${sourceIdentityHash}');
      `],
      restoreEnv,
      60_000,
    );
  } catch (error) {
    run(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE ${quotedName} WITH (FORCE)`], adminEnv, 60_000);
    throw error;
  }
  process.stdout.write(`rehearsal_database=created name=${rehearsalDatabase}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`rehearsal_database=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
