#!/usr/bin/env node

const { createHash } = require('node:crypto');
const {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const DEFAULT_ENV_PATH = '/www/wwwroot/aimaimai-staging-src/backend/.env';
const DEFAULT_BACKUP_ROOT = '/www/backup/config/aimaimai-staging';
const ENV_PATH = process.env.AIMAI_STAGING_ENV_PATH || DEFAULT_ENV_PATH;
const BACKUP_ROOT = process.env.AIMAI_STAGING_BACKUP_ROOT || DEFAULT_BACKUP_ROOT;
if (
  (ENV_PATH !== DEFAULT_ENV_PATH || BACKUP_ROOT !== DEFAULT_BACKUP_ROOT)
  && process.env.ALLOW_STAGING_ENV_TEST_PATHS !== 'true'
) {
  throw new Error('staging env path override is test-only');
}

function fsyncPath(target) {
  const descriptor = openSync(target, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function digest(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function serialize(value) {
  if (value.includes("'") || /[\r\n]/.test(value)) throw new Error('unsupported env value');
  return `'${value}'`;
}

function main() {
  if (process.env.CONFIRM_MINIAPP_STAGING_ENV !== 'PREPARE_STAGING_WITHOUT_RESTART') {
    throw new Error('explicit staging env preparation confirmation is missing');
  }
  if (!existsSync(ENV_PATH)) throw new Error('staging env file is missing');

  const original = readFileSync(ENV_PATH, 'utf8');
  const originalStat = statSync(ENV_PATH);
  const existing = require('dotenv').parse(Buffer.from(original));
  const sfPushSecret = String(existing.SF_PUSH_SECRET || '').trim();
  if (!/^[0-9a-fA-F]{32,}$/.test(sfPushSecret)) {
    throw new Error('SF_PUSH_SECRET must be an existing 32+ hex staging secret');
  }
  const values = {
    CORS_ORIGINS: 'https://app.ai-maimai.com,https://test-api.ai-maimai.com,https://test-admin.ai-maimai.com,https://test-seller.ai-maimai.com',
    WECHAT_MINIAPP_SUBSCRIBE_STATE: 'developer',
    WECHAT_MINIAPP_SUBSCRIBE_ORDER_SHIPPED_TEMPLATE_ID: 'AaefuI_Uqp1qvX7fNuGbEe3w6Qe4b4M5SUpboeLXvNQ',
    WECHAT_MINIAPP_SUBSCRIBE_ORDER_SHIPPED_FIELDS: '{"reference":"character_string6","status":"phrase18","remark":"thing5","time":"date4"}',
    WECHAT_MINIAPP_SUBSCRIBE_AFTER_SALE_RESULT_TEMPLATE_ID: 'sAQM7NcmYHH6x1nxlqr_Fy2EBushICGBCt42XPsG04Q',
    WECHAT_MINIAPP_SUBSCRIBE_AFTER_SALE_RESULT_FIELDS: '{"reference":"character_string7","status":"thing2","remark":"thing5","time":"time12"}',
    WECHAT_MINIAPP_SUBSCRIBE_WITHDRAW_RESULT_TEMPLATE_ID: '2zKL7siL8vg7U8t31koS272-CQBxTz9ePaXoi1vXAYU',
    WECHAT_MINIAPP_SUBSCRIBE_WITHDRAW_RESULT_FIELDS: '{"status":"phrase2","remark":"thing4","time":"time3"}',
    WECHAT_MINIAPP_CODE_ENV_VERSION: 'develop',
    WECHAT_MINIAPP_CODE_CHECK_PATH: 'false',
    SF_CALLBACK_URL: `https://test-api.ai-maimai.com/api/v1/shipments/sf/callback/${sfPushSecret}`,
  };

  const seen = new Set();
  const nextLines = [];
  for (const rawLine of original.split(/\r?\n/)) {
    const separator = rawLine.indexOf('=');
    const key = separator > 0 ? rawLine.slice(0, separator).trim() : '';
    if (!(key in values)) {
      nextLines.push(rawLine);
      continue;
    }
    if (seen.has(key)) continue;
    nextLines.push(`${key}=${serialize(values[key])}`);
    seen.add(key);
  }
  const missing = Object.keys(values).filter((key) => !seen.has(key));
  if (missing.length) {
    nextLines.push('', '# Mini-program staging validation settings');
    for (const key of missing) nextLines.push(`${key}=${serialize(values[key])}`);
  }
  const next = `${nextLines.join('\n').replace(/\n+$/, '')}\n`;

  mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  chmodSync(BACKUP_ROOT, 0o700);
  const label = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${process.pid}`;
  const backupPath = path.join(BACKUP_ROOT, `${label}-before-miniapp-staging.env`);
  const checksumPath = `${backupPath}.sha256`;
  copyFileSync(ENV_PATH, backupPath, constants.COPYFILE_EXCL);
  chmodSync(backupPath, 0o600);
  if (digest(readFileSync(backupPath)) !== digest(original)) throw new Error('staging env backup checksum changed');
  writeFileSync(checksumPath, `${digest(original)}  ${path.basename(backupPath)}\n`, { mode: 0o600, flag: 'wx' });
  fsyncPath(backupPath);
  fsyncPath(checksumPath);
  fsyncPath(BACKUP_ROOT);

  const temporaryPath = `${ENV_PATH}.miniapp-staging-${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, next, { mode: originalStat.mode & 0o777, flag: 'wx' });
    chownSync(temporaryPath, originalStat.uid, originalStat.gid);
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, ENV_PATH);
    fsyncPath(path.dirname(ENV_PATH));
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }

  const changed = Object.keys(values).filter((key) => !original.includes(`${key}=${serialize(values[key])}`));
  process.stdout.write(`miniapp_staging_env=prepared_without_restart backup=${backupPath}\n`);
  process.stdout.write(`miniapp_staging_env_changed_keys=${changed.join(',')}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`miniapp_staging_env=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exit(1);
  }
}

module.exports = { serialize };
