import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { comparisonFromGit, scopeFromGit } from './ci-release-scope.mjs';

export function selectedFrontendFiles(files, client) {
  return files.filter((name) => /\.(?:ts|tsx)$/.test(name) && (client === 'miniapp' ? name.startsWith('miniapp/src/') : name.startsWith('app/') || name.startsWith('src/')));
}
export function frontendBuildContext({ ref, event, requested } = {}) {
  const main = ref === 'refs/heads/main';
  const staging = ['refs/heads/staging', 'refs/heads/staging-next'].includes(ref);
  const environment = main ? 'production' : 'staging';
  if (event === 'workflow_dispatch' && (!main && !staging || requested !== environment)) throw new Error('manual target must match the main/staging source');
  return { environment, main, releaseSource: main || staging };
}
export function frontendTestCommand({ client, files = [], full = false }) {
  if (client === 'app') return ['node_modules/.bin/jest', ...(full ? [] : ['--findRelatedTests', ...files]), '--runInBand', '--passWithNoTests'];
  if (client === 'miniapp') return ['node_modules/.bin/vitest', ...(full ? ['run'] : ['related', '--run', ...files.map((name) => name.slice('miniapp/'.length))]), '--passWithNoTests'];
  throw new Error('unknown frontend client');
}
export function verifyAppExport(root) {
  const metadata = JSON.parse(readFileSync(path.join(root, 'metadata.json'), 'utf8'));
  for (const platform of ['android', 'ios']) {
    const entry = metadata.fileMetadata?.[platform];
    if (!entry?.bundle || !existsSync(path.join(root, entry.bundle))) throw new Error(`${platform} bundle missing`);
    if (!entry.assets?.length || !entry.assets.some((asset) => asset.ext === 'ttf' || /\.ttf$/i.test(asset.path))) throw new Error(`${platform} fonts/assets missing`);
    if (entry.assets.some((asset) => !existsSync(path.join(root, asset.path)))) throw new Error(`${platform} asset file missing`);
  }
  return metadata;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = process.argv[process.argv.indexOf('--client') + 1];
  if (!['app', 'miniapp'].includes(client)) throw new Error('--client must be app or miniapp');
  const root = process.cwd(), cwd = client === 'app' ? root : path.join(root, 'miniapp');
  const args = { base: process.env.CI_SCOPE_BASE, head: process.env.CI_SCOPE_HEAD, event: process.env.CI_SCOPE_EVENT };
  let files = [], full = true;
  try { files = comparisonFromGit(args).files; full = !scopeFromGit(args).uiOnly; } catch { /* 手动/未知范围使用客户端完整检查。 */ }
  const selected = selectedFrontendFiles(files, client);
  const run = (command, argv, env = process.env) => execFileSync(command, argv, { cwd, env, stdio: 'inherit' });
  if (client === 'app') run('node_modules/.bin/tsc', ['--noEmit', '--pretty', 'false']);
  else {
    run('npm', ['run', 'typecheck']);
    if (full) run('npm', ['run', 'lint', '--', '--max-warnings=0']);
    else if (selected.length) run('node_modules/.bin/eslint', ['--max-warnings=0', ...selected.map((name) => name.slice('miniapp/'.length))]);
  }
  if (full || selected.length) {
    const [command, ...argv] = frontendTestCommand({ client, files: selected, full });
    run(command, argv);
  } else console.log('No related source tests for an asset/style-only change; typecheck/build and page review remain required.');
  const { main, environment, releaseSource } = frontendBuildContext({ ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME, requested: process.env.CI_BUILD_ENVIRONMENT });
  let artifact;
  if (client === 'app') {
    const env = { ...process.env, CI: '1', NODE_ENV: 'production', EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_ENV: environment, EXPO_PUBLIC_USE_MOCK: 'false', EXPO_PUBLIC_API_BASE_URL: main ? 'https://api.ai-maimai.com/api/v1' : 'https://test-api.ai-maimai.com/api/v1', EXPO_PUBLIC_ALIPAY_SANDBOX: 'false', EXPO_PUBLIC_WECHAT_PAY_AVAILABLE: 'true' };
    run('node_modules/.bin/expo', ['export', '--platform', 'all', '--clear', '--dump-assetmap', '--output-dir', 'dist/app-export'], env);
    artifact = path.join(root, 'dist/app-export');
    verifyAppExport(artifact);
  } else {
    if (releaseSource) {
      run('npm', ['run', 'verify:release-context'], { ...process.env, MINIAPP_RELEASE_CHANNEL: environment, MINIAPP_RELEASE_BRANCH: process.env.GITHUB_REF_NAME });
    }
    run('npm', ['run', `build:${environment}`]);
    run('npm', ['run', 'verify:artifact'], { ...process.env, MINIAPP_ARTIFACT_ENV: environment });
    artifact = path.join(cwd, 'dist');
  }
  const buildSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (main) {
    const mainTip = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
    if (buildSha !== mainTip || execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('main artifact source is not exact and clean');
  }
  writeFileSync(path.join(artifact, 'ci-source.json'), JSON.stringify({ buildSha, prHead: process.env.PR_HEAD_SHA || null, client, environment, sourceRole: main ? 'main' : 'candidate', relatedSourceFiles: selected, testSelection: full ? 'client-full' : 'related' }, null, 2));
  console.log(JSON.stringify({ client, environment, buildSha, artifact, testSelection: full ? 'client-full' : 'related' }));
}
