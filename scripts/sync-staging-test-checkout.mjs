import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_TARGET = '/Users/jamesheden/Desktop/农脉 - AI赋能农业电商平台-staging';
const sourceRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']);
const targetRoot = path.resolve(process.env.AIMAI_STAGING_TEST_CHECKOUT || DEFAULT_TARGET);

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
if (!gitSucceeds(targetRoot, ['merge-base', '--is-ancestor', 'HEAD', 'origin/staging'])) {
  fail('固定测试目录与 origin/staging 已分叉。请先建立恢复分支并人工整理，禁止强制同步。');
}

if (oldSha !== remoteSha) run(targetRoot, 'git', ['merge', '--ff-only', 'origin/staging']);

const miniappRoot = path.join(targetRoot, 'miniapp');
if (!existsSync(path.join(miniappRoot, 'package-lock.json'))) {
  fail(`固定测试目录不含小程序工程：${miniappRoot}`);
}

// 每次同步均用 lockfile 重建依赖，避免开发者工具继续使用上一版本的二维码、Taro 或 API 依赖。
run(miniappRoot, 'npm', ['ci']);
run(miniappRoot, 'npm', ['run', 'verify:release-context']);
run(miniappRoot, 'npm', ['run', 'build:staging']);

process.stdout.write(`${JSON.stringify({
  sourcePath: miniappRoot,
  sourceSha: git(targetRoot, ['rev-parse', '--short=12', 'HEAD']),
  previousSha: oldSha.slice(0, 12),
  remoteStaging: remoteSha.slice(0, 12),
  clean: !git(targetRoot, ['status', '--porcelain']),
  next: '在微信开发者工具确认同一路径后，清除全部缓存并重新编译或真机调试。',
}, null, 2)}\n`);
