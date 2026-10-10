import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyReleaseScope, scopeFromGit, e2eGatePassed } from '../ci-release-scope.mjs';
import { presentationSyntaxOnly } from '../ci-ui-syntax.mjs';

const home = 'miniapp/src/pages/home/index.tsx';
test('the small referral entry patch and companion documentation qualify', () => {
  const result = classifyReleaseScope({ files: [home, 'plan.md', 'docs/architecture/wechat-mini-program.md'], syntaxSafe: true, patch: '-{member?.tier === "VIP" ? (\n+{showReferralEntry ? (\n+<Text>推荐好友</Text>' });
  assert.equal(result.mode, 'miniapp-ui');
});
test('presentation styles qualify while financial/account styles do not', () => {
  assert.equal(classifyReleaseScope({ files: ['miniapp/src/pages/home/index.scss'] }).uiOnly, true);
  for (const name of ['miniapp/src/packages/account/login/index.scss', 'miniapp/src/packages/commerce/checkout/index.scss', 'miniapp/src/components/privacy-authorization/index.scss', 'miniapp/src/packages/member/member.scss', 'miniapp/src/packages/after-sales/index.scss']) {
    assert.equal(classifyReleaseScope({ files: [name] }).uiOnly, false);
  }
});
test('syntax accepts readonly presentation and retains existing event handlers', () => {
  const before = 'function Home(){const member=useMember();return <View onClick={share}>{member?.tier === "VIP" && <Text>VIP 分享</Text>}</View>}';
  const after = 'function Home(){const member=useMember();const isVipMember=member?.tier === "VIP";const showReferralEntry=hydrated && loggedIn && (member?.tier === "NORMAL" || (isVipMember && Boolean(member?.referralCode)));return <View onClick={share}>{showReferralEntry && <Text>推荐好友</Text>}</View>}';
  assert.equal(presentationSyntaxOnly(before, after), true);
  assert.equal(presentationSyntaxOnly(before, before.replace('share}', 'purchase}')), false);
});
test('query authentication, cache policy and setter changes cannot be called presentation', () => {
  const cases = [
    ['const q={queryKey:["profile",authRevision]};', 'const q={queryKey:["profile"]};'],
    ['const q={enabled:hydrated && loggedIn};', 'const q={enabled:true};'],
    ['const q={staleTime:60000};', 'const q={staleTime:Infinity};'],
    ['function stop(){setVoicePhase("idle");}', 'function stop(){setVoicePhase("recording");}'],
    ['const route="/referral"; function share(){go(route)}', 'const route="/payment"; function share(){go(route)}'],
    ['let n=1; n++;', 'const n=1; n--;'],
    ['const b=Boolean; function f(){return b(member)}', 'const b=Boolean; function f(){return b(profile)}'],
    ['const a=true; function f(a){return <Text>{a}</Text>}', 'const a=false; function f(a){return <Text>{a}</Text>}'],
    ['const Boolean=(x)=>audit(x); function f(){return <Text>{Boolean(loggedIn)}</Text>}', 'const Boolean=(x)=>audit(x); function f(){return <Text>{Boolean(hydrated)}</Text>}'],
    ['import Boolean from "./coerce"; function f(){const label=Boolean(loggedIn);return <Text>{label}</Text>}', 'import Boolean from "./coerce"; function f(){const label=Boolean(hydrated);return <Text>{label}</Text>}'],
    ['const {Boolean}=helpers; function f(){return <Text>{Boolean(loggedIn)}</Text>}', 'const {Boolean}=helpers; function f(){return <Text>{Boolean(hydrated)}</Text>}'],
    ['function Home(){const panel=<View onClick={share}/>;return <View>{panel}</View>}', 'function Home(){const panel=<View onClick={purchase}/>;return <View>{panel}</View>}'],
    ['function Home(){const panel=loggedIn ? <View onClick={share}/> : null;return <View>{panel}</View>}', 'function Home(){const panel=loggedIn ? <View onClick={purchase}/> : null;return <View>{panel}</View>}'],
    ['function Home(){return <><View onClick={buy}>A</View><View onClick={share}>B</View></>}', 'function Home(){return <><View onClick={buy}>A<View onClick={share}>B</View></View></>}'],
  ];
  for (const [before, after] of cases) assert.equal(presentationSyntaxOnly(before, after), false, before);
});
test('runtime contracts and release configuration never take the fast path', () => {
  for (const name of ['backend/prisma/schema.prisma', 'backend/src/payment.ts', 'app/home.tsx', 'src/repos/BonusRepo.ts', 'miniapp/src/repos/auth.ts', 'miniapp/src/store/auth.ts', 'miniapp/src/types/result.ts', 'miniapp/package.json', 'miniapp/config/env.ts', '.github/workflows/e2e.yml', 'scripts/ci-release-scope.mjs', 'AGENTS.md']) {
    assert.equal(classifyReleaseScope({ files: [home, name], patch: '+<Text>分享</Text>' }).uiOnly, false, name);
  }
});
test('one-line API, auth, mutation, navigation or import changes stay on full validation', () => {
  for (const code of ['ApiClient.post("/order")', 'SomeRepo.get()', 'api.get()', 'wx.login()', 'useQuery({})', 'useAuthStore(s=>s)', 'setSession(session)', 'accessToken = x', 'const price = oldPrice * 0.5', 'quantity = 0', 'requestPayment({})', 'navigateTo({url:"/checkout"})', 'Taro.setStorageSync("x",x)', 'fetch(url)', 'mutation.mutate()', 'import { helper } from "./logic"']) {
    assert.equal(classifyReleaseScope({ files: [home], patch: '+' + code }).uiOnly, false, code);
  }
});
test('empty, documentation-only, broad or unsafe changes fail closed', () => {
  for (const args of [{}, { files: ['plan.md'] }, { files: [home] }, { files: [home], patch: '+x\n'.repeat(121) }, { files: ['miniapp/src/pages/home/index.scss'], unsafeModes: true }, { files: ['miniapp/src/pages/home/index.scss'], forceFull: true }]) {
    assert.equal(classifyReleaseScope(args).uiOnly, false);
  }
});
test('missing comparisons and manual validation remain full', () => {
  assert.equal(scopeFromGit({}).uiOnly, false);
  assert.equal(scopeFromGit({ base: '0'.repeat(40), head: 'a'.repeat(40), event: 'push' }).uiOnly, false);
  assert.equal(scopeFromGit({ base: 'a'.repeat(40), head: 'b'.repeat(40), event: 'workflow_dispatch' }).uiOnly, false);
});
test('the required e2e status cannot hide failed, cancelled or missing validation', () => {
  assert.equal(e2eGatePassed({ scopeResult: 'success', mode: 'miniapp-ui', fullResult: 'skipped' }), true);
  assert.equal(e2eGatePassed({ scopeResult: 'success', mode: 'full', fullResult: 'success' }), true);
  for (const scopeResult of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.equal(e2eGatePassed({ scopeResult, mode: 'miniapp-ui', fullResult: 'skipped' }), false);
  }
  for (const mode of ['full', 'miniapp-ui', '', undefined]) {
    for (const fullResult of ['failure', 'cancelled', undefined]) {
      assert.equal(e2eGatePassed({ scopeResult: 'success', mode, fullResult }), false);
    }
  }
  assert.equal(e2eGatePassed({ scopeResult: 'success', mode: 'full', fullResult: 'skipped' }), false);
});
test('required client checks cannot pass a failed or missing UI candidate build', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/miniapp-ci.yml', import.meta.url), 'utf8');
  const gate = workflow.slice(workflow.indexOf('  checks:\n'), workflow.indexOf('  build-staging:\n'));
  const shell = gate.split('        run: |\n')[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  const run = (env) => {
    try { execFileSync('bash', ['-c', shell], { env: { ...process.env, ...env }, stdio: 'ignore' }); return true; }
    catch { return false; }
  };
  const ui = { CLIENT_RESULT: 'success', UI_ONLY: 'true', IS_PR: 'true' };
  assert.equal(run({ ...ui, CANDIDATE_RESULT: 'success' }), true);
  for (const CANDIDATE_RESULT of ['failure', 'cancelled', 'skipped', '']) assert.equal(run({ ...ui, CANDIDATE_RESULT }), false);
  assert.equal(run({ ...ui, CLIENT_RESULT: 'failure', CANDIDATE_RESULT: 'success' }), false);
  assert.equal(run({ ...ui, UI_ONLY: '', CANDIDATE_RESULT: 'skipped' }), false);
  assert.equal(run({ ...ui, UI_ONLY: 'false', CANDIDATE_RESULT: 'skipped' }), true);
  assert.equal(run({ ...ui, IS_PR: 'false', CANDIDATE_RESULT: 'skipped' }), true);
});
test('release builds survive a skipped PR-only ancestor and still reject failed checks or cancellation', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/miniapp-ci.yml', import.meta.url), 'utf8');
  for (const [job, ref, environment] of [['build-staging', 'refs/heads/staging-next', 'staging'], ['build-production', 'refs/heads/main', 'production']]) {
    const block = workflow.slice(workflow.indexOf(`  ${job}:\n`));
    const condition = block.split('    if: >-\n')[1].split('    runs-on:')[0].trim().replace(/^\$\{\{|\}\}$/g, '').trim();
    // GitHub adds implicit success() unless a status function exists, propagating a skipped ancestor.
    const explicitStatus = /\b(?:always|cancelled|failure|success)\(\)/.test(condition);
    const evaluate = new Function('github', 'needs', 'inputs', 'cancelled', `return (${condition});`);
    const run = (result, isCancelled, event = 'push', candidateResult = 'skipped') => explicitStatus && evaluate(
      { event_name: event, ref }, { checks: { result }, 'build-candidate': { result: candidateResult } }, { environment }, () => isCancelled,
    );
    assert.equal(run('success', false), true, `${job} with PR-only ancestor skipped`);
    assert.equal(run('success', false, 'workflow_dispatch'), true);
    assert.equal(run('success', false, 'pull_request'), false);
    for (const result of ['failure', 'cancelled', 'skipped', '']) assert.equal(run(result, false), false);
    assert.equal(run('success', true), false);
  }
});
test('real Git comparison handles PR ancestry, renames and symlinks conservatively', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-scope-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Scope Test'); git('config', 'user.email', 'scope@example.invalid');
  mkdirSync(path.join(root, 'miniapp/src/pages/home'), { recursive: true });
  writeFileSync(path.join(root, home), '<Text>旧文案</Text>\n');
  git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  writeFileSync(path.join(root, home), '<Text>新文案</Text>\n');
  git('add', '.'); git('commit', '-m', 'copy'); const head = git('rev-parse', 'HEAD');
  assert.equal(scopeFromGit({ base, head, event: 'pull_request', cwd: root }).uiOnly, true);
  mkdirSync(path.join(root, 'backend'), { recursive: true });
  git('mv', home, 'backend/auth.ts'); git('commit', '-m', 'rename'); const moved = git('rev-parse', 'HEAD');
  assert.equal(scopeFromGit({ base: head, head: moved, event: 'push', cwd: root }).uiOnly, false);
  symlinkSync('../../../../backend/auth.ts', path.join(root, home));
  git('add', '.'); git('commit', '-m', 'symlink');
  assert.equal(scopeFromGit({ base: moved, head: git('rev-parse', 'HEAD'), event: 'push', cwd: root }).uiOnly, false);
});
test('real Git deletion and rename inside otherwise allowed resources stay full', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-resource-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Scope Test'); git('config', 'user.email', 'scope@example.invalid');
  mkdirSync(path.join(root, 'miniapp/src/assets'), { recursive: true });
  writeFileSync(path.join(root, 'miniapp/src/assets/old.png'), 'fixture');
  git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  git('mv', 'miniapp/src/assets/old.png', 'miniapp/src/assets/new.png'); git('commit', '-m', 'rename'); const head = git('rev-parse', 'HEAD');
  assert.equal(scopeFromGit({ base, head, event: 'push', cwd: root }).uiOnly, false);
  git('rm', 'miniapp/src/assets/new.png'); git('commit', '-m', 'delete');
  assert.equal(scopeFromGit({ base: head, head: git('rev-parse', 'HEAD'), event: 'push', cwd: root }).uiOnly, false);
});
test('real homepage query and state changes stay full even when no import changes', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'aimai-home-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Scope Test'); git('config', 'user.email', 'scope@example.invalid');
  mkdirSync(path.join(root, 'miniapp/src/pages/home'), { recursive: true });
  const before = readFileSync(new URL('../../miniapp/src/pages/home/index.tsx', import.meta.url), 'utf8');
  writeFileSync(path.join(root, home), before);
  git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  const changes = [
    ["queryKey: ['home', 'profile', authRevision]", "queryKey: ['home', 'profile']"],
    ['enabled: hydrated && loggedIn', 'enabled: true'],
    ['staleTime: 60_000', 'staleTime: Infinity'],
    ["setVoicePhase('idle')", "setVoicePhase('recording')"],
  ];
  for (const [oldText, newText] of changes) {
    assert.ok(before.includes(oldText));
    writeFileSync(path.join(root, home), before.replace(oldText, newText));
    git('add', '.'); git('commit', '-m', 'logic boundary');
    assert.equal(scopeFromGit({ base, head: git('rev-parse', 'HEAD'), event: 'pull_request', cwd: root }).uiOnly, false, oldText);
  }
});
