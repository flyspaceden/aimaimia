#!/usr/bin/env node

const { accessSync, constants, readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function required(key) {
  const current = String(process.env[key] || '').trim();
  if (!current) throw new Error(`${key} is missing`);
  return current;
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

function run(command, args, env, timeout, allowedFailurePattern = null) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error || result.status !== 0) {
    const diagnostic = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (!result.error && allowedFailurePattern?.test(diagnostic)) return;
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`);
  }
}

function main() {
  const rehearsalDatabase = required('REHEARSAL_DATABASE_NAME');
  if (!/^aimaimai_rehearsal_[a-z0-9_]{8,64}$/.test(rehearsalDatabase)) {
    throw new Error('REHEARSAL_DATABASE_NAME must use the isolated aimaimai_rehearsal_ prefix');
  }
  const sourceEnvPath = path.resolve(required('SOURCE_DATABASE_ENV_PATH'));
  const databaseUrl = new URL(readDatabaseUrl(sourceEnvPath));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname || !databaseUrl.username) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const sourceDatabase = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  if (!sourceDatabase || sourceDatabase.startsWith('aimaimai_rehearsal_')) {
    throw new Error('source environment must identify the non-rehearsal production database');
  }
  databaseUrl.pathname = `/${rehearsalDatabase}`;
  const rehearsalUrl = databaseUrl.toString();
  const commandEnv = { ...process.env, DATABASE_URL: rehearsalUrl };

  process.stdout.write('rehearsal_prisma_validate=start\n');
  run('npx', ['--no-install', 'prisma', 'validate'], commandEnv, 2 * 60_000);
  process.stdout.write('rehearsal_migrate_status_before=start\n');
  run(
    'npx',
    ['--no-install', 'prisma', 'migrate', 'status'],
    commandEnv,
    2 * 60_000,
    /Following migrations have not yet been applied:/,
  );
  process.stdout.write('rehearsal_migrate_deploy=start\n');
  run('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], commandEnv, 10 * 60_000);
  process.stdout.write('rehearsal_migrate_status_after=start\n');
  run('npx', ['--no-install', 'prisma', 'migrate', 'status'], commandEnv, 2 * 60_000);

  const parsed = new URL(rehearsalUrl);
  const pgEnv = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: rehearsalDatabase,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) pgEnv.PGSSLMODE = sslMode;
  const sql = `
    SELECT 'migration_count=' || count(*)::text
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
    SELECT 'failed_migration_count=' || count(*)::text
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL;
    SELECT 'pickup_points=' || count(*)::text FROM "PickupPoint";
    SELECT 'order_received_outbox=' || count(*)::text FROM "OrderReceivedEffectOutbox";
    SELECT 'refund_side_effect_outbox=' || count(*)::text FROM "RefundSideEffectOutbox";
  `;
  run(resolveBinary('psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], pgEnv, 60_000);
  process.stdout.write('rehearsal_migration=ok\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`rehearsal_migration=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
