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
  git(['fetch', '--quiet', 'origin', 'staging'], { cwd: repositoryRoot });
  git(['rev-parse', '--verify', 'origin/staging'], { cwd: repositoryRoot });
} catch {
  fail('无法获取 origin/staging。请检查网络和远端权限后重试。');
}

try {
  git(['merge-base', '--is-ancestor', 'origin/staging', 'HEAD'], { cwd: repositoryRoot });
} catch {
  fail('当前提交不包含最新 origin/staging。先从远端最新 staging 建立干净 worktree，禁止在旧目录直接 pull。');
}

const head = git(['rev-parse', '--short=12', 'HEAD'], { cwd: repositoryRoot });
const originStaging = git(['rev-parse', '--short=12', 'origin/staging'], { cwd: repositoryRoot });
process.stdout.write(`${JSON.stringify({
  sourcePath: miniappRoot,
  commit: head,
  originStaging,
  clean: true,
  originStagingContained: true,
  next: '运行 npm run verify；最后运行 npm run build:staging，并在微信开发者工具中确认同一路径后重新编译。',
}, null, 2)}\n`);
