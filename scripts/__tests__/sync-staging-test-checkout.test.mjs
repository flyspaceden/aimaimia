import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fetchDeploymentText } from '../lib/deployment-evidence-fetch.mjs';

const script = await readFile(new URL('../sync-staging-test-checkout.mjs', import.meta.url), 'utf8');
const runbook = await readFile(new URL('../../docs/operations/github操作.md', import.meta.url), 'utf8');

test('fixed WeChat checkout sync fails closed before changing local state', () => {
  assert.match(script, /targetRoot === sourceRoot/);
  assert.match(script, /status', '--porcelain/);
  assert.match(script, /currentBranch !== targetBranch/);
  assert.match(script, /currentBranch !== expectedOldBranch/);
  assert.match(script, /merge-base', '--is-ancestor', 'HEAD', remoteRef/);
  assert.match(script, /\['staging', 'staging-next'\]\.includes\(targetBranch\)/);
  assert.doesNotMatch(script, /\['reset', '--hard'\]|\['stash'|\['checkout', '--force'/);
});

test('fixed WeChat checkout only fast-forwards the explicitly selected remote test branch', () => {
  assert.match(script, /fetch', '--quiet', 'origin', targetBranch/);
  assert.match(script, /const remoteRef = `origin\/\$\{targetBranch\}`/);
  assert.match(script, /merge', '--ff-only', remoteRef/);
  assert.match(script, /MINIAPP_RELEASE_BRANCH: targetBranch/);
});

test('staging-next checkout waits for exact deployed backend and web console markers', () => {
  assert.match(script, /test-api\.ai-maimai\.com\/api\/v1\/health\/ready/);
  assert.match(script, /data\.releaseSha !== expectedSha/);
  assert.match(script, /test-admin\.ai-maimai\.com\/release-sha\.txt/);
  assert.match(script, /test-seller\.ai-maimai\.com\/release-sha\.txt/);
  assert.match(script, /if \(targetBranch === 'staging-next'\) \{\s+await verifyStagingNextDeployment\(remoteSha\)/);
  assert.match(script, /finalRemoteSha = remoteRefSha/);
  assert.match(script, /targetBranch === 'staging-next'\) await verifyStagingNextDeployment\(remoteSha\)/);
});

test('deployment evidence fetch retries one transport failure and then returns the exact body', async () => {
  const expectedSha = 'e'.repeat(40);
  const sleeps = [];
  const retries = [];
  let calls = 0;
  const transportError = new TypeError('fetch failed', {
    cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
  });

  const body = await fetchDeploymentText('https://test-api.example/ready', expectedSha, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw transportError;
      return { ok: true, status: 200, text: async () => expectedSha };
    },
    sleep: async (delayMs) => sleeps.push(delayMs),
    onRetry: (event) => retries.push(event),
  });

  assert.equal(body, expectedSha);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
  assert.equal(retries.length, 1);
  assert.match(retries[0].detail, /ECONNRESET.*socket reset/);
});

test('deployment evidence fetch remains fail-closed after three transport failures', async () => {
  const sleeps = [];
  let calls = 0;
  const transportError = new TypeError('fetch failed', {
    cause: Object.assign(new Error('temporary DNS failure'), { code: 'EAI_AGAIN' }),
  });

  await assert.rejects(
    fetchDeploymentText('https://test-api.example/ready', 'f'.repeat(40), {
      fetchImpl: async () => {
        calls += 1;
        throw transportError;
      },
      sleep: async (delayMs) => sleeps.push(delayMs),
    }),
    /3 次.*EAI_AGAIN.*temporary DNS failure/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 1500]);
});

test('deployment evidence fetch does not retry an authoritative HTTP failure', async () => {
  let calls = 0;
  await assert.rejects(
    fetchDeploymentText('https://test-api.example/ready', 'a'.repeat(40), {
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 503, text: async () => 'unavailable' };
      },
      sleep: async () => assert.fail('HTTP failure must not sleep or retry'),
    }),
    /HTTP 503/,
  );
  assert.equal(calls, 1);
});

test('fixed WeChat checkout rebuilds dependencies and verifies release context before staging build', () => {
  const install = script.indexOf("run(miniappRoot, 'npm', ['ci'])");
  const verify = script.indexOf("run(miniappRoot, 'npm', ['run', 'verify:release-context'], {");
  const build = script.indexOf("run(miniappRoot, 'npm', ['run', 'build:staging'])");

  assert.ok(install >= 0 && verify > install && build > verify);
  assert.match(script, /MINIAPP_RELEASE_CHANNEL: 'staging'/);
  assert.match(script, /MINIAPP_RELEASE_BRANCH: targetBranch/);
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
  assert.match(script, /git', \['clone', '--branch', targetBranch, '--single-branch'/);
  assert.match(script, /expectedNewSha\.slice\(0, 12\).*process\.pid/);
  const prepareClone = script.indexOf('prepareMiniappCheckout(cloneRoot)');
  const finalRemoteCheck = script.indexOf("remoteRefSha(targetRoot, 'origin', `refs/heads/${targetBranch}`)");
  const moveOldCheckout = script.indexOf('renameSync(targetRoot, backupRoot)');
  assert.ok(prepareClone >= 0 && finalRemoteCheck > prepareClone && moveOldCheckout > finalRemoteCheck);
  assert.match(script, /targetBranch === 'staging-next'\) await verifyStagingNextDeployment\(expectedNewSha\)/);
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
