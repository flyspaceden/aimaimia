import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../sync-staging-test-checkout.mjs', import.meta.url), 'utf8');
const runbook = await readFile(new URL('../../docs/operations/github操作.md', import.meta.url), 'utf8');

test('fixed WeChat checkout sync fails closed before changing local state', () => {
  assert.match(script, /targetRoot === sourceRoot/);
  assert.match(script, /status', '--porcelain/);
  assert.match(script, /branch', '--show-current'\]\) !== 'staging'/);
  assert.match(script, /merge-base', '--is-ancestor', 'HEAD', 'origin\/staging/);
  assert.doesNotMatch(script, /\['reset', '--hard'\]|\['stash'|\['checkout', '--force'/);
});

test('fixed WeChat checkout only fast-forwards the verified remote staging branch', () => {
  assert.match(script, /fetch', '--quiet', 'origin', 'staging/);
  assert.match(script, /merge', '--ff-only', 'origin\/staging/);
  assert.match(script, /rev-parse', 'origin\/staging/);
});

test('fixed WeChat checkout rebuilds dependencies and verifies release context before staging build', () => {
  const install = script.indexOf("run(miniappRoot, 'npm', ['ci'])");
  const verify = script.indexOf("run(miniappRoot, 'npm', ['run', 'verify:release-context'])");
  const build = script.indexOf("run(miniappRoot, 'npm', ['run', 'build:staging'])");

  assert.ok(install >= 0 && verify > install && build > verify);
  assert.match(script.slice(build), /status', '--porcelain'/);
  assert.match(script.slice(build), /禁止标记为可测试/);
});

test('one-time rebind requires exact SHAs and three remote recovery refs before a recoverable directory swap', () => {
  assert.match(script, /process\.argv\.includes\('--rebind'\)/);
  assert.match(script, /AIMAI_STAGING_REBIND_CONFIRM/);
  assert.match(script, /AIMAI_STAGING_EXPECTED_OLD_SHA/);
  assert.match(script, /AIMAI_STAGING_EXPECTED_NEW_SHA/);
  assert.match(script, /archive\/staging-pre-main-20260822/);
  assert.match(script, /delivery\/staging/);
  assert.match(script, /staging-pre-main-20260822\^\{\}/);
  assert.match(script, /git', \['clone', '--branch', 'staging', '--single-branch'/);
  assert.match(script, /renameSync\(targetRoot, backupRoot\)/);
  assert.match(script, /renameSync\(cloneRoot, targetRoot\)/);
  assert.doesNotMatch(script, /\['reset', '--hard'\]|\['clean', '-f/);
});

test('staging rewrite runbook keeps zsh refspec variables braced and operations fail-fast', () => {
  assert.doesNotMatch(runbook, /\$[A-Z][A-Z0-9_]*:/);
  assert.match(runbook, /\$\{NEW_STAGING_SHA\}:refs\/heads\/staging/);
  assert.match(runbook, /\$\{LEGACY_STAGING_SHA\}:refs\/heads\/staging/);
  assert.ok((runbook.match(/set -euo pipefail/g) || []).length >= 3);
  assert.match(runbook, /--force-with-lease="refs\/heads\/staging:\$OLD_STAGING_SHA"/);
  assert.match(runbook, /--force-with-lease="refs\/heads\/staging:\$BROKEN_STAGING_SHA"/);
});
