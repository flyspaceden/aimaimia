import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { presentationSyntaxOnly } from './ci-ui-syntax.mjs';

const displayCode = new Set([
  'miniapp/src/pages/home/index.tsx',
  'miniapp/src/components/PageHeader.tsx',
  'miniapp/src/components/SeafoodImage.tsx',
  'miniapp/src/components/functional-icon.tsx',
  'miniapp/src/components/profile-avatar/index.tsx',
]);
const companionDocs = new Set(['plan.md', 'docs/architecture/wechat-mini-program.md']);
const displayStyles = new Set([
  'miniapp/src/pages/home/index.scss',
  'miniapp/src/components/PageHeader.scss',
  'miniapp/src/components/functional-icon.scss',
  'miniapp/src/components/profile-avatar/index.scss',
]);
const displayFile = (name) => displayCode.has(name)
  || displayStyles.has(name)
  || /^miniapp\/src\/assets\/.+\.(?:png|jpe?g|webp)$/.test(name);

export function classifyReleaseScope({ files = [], patch = '', syntaxSafe = false, unsafeModes = false, hasDeletion = false, forceFull = false } = {}) {
  const full = (reason) => ({ mode: 'full', uiOnly: false, reason });
  if (forceFull) return full('explicit full validation');
  if (!files.length || files.length > 12) return full('empty or broad change set');
  if (unsafeModes) return full('symlink or submodule change');
  if (hasDeletion) return full('deletion or rename');
  if (!files.some(displayFile) || !files.every((name) => displayFile(name) || companionDocs.has(name))) {
    return full('change outside the presentation allowlist');
  }
  const changed = patch.split('\n').filter((line) => /^[+-](?![+-])/.test(line));
  if (files.some((name) => displayCode.has(name)) && (!changed.length || changed.length > 120)) {
    return full('missing or broad code patch');
  }
  if (files.some((name) => displayCode.has(name)) && !syntaxSafe) return full('non-presentation syntax change or parser unavailable');
  // UI 入口只复用现有数据和导航；API、认证、状态写入或路由变化回到完整门禁。
  const logic = /\b(?:ApiClient|useQuery|useMutation|useAuthStore|setSession|clearSession|accessToken|refreshToken|requestPayment|navigateTo|redirectTo|switchTab|setStorageSync|removeStorageSync|fetch|price|amount|stock|quantity|inventory|refund|payment|checkout|reward|commission|balance)\b|\b(?:wx|Taro)\s*\.|\b\w*Repo\s*\.|\.(?:get|post|put|patch|delete|mutate|request)\s*\(/;
  if (changed.some((line) => logic.test(line) || (/^[+-]\s*import\b/.test(line) && !/['"][^'"]+\.s?css['"]/.test(line)))) {
    return full('API, authentication, mutation, import or navigation change');
  }
  return { mode: 'miniapp-ui', uiOnly: true, reason: 'small presentation-only miniapp change' };
}

export function e2eGatePassed({ scopeResult, mode, fullResult } = {}) {
  return scopeResult === 'success' && (
    (mode === 'miniapp-ui' && fullResult === 'skipped')
    || (mode === 'full' && fullResult === 'success')
  );
}

export function scopeFromGit({ base, head, event, forceFull = false, cwd = process.cwd() } = {}) {
  const full = (reason) => ({ mode: 'full', uiOnly: false, reason });
  if (forceFull) return full('explicit full validation');
  if (!/^[0-9a-f]{40}$/.test(base || '') || !/^[0-9a-f]{40}$/.test(head || '') || /^0+$/.test(base)) {
    return full('missing or invalid comparison SHA');
  }
  if (!['pull_request', 'push'].includes(event)) return full('manual or reusable workflow');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('cat-file', '-e', `${base}^{commit}`);
    git('cat-file', '-e', `${head}^{commit}`);
    const start = event === 'pull_request' ? git('merge-base', base, head).trim() : base;
    // 不识别 rename：删除旧路径与新增新路径都必须进入范围判定。
    const files = git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', start, head).split('\0').filter(Boolean);
    const raw = git('diff', '--no-ext-diff', '--no-renames', '--raw', start, head);
    const unsafeModes = /^:(?:120000|160000)\b|^:\d{6}\s+(?:120000|160000)\b/m.test(raw);
    const hasDeletion = Boolean(git('diff', '--no-ext-diff', '--no-renames', '--name-only', '--diff-filter=D', start, head).trim());
    const codeFiles = files.filter((name) => displayCode.has(name));
    const patch = codeFiles.length ? git('diff', '--no-ext-diff', '--no-renames', '--unified=0', start, head, '--', ...codeFiles) : '';
    const preliminary = classifyReleaseScope({ files, patch, syntaxSafe: true, unsafeModes, hasDeletion });
    if (!preliminary.uiOnly) return preliminary;
    const syntaxSafe = codeFiles.every((name) => presentationSyntaxOnly(git('show', `${start}:${name}`), git('show', `${head}:${name}`)));
    return classifyReleaseScope({ files, patch, syntaxSafe, unsafeModes, hasDeletion });
  } catch {
    return full('comparison unavailable');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--assert-e2e-result')) {
    if (!e2eGatePassed({ scopeResult: process.env.CI_SCOPE_RESULT, mode: process.env.CI_SCOPE_MODE, fullResult: process.env.CI_FULL_E2E_RESULT })) {
      console.error('Required e2e gate failed or validation mode is unknown');
      process.exit(1);
    }
    console.log(`Required e2e gate passed: ${process.env.CI_SCOPE_MODE}`);
    process.exit(0);
  }
  const result = scopeFromGit({
    base: process.env.CI_SCOPE_BASE,
    head: process.env.CI_SCOPE_HEAD,
    event: process.env.CI_SCOPE_EVENT,
    forceFull: process.env.CI_FORCE_FULL === 'true',
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nui_only=${result.uiOnly}\n`);
  console.log(process.argv.includes('--mode-only') ? result.mode : JSON.stringify(result));
}
