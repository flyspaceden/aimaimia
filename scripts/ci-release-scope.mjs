import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { presentationSyntaxOnly, miniappRouteConfig } from './ci-frontend-syntax.mjs';

const riskPath = /(?:^|\/)(?:_layout|auth|account|login|privacy|legal|security|consent|permission|cart|checkout|payment|wallet|withdraw|member|after-sales?|orders?|refund|invoices?|vip|lottery|growth|coupon|bonus|queue|digital-assets|group-buy|delivery|quantity|amount|price|stock|inventory|reward|commission|profit|balance|asset)(?:[\/.\-]|$)/i;
const sensitivePath = (name) => {
  const normalized = name.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase();
  return riskPath.test(normalized) || normalized.split(/[\/\.\-]/).some((part) => riskPath.test('/' + part + '.tsx'));
};
const companionDocs = new Set(['plan.md', 'docs/architecture/frontend.md', 'docs/architecture/wechat-mini-program.md', 'docs/architecture/responsive-design.md']);
export const frontendClient = (name) => /^miniapp\//.test(name) ? 'miniapp' : /^(?:app\/|src\/|assets\/)/.test(name) ? 'app' : null;
const displayCode = (name) => !sensitivePath(name) && /^(?:app\/.+|src\/components\/.+|miniapp\/src\/(?:pages|packages|components)\/.+)\.tsx$/.test(name);
const displayFile = (name) => displayCode(name) || (!sensitivePath(name) && /^miniapp\/src\/.+\.scss$/.test(name)) || /^(?:assets\/.+|miniapp\/src\/assets\/.+)\.(?:png|jpe?g|webp)$/.test(name);
const fastModes = new Set(['miniapp-ui', 'app-ui', 'frontend-ui']);
export function affectedClients(files = []) {
  const shared = files.some((name) => /^(?:backend\/|assets\/seafood\/|src\/content\/legal\/|\.github\/workflows\/(?:e2e|miniapp-ci)\.yml$|scripts\/ci-(?:release-scope|ui-syntax|frontend[^/]*)\.mjs$|scripts\/__tests__\/ci-release-scope\.test\.mjs$)/.test(name));
  return { app: shared || files.some((name) => /^(?:app\/|src\/|assets\/|package(?:-lock)?\.json$|tsconfig\.json$|app\.(?:config\.[cm]?[jt]s|json)$|eas\.json$|jest\.config\.js$)/.test(name)), miniapp: shared || files.some((name) => /^miniapp\//.test(name)) };
}
export function classifyReleaseScope({ files = [], patch = '', syntaxSafe = false, unsafeModes = false, hasDeletion = false, forceFull = false } = {}) {
  const clients = affectedClients(files);
  const full = (reason) => ({ mode: 'full', uiOnly: false, ...clients, reason });
  if (forceFull) return full('explicit full validation');
  if (!files.length || files.length > 12) return full('empty or broad change set');
  if (unsafeModes || hasDeletion) return full('symlink, submodule, deletion or rename');
  if (!files.some(displayFile) || !files.every((name) => displayFile(name) || companionDocs.has(name))) return full('outside simple frontend scope');
  const changed = patch.split('\n').filter((line) => /^[+-](?![+-])/.test(line));
  if (files.some(displayCode) && (!changed.length || changed.length > 120 || !syntaxSafe)) return full('broad patch, behavior change or parser unavailable');
  // AST 是主判定；明确的业务/网络写入信号额外回到完整门禁。
  const business = /\b(?:ApiClient|useQuery|useMutation|useAuthStore|setSession|clearSession|accessToken|refreshToken|requestPayment|setStorageSync|removeStorageSync|fetch|price|amount|stock|quantity|inventory|refund|payment|checkout|reward|commission|balance)\b|\b\w*Repo\s*\.|\.(?:get|post|put|patch|delete|mutate|request)\s*\(/;
  if (changed.some((line) => business.test(line))) return full('business, authentication or network change');
  const mode = clients.app && clients.miniapp ? 'frontend-ui' : clients.app ? 'app-ui' : 'miniapp-ui';
  return { mode, uiOnly: true, ...clients, reason: 'small presentation or isolated local UI interaction' };
}
export function e2eGatePassed({ scopeResult, mode, fullResult } = {}) {
  return scopeResult === 'success' && ((fastModes.has(mode) && fullResult === 'skipped') || (mode === 'full' && fullResult === 'success'));
}
export function frontendGatePassed({ scopeResult, appRequired, miniappRequired, appResult, miniappResult } = {}) {
  const relevant = (required, result) => required === 'true' ? result === 'success' : required === 'false' && result === 'skipped';
  return scopeResult === 'success' && relevant(appRequired, appResult) && relevant(miniappRequired, miniappResult);
}
export function comparisonFromGit({ base, head, event, cwd = process.cwd() } = {}) {
  if (!/^[0-9a-f]{40}$/.test(base || '') || !/^[0-9a-f]{40}$/.test(head || '') || /^0+$/.test(base) || !['pull_request', 'push'].includes(event)) throw new Error('invalid comparison');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('cat-file', '-e', `${base}^{commit}`); git('cat-file', '-e', `${head}^{commit}`);
  const start = event === 'pull_request' ? git('merge-base', base, head).trim() : base;
  const files = git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', start, head).split('\0').filter(Boolean);
  return { git, start, files };
}
export function scopeFromGit({ base, head, event, forceFull = false, cwd = process.cwd() } = {}) {
  try {
    const { git, start, files } = comparisonFromGit({ base, head, event, cwd });
    const raw = git('diff', '--no-ext-diff', '--no-renames', '--raw', start, head);
    const unsafeModes = /^:(?:120000|160000)\b|^:\d{6}\s+(?:120000|160000)\b/m.test(raw);
    const hasDeletion = Boolean(git('diff', '--no-ext-diff', '--no-renames', '--name-only', '--diff-filter=D', start, head).trim());
    const codeFiles = files.filter(displayCode);
    const patch = codeFiles.length ? git('diff', '--no-ext-diff', '--no-renames', '--unified=0', start, head, '--', ...codeFiles) : '';
    const preliminary = classifyReleaseScope({ files, patch, syntaxSafe: true, unsafeModes, hasDeletion, forceFull });
    if (!preliminary.uiOnly) return preliminary;
    const tree = git('ls-tree', '-r', '--name-only', head).split('\n');
    const appRoutes = tree.filter((name) => /^app\/.+\.tsx$/.test(name) && !name.includes('_layout')).flatMap((name) => {
      const parts = name.slice(4, -4).split('/');
      if (parts.at(-1) === 'index') parts.pop();
      return ['/' + parts.join('/'), '/' + parts.filter((part) => !/^\(.+\)$/.test(part)).join('/')];
    });
    const miniConfig = tree.includes('miniapp/src/app.config.ts') ? miniappRouteConfig(git('show', `${head}:miniapp/src/app.config.ts`)) : { routes: [], tabRoutes: [] };
    const miniRoutes = miniConfig.routes.filter((route) => tree.includes('miniapp/src' + route + '.tsx'));
    const syntaxSafe = codeFiles.every((name) => presentationSyntaxOnly(git('show', `${start}:${name}`), git('show', `${head}:${name}`), { platform: frontendClient(name), filePath: name, routes: frontendClient(name) === 'app' ? appRoutes : miniRoutes, tabRoutes: miniConfig.tabRoutes }));
    return classifyReleaseScope({ files, patch, syntaxSafe, unsafeModes, hasDeletion, forceFull });
  } catch {
    return { mode: 'full', uiOnly: false, app: true, miniapp: true, reason: 'comparison or parser unavailable' };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--assert-e2e-result') || process.argv.includes('--assert-frontend-result')) {
    const frontend = process.argv.includes('--assert-frontend-result');
    const passed = frontend ? frontendGatePassed({ scopeResult: process.env.CI_SCOPE_RESULT, appRequired: process.env.CI_APP_REQUIRED, miniappRequired: process.env.CI_MINIAPP_REQUIRED, appResult: process.env.CI_APP_RESULT, miniappResult: process.env.CI_MINIAPP_RESULT }) : e2eGatePassed({ scopeResult: process.env.CI_SCOPE_RESULT, mode: process.env.CI_SCOPE_MODE, fullResult: process.env.CI_FULL_E2E_RESULT });
    if (!passed) { console.error('Required relevant validation failed, was cancelled, or is unknown'); process.exit(1); }
    console.log('Required relevant validation passed'); process.exit(0);
  }
  const result = scopeFromGit({ base: process.env.CI_SCOPE_BASE, head: process.env.CI_SCOPE_HEAD, event: process.env.CI_SCOPE_EVENT, forceFull: process.env.CI_FORCE_FULL === 'true' });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nui_only=${result.uiOnly}\napp=${result.app}\nminiapp=${result.miniapp}\n`);
  console.log(process.argv.includes('--mode-only') ? result.mode : JSON.stringify(result));
}
