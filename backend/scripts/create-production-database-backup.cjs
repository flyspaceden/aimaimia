#!/usr/bin/env node

const { createHash } = require('node:crypto');
const {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  chmodSync,
  statSync,
  writeFileSync,
  accessSync,
  constants,
  renameSync,
  rmSync,
  openSync,
  fsyncSync,
  closeSync,
} = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const backupProfile = process.env.DATABASE_BACKUP_PROFILE || 'production';
if (!['production', 'staging'].includes(backupProfile)) throw new Error('invalid database backup profile');
// Keep test retention completely separate from production backup retention.
const BACKUP_ROOT = backupProfile === 'staging'
  ? '/www/backup/database/aimaimai-staging'
  : '/www/backup/database/aimaimai';

function resolvePostgresBinary(name) {
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

function fsyncPath(target) {
  const descriptor = openSync(target, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readDatabaseUrl() {
  const fromProcess = String(process.env.DATABASE_URL || '').trim();
  if (fromProcess) return fromProcess;

  const envPath = path.resolve(process.cwd(), '.env');
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
  throw new Error('DATABASE_URL is missing');
}

function run(command, args, env, timeout) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status ?? 'unknown'}`);
  }
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const label = String(process.env.DATABASE_BACKUP_LABEL || '').trim();
  if (!/^[0-9A-Za-z._-]{8,120}$/.test(label)) {
    throw new Error('DATABASE_BACKUP_LABEL is invalid');
  }

  const parsed = new URL(readDatabaseUrl());
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !database || !parsed.username) {
    throw new Error('DATABASE_URL is incomplete');
  }

  mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  chmodSync(BACKUP_ROOT, 0o700);
  const backupDir = path.join(BACKUP_ROOT, label);
  const partialDir = path.join(BACKUP_ROOT, `${label}.partial-${process.pid}`);
  const backupPath = path.join(backupDir, 'database.dump');
  const manifestPath = path.join(backupDir, 'backup-manifest.json');
  const partialBackupPath = path.join(partialDir, 'database.dump');
  const partialChecksumPath = `${partialBackupPath}.sha256`;
  const partialManifestPath = path.join(partialDir, 'backup-manifest.json');
  if (existsSync(backupDir) || existsSync(partialDir)) throw new Error('backup label already exists');
  mkdirSync(partialDir, { mode: 0o700 });

  const pgEnv = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) pgEnv.PGSSLMODE = sslMode;

  const pgDump = resolvePostgresBinary('pg_dump');
  const pgRestore = resolvePostgresBinary('pg_restore');
  const psql = resolvePostgresBinary('psql');
  let published = false;
  try {
    run(pgDump, [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file', partialBackupPath,
    ], pgEnv, 15 * 60 * 1000);
    chmodSync(partialBackupPath, 0o600);
    if (statSync(partialBackupPath).size === 0) throw new Error('database backup is empty');
    run(pgRestore, ['--list', partialBackupPath], process.env, 2 * 60 * 1000);

    const digest = await sha256(partialBackupPath);
    const verifiedDigest = await sha256(partialBackupPath);
    if (verifiedDigest !== digest) throw new Error('database backup checksum changed during verification');
    writeFileSync(partialChecksumPath, `${digest}  ${path.basename(backupPath)}\n`, { mode: 0o600 });
    const sourceIdentityHash = createHash('sha256')
      .update(`${parsed.hostname}:${parsed.port || '5432'}/${database}`)
      .digest('hex');
    const migrationResult = spawnSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', `SELECT json_build_object(
      'complete', count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
      'failed', count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL),
      'latest', (SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1)
    )::text FROM "_prisma_migrations"`], {
      env: { ...pgEnv, PGOPTIONS: '-c default_transaction_read_only=on' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    if (migrationResult.error || migrationResult.status !== 0) throw new Error('backup source migration query failed');
    const migrationState = JSON.parse(migrationResult.stdout.trim());
    if (Number(migrationState.failed) !== 0) throw new Error('backup source has an unfinished migration');
    writeFileSync(partialManifestPath, `${JSON.stringify({
      version: 1,
      label,
      sourceIdentityHash,
      backupSha256: digest,
      sourceMigrationCount: Number(migrationState.complete),
      sourceMigrationHead: String(migrationState.latest || ''),
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fsyncPath(partialBackupPath);
    fsyncPath(partialChecksumPath);
    fsyncPath(partialManifestPath);
    fsyncPath(partialDir);
    renameSync(partialDir, backupDir);
    fsyncPath(BACKUP_ROOT);
    published = true;

    // Rotate only verified dump/checksum pairs. Partial or mismatched files never
    // displace a known-restorable backup.
    const verifiedBackups = [];
    for (const entry of readdirSync(BACKUP_ROOT, { withFileTypes: true }).filter((item) => item.isDirectory() && !item.name.includes('.partial-'))) {
      const currentPath = path.join(BACKUP_ROOT, entry.name, 'database.dump');
      const currentChecksumPath = `${currentPath}.sha256`;
      const currentManifestPath = path.join(BACKUP_ROOT, entry.name, 'backup-manifest.json');
      if (!existsSync(currentPath) || !existsSync(currentChecksumPath) || !existsSync(currentManifestPath)) continue;
      try {
        const recorded = readFileSync(currentChecksumPath, 'utf8').trim().split(/\s+/)[0];
        const manifest = JSON.parse(readFileSync(currentManifestPath, 'utf8'));
        if (
          !/^[0-9a-f]{64}$/.test(recorded)
          || await sha256(currentPath) !== recorded
          || manifest.version !== 1
          || manifest.backupSha256 !== recorded
          || !/^[0-9a-f]{64}$/.test(String(manifest.sourceIdentityHash || ''))
        ) continue;
        verifiedBackups.push({ name: entry.name, mtimeMs: statSync(currentPath).mtimeMs });
      } catch {
        // A damaged historical entry must never prevent publishing a new,
        // independently verified backup. It is left in place for manual review.
      }
    }
    for (const oldBackup of verifiedBackups.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(10)) {
      rmSync(path.join(BACKUP_ROOT, oldBackup.name), { recursive: true });
    }
    process.stdout.write(`${JSON.stringify({
      database_backup: 'verified',
      file: backupPath,
      sha256: digest,
      manifest: manifestPath,
    })}\n`);
  } finally {
    if (!published) {
      if (existsSync(partialDir)) rmSync(partialDir, { recursive: true });
      if (existsSync(backupDir)) rmSync(backupDir, { recursive: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`database_backup=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
});
