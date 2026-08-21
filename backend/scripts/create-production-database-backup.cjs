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
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BACKUP_ROOT = '/www/backup/database/aimaimai';

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
  const backupPath = path.join(BACKUP_ROOT, `${label}.dump`);
  if (existsSync(backupPath)) throw new Error('backup file already exists');

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

  run('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file', backupPath,
  ], pgEnv, 15 * 60 * 1000);
  chmodSync(backupPath, 0o600);
  if (statSync(backupPath).size === 0) throw new Error('database backup is empty');
  run('pg_restore', ['--list', backupPath], process.env, 2 * 60 * 1000);

  const digest = await sha256(backupPath);
  const verifiedDigest = await sha256(backupPath);
  if (verifiedDigest !== digest) throw new Error('database backup checksum changed during verification');
  writeFileSync(`${backupPath}.sha256`, `${digest}  ${path.basename(backupPath)}\n`, { mode: 0o600 });

  // 本机只保留最近 10 份可恢复备份；离机/PITR 由正式发布前的独立门禁确认。
  const oldBackups = readdirSync(BACKUP_ROOT)
    .filter((name) => name.endsWith('.dump'))
    .map((name) => ({ name, mtimeMs: statSync(path.join(BACKUP_ROOT, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(10);
  for (const oldBackup of oldBackups) {
    const oldPath = path.join(BACKUP_ROOT, oldBackup.name);
    unlinkSync(oldPath);
    if (existsSync(`${oldPath}.sha256`)) unlinkSync(`${oldPath}.sha256`);
  }
  process.stdout.write(`${JSON.stringify({
    database_backup: 'verified',
    file: backupPath,
    sha256: digest,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`database_backup=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
});
