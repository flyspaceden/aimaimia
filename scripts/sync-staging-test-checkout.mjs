import { existsSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_TARGET = '/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台-staging';
const sourceRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']);
const targetRoot = path.resolve(process.env.AIMAI_STAGING_TEST_CHECKOUT || DEFAULT_TARGET);
const rebindRequested = process.argv.includes('--rebind');
const REBIND_CONFIRMATION = 'RECREATE_STAGING_TEST_CHECKOUT_FROM_ARCHIVED_REMOTE';

function fail(message) {
  process.stderr.write(`测试目录同步失败：${message}\n`);
  process.exit(1);
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.trim()
      : '';
    fail(`${args.join(' ')} 执行失败${detail ? `：${detail}` : ''}`);
  }
}

function run(cwd, command, args) {
  try {
    execFileSync(command, args, { cwd, stdio: 'inherit' });
  } catch {
    fail(`${command} ${args.join(' ')} 未通过；固定测试目录没有被标记为可测试。`);
  }
}

function gitSucceeds(cwd, args) {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function requireSha(name, value) {
  if (!/^[0-9a-f]{40}$/i.test(value || '')) fail(`${name} 必须是已人工核对的 40 位 Git SHA。`);
  return value.toLowerCase();
}

function remoteRefSha(cwd, remote, ref) {
  const output = git(cwd, ['ls-remote', remote, ref]);
  const lines = output.split('\n').filter(Boolean);
  if (lines.length !== 1) fail(`远端保护引用 ${ref} 缺失或不唯一。`);
  return lines[0].split(/\s+/)[0].toLowerCase();
}

if (targetRoot === sourceRoot) {
  fail('目标不能是当前开发 worktree；请保留开发与微信开发者工具测试目录隔离。');
}
if (!existsSync(path.join(targetRoot, '.git'))) {
  fail(`目标不是 Git checkout：${targetRoot}`);
}
if (git(targetRoot, ['status', '--porcelain'])) {
  fail('固定测试目录存在本地改动。先将改动整理到独立分支，禁止覆盖、stash 或 reset。');
}
if (git(targetRoot, ['branch', '--show-current']) !== 'staging') {
  fail('固定测试目录必须停留在 staging 分支，禁止将功能分支直接导入微信开发者工具。');
}

git(targetRoot, ['fetch', '--quiet', 'origin', 'staging']);
const oldSha = git(targetRoot, ['rev-parse', 'HEAD']);
const remoteSha = git(targetRoot, ['rev-parse', 'origin/staging']);
const canFastForward = gitSucceeds(targetRoot, ['merge-base', '--is-ancestor', 'HEAD', 'origin/staging']);
if (rebindRequested && canFastForward) {
  fail('--rebind 只允许处理已批准的非快进 staging 重建；当前目录可正常快进，请去掉该参数。');
}
if (!canFastForward) {
  if (!rebindRequested) {
    fail('固定测试目录与 origin/staging 已分叉。日常同步禁止强制更新；仅在远端三重归档和用户批准均完成后使用 --rebind。');
  }

  if (process.env.AIMAI_STAGING_REBIND_CONFIRM !== REBIND_CONFIRMATION) {
    fail(`--rebind 需要 AIMAI_STAGING_REBIND_CONFIRM=${REBIND_CONFIRMATION}`);
  }
  const expectedOldSha = requireSha('AIMAI_STAGING_EXPECTED_OLD_SHA', process.env.AIMAI_STAGING_EXPECTED_OLD_SHA);
  const expectedNewSha = requireSha('AIMAI_STAGING_EXPECTED_NEW_SHA', process.env.AIMAI_STAGING_EXPECTED_NEW_SHA);
  if (oldSha.toLowerCase() !== expectedOldSha) fail('固定测试目录 HEAD 与批准的旧 staging SHA 不一致。');
  if (remoteSha.toLowerCase() !== expectedNewSha) fail('origin/staging 与批准的新 staging SHA 不一致。');

  const archiveRef = process.env.AIMAI_STAGING_ARCHIVE_REF || 'refs/heads/archive/staging-pre-main-20260822';
  const deliveryRef = process.env.AIMAI_STAGING_DELIVERY_REF || 'refs/heads/delivery/staging';
  const archiveTagRef = process.env.AIMAI_STAGING_ARCHIVE_TAG_REF || 'refs/tags/archive/staging-pre-main-20260822^{}';
  for (const ref of [archiveRef, deliveryRef, archiveTagRef]) {
    if (remoteRefSha(targetRoot, 'origin', ref) !== expectedOldSha) {
      fail(`远端保护引用 ${ref} 未精确保存旧 staging SHA。`);
    }
  }

  const parentRoot = path.dirname(targetRoot);
  const cloneRoot = `${targetRoot}-rebind-${expectedNewSha.slice(0, 12)}`;
  const backupRoot = `${targetRoot}-legacy-${expectedOldSha.slice(0, 12)}`;
  if (existsSync(cloneRoot) || existsSync(backupRoot)) fail('rebind 临时目录或旧目录备份已存在，禁止覆盖。');

  const originUrl = git(targetRoot, ['remote', 'get-url', 'origin']);
  run(parentRoot, 'git', ['clone', '--branch', 'staging', '--single-branch', originUrl, cloneRoot]);
  if (git(cloneRoot, ['rev-parse', 'HEAD']).toLowerCase() !== expectedNewSha) {
    fail('新克隆的 staging HEAD 与批准的新 SHA 不一致；旧测试目录尚未移动。');
  }
  if (git(cloneRoot, ['status', '--porcelain'])) fail('新克隆的 staging 工作树不干净；旧测试目录尚未移动。');

  try {
    renameSync(targetRoot, backupRoot);
    renameSync(cloneRoot, targetRoot);
  } catch {
    if (!existsSync(targetRoot) && existsSync(backupRoot)) renameSync(backupRoot, targetRoot);
    fail('替换固定测试目录失败；已尽力恢复旧目录，禁止继续构建。');
  }
}

if (canFastForward && oldSha !== remoteSha) run(targetRoot, 'git', ['merge', '--ff-only', 'origin/staging']);

const miniappRoot = path.join(targetRoot, 'miniapp');
if (!existsSync(path.join(miniappRoot, 'package-lock.json'))) {
  fail(`固定测试目录不含小程序工程：${miniappRoot}`);
}

// 每次同步均用 lockfile 重建依赖，避免开发者工具继续使用上一版本的二维码、Taro 或 API 依赖。
run(miniappRoot, 'npm', ['ci']);
run(miniappRoot, 'npm', ['run', 'verify:release-context']);
run(miniappRoot, 'npm', ['run', 'build:staging']);
if (git(targetRoot, ['status', '--porcelain'])) {
  fail('依赖安装或构建后固定测试目录出现未提交改动，禁止标记为可测试。');
}

process.stdout.write(`${JSON.stringify({
  sourcePath: miniappRoot,
  sourceSha: git(targetRoot, ['rev-parse', '--short=12', 'HEAD']),
  previousSha: oldSha.slice(0, 12),
  remoteStaging: remoteSha.slice(0, 12),
  rebind: rebindRequested,
  backupPath: rebindRequested ? `${targetRoot}-legacy-${oldSha.slice(0, 12)}` : null,
  clean: true,
  next: '在微信开发者工具确认同一路径后，清除全部缓存并重新编译或真机调试。',
}, null, 2)}\n`);
