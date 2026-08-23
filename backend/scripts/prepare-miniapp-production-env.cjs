#!/usr/bin/env node

const { createHash, randomBytes } = require('node:crypto');
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
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const ENV_PATH = '/www/wwwroot/aimaimai-prod-src/backend/.env';
const BACKUP_ROOT = '/www/backup/config/aimaimai';

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function fsyncPath(target) {
  const descriptor = openSync(target, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function parseValue(raw) {
  const dotenv = require('dotenv');
  return dotenv.parse(Buffer.from(`VALUE=${raw}\n`)).VALUE ?? '';
}

function serializeValue(value) {
  if (value.includes("'") || /[\r\n]/.test(value)) {
    throw new Error('env value contains an unsupported quote or line break');
  }
  return `'${value}'`;
}

function main() {
  if (process.env.CONFIRM_MINIAPP_PRODUCTION_ENV !== 'PREPARE_WITHOUT_RESTART') {
    throw new Error('explicit production env preparation confirmation is missing');
  }
  if (!existsSync(ENV_PATH)) throw new Error('production env file is missing');
  const dotenv = require('dotenv');
  const originalStat = statSync(ENV_PATH);
  const original = readFileSync(ENV_PATH, 'utf8');
  const existing = dotenv.parse(Buffer.from(original));

  const pickupSecret = existing.PICKUP_TOKEN_SECRET && Buffer.byteLength(existing.PICKUP_TOKEN_SECRET, 'utf8') >= 32
    ? existing.PICKUP_TOKEN_SECRET
    : randomBytes(32).toString('hex');
  const values = {
    WECHAT_MINIAPP_SUBSCRIBE_STATE: 'formal',
    WECHAT_MINIAPP_SUBSCRIBE_ORDER_SHIPPED_TEMPLATE_ID: 'AaefuI_Uqp1qvX7fNuGbEe3w6Qe4b4M5SUpboeLXvNQ',
    WECHAT_MINIAPP_SUBSCRIBE_ORDER_SHIPPED_FIELDS: '{"reference":"character_string6","status":"phrase18","remark":"thing5","time":"date4"}',
    WECHAT_MINIAPP_SUBSCRIBE_AFTER_SALE_RESULT_TEMPLATE_ID: 'sAQM7NcmYHH6x1nxlqr_Fy2EBushICGBCt42XPsG04Q',
    WECHAT_MINIAPP_SUBSCRIBE_AFTER_SALE_RESULT_FIELDS: '{"reference":"character_string7","status":"thing2","remark":"thing5","time":"time12"}',
    WECHAT_MINIAPP_SUBSCRIBE_WITHDRAW_RESULT_TEMPLATE_ID: '2zKL7siL8vg7U8t31koS272-CQBxTz9ePaXoi1vXAYU',
    WECHAT_MINIAPP_SUBSCRIBE_WITHDRAW_RESULT_FIELDS: '{"status":"phrase2","remark":"thing4","time":"time3"}',
    WECHAT_MINIAPP_CODE_ENV_VERSION: 'release',
    WECHAT_MINIAPP_CODE_CHECK_PATH: 'true',
    WECHAT_TRANSFER_ENABLED: 'true',
    WECHAT_TRANSFER_NOTIFY_URL: 'https://api.ai-maimai.com/api/v1/bonus/withdraw/wechat/notify',
    WECHAT_TRANSFER_SCENE_ID: '1005',
    WECHAT_TRANSFER_USER_RECV_PERCEPTION: '劳务报酬',
    WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON: '[{"info_type":"岗位类型","info_content":"平台推广人员"},{"info_type":"报酬说明","info_content":"AI爱买买平台推广佣金"}]',
    PICKUP_FULFILLMENT_ENABLED: 'true',
    PICKUP_TOKEN_SECRET: pickupSecret,
  };
  for (const forbidden of ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'SELLER_JWT_SECRET', 'DATA_ENCRYPTION_KEY']) {
    if (values.PICKUP_TOKEN_SECRET === existing[forbidden]) throw new Error('pickup secret must be independent');
  }

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
    nextLines.push(`${key}=${serializeValue(values[key])}`);
    seen.add(key);
  }
  const missing = Object.keys(values).filter((key) => !seen.has(key));
  if (missing.length) {
    nextLines.push('', '# Mini-program production launch settings');
    for (const key of missing) nextLines.push(`${key}=${serializeValue(values[key])}`);
  }
  const next = `${nextLines.join('\n').replace(/\n+$/, '')}\n`;

  mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  chmodSync(BACKUP_ROOT, 0o700);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const backupDir = path.join(BACKUP_ROOT, `${timestamp}-before-miniapp-production`);
  const partialBackupDir = `${backupDir}.partial-${process.pid}`;
  if (existsSync(backupDir) || existsSync(partialBackupDir)) throw new Error('production env backup label already exists');
  mkdirSync(partialBackupDir, { mode: 0o700 });
  const partialBackupPath = path.join(partialBackupDir, 'production.env');
  const partialChecksumPath = `${partialBackupPath}.sha256`;
  const backupPath = path.join(backupDir, 'production.env');
  let backupPublished = false;
  try {
    copyFileSync(ENV_PATH, partialBackupPath, constants.COPYFILE_EXCL);
    chmodSync(partialBackupPath, 0o600);
    const digest = sha256(partialBackupPath);
    if (sha256(partialBackupPath) !== digest) throw new Error('production env backup checksum changed');
    writeFileSync(partialChecksumPath, `${digest}  ${path.basename(backupPath)}\n`, { mode: 0o600, flag: 'wx' });
    fsyncPath(partialBackupPath);
    fsyncPath(partialChecksumPath);
    fsyncPath(partialBackupDir);
    renameSync(partialBackupDir, backupDir);
    fsyncPath(BACKUP_ROOT);
    backupPublished = true;
  } finally {
    if (!backupPublished && existsSync(partialBackupDir)) rmSync(partialBackupDir, { recursive: true });
  }

  const temporaryPath = `${ENV_PATH}.miniapp-${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, next, { mode: originalStat.mode & 0o777, flag: 'wx' });
    chownSync(temporaryPath, originalStat.uid, originalStat.gid);
    fsyncPath(temporaryPath);
    renameSync(temporaryPath, ENV_PATH);
    fsyncPath(path.dirname(ENV_PATH));
    const updatedStat = statSync(ENV_PATH);
    if (updatedStat.uid !== originalStat.uid || updatedStat.gid !== originalStat.gid) {
      throw new Error('production env ownership changed');
    }
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  const changed = Object.keys(values).filter((key) => existing[key] !== values[key]);
  process.stdout.write(`miniapp_production_env=prepared_without_restart backup=${backupPath}\n`);
  process.stdout.write(`miniapp_production_env_changed_keys=${changed.join(',')}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`miniapp_production_env=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exit(1);
  }
}

module.exports = { parseValue, serializeValue };
