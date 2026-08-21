import { execFileSync } from 'node:child_process';
import path from 'node:path';

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fail(message) {
  process.stderr.write(`小程序发布上下文校验失败：${message}\n`);
  process.exit(1);
}

const miniappRoot = path.resolve(process.cwd());
let repositoryRoot = '';
const channel = process.env.MINIAPP_RELEASE_CHANNEL;
if (channel !== 'staging' && channel !== 'production') {
  fail('必须显式设置 MINIAPP_RELEASE_CHANNEL=staging 或 production。');
}
const targetBranch = channel === 'production' ? 'main' : 'staging';
const originRef = `origin/${targetBranch}`;

try {
  repositoryRoot = git(['rev-parse', '--show-toplevel'], { cwd: miniappRoot });
} catch {
  fail('当前目录不在 Git 仓库内。请在受控 worktree 的 miniapp/ 目录运行。');
}

if (miniappRoot !== path.join(repositoryRoot, 'miniapp')) {
  fail(`必须从 <repo>/miniapp 运行，当前为 ${miniappRoot}`);
}

const dirty = git(['status', '--porcelain'], { cwd: repositoryRoot });
if (dirty) {
  fail('工作区存在未提交改动。不得从脏目录编译、预览、真机调试或推送。');
}

try {
  git(['fetch', '--quiet', 'origin', targetBranch], { cwd: repositoryRoot });
  git(['rev-parse', '--verify', originRef], { cwd: repositoryRoot });
} catch {
  fail(`无法获取 ${originRef}。请检查网络和远端权限后重试。`);
}

const headFull = git(['rev-parse', 'HEAD'], { cwd: repositoryRoot });
const originFull = git(['rev-parse', originRef], { cwd: repositoryRoot });
if (headFull !== originFull) {
  fail(`当前提交必须与 ${originRef} 完全一致；禁止从未合并提交或旧提交生成发布 artifact。`);
}

const head = git(['rev-parse', '--short=12', 'HEAD'], { cwd: repositoryRoot });
const originCommit = git(['rev-parse', '--short=12', originRef], { cwd: repositoryRoot });
process.stdout.write(`${JSON.stringify({
  sourcePath: miniappRoot,
  commit: head,
  channel,
  originRef,
  originCommit,
  clean: true,
  exactOriginMatch: true,
  next: `运行 npm run verify；正式产物必须运行 npm run build:${channel}。`,
}, null, 2)}\n`);
