import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReadinessPayload,
  unwrapReadinessPayload,
  verifyDeployedReleaseSha,
} from '../verify-deployed-release-sha.mjs';

const EXPECTED_SHA = 'a'.repeat(40);

test('unwraps the real ResultWrapper health response', () => {
  const readiness = unwrapReadinessPayload({
    ok: true,
    data: { status: 'ready', releaseSha: EXPECTED_SHA, components: { database: 'up', redis: 'up' } },
  });
  assert.equal(readiness.releaseSha, EXPECTED_SHA);
});

test('keeps backward-compatible flat health responses', () => {
  const readiness = assertReadinessPayload({ status: 'ready', releaseSha: EXPECTED_SHA }, EXPECTED_SHA);
  assert.equal(readiness.status, 'ready');
});

test('rejects a wrapped health response with a different release SHA', () => {
  assert.throws(
    () => assertReadinessPayload({ ok: true, data: { status: 'ready', releaseSha: 'b'.repeat(40) } }, EXPECTED_SHA),
    /expected a{40}/,
  );
});

test('website-only verification accepts a different release SHA only when backend trees are identical', () => {
  const deployedSha = 'b'.repeat(40);
  const backendTree = 'c'.repeat(40);
  const resolved = [];
  const readiness = assertReadinessPayload(
    { ok: true, data: { status: 'ready', releaseSha: deployedSha } },
    EXPECTED_SHA,
    {
      allowBackendTreeEquivalent: true,
      resolveBackendTree: (sha) => {
        resolved.push(sha);
        return backendTree;
      },
    },
  );
  assert.equal(readiness.verificationMode, 'backend-tree-equivalent');
  assert.equal(readiness.backendTree, backendTree);
  assert.deepEqual(resolved, [EXPECTED_SHA, deployedSha]);
});

test('website-only verification rejects a different backend tree', () => {
  const deployedSha = 'b'.repeat(40);
  assert.throws(
    () => assertReadinessPayload(
      { status: 'ready', releaseSha: deployedSha },
      EXPECTED_SHA,
      {
        allowBackendTreeEquivalent: true,
        resolveBackendTree: (sha) => sha === EXPECTED_SHA ? 'c'.repeat(40) : 'd'.repeat(40),
      },
    ),
    /deployed backend is b{40}/,
  );
});

test('fetch verification accepts the production response envelope and uses a bounded no-store request', async () => {
  let observedOptions;
  const readiness = await verifyDeployedReleaseSha({
    readyUrl: 'https://api.example.test/api/v1/health/ready',
    expectedSha: EXPECTED_SHA,
    fetchImpl: async (_url, options) => {
      observedOptions = options;
      return new Response(JSON.stringify({ ok: true, data: { status: 'ready', releaseSha: EXPECTED_SHA } }));
    },
  });
  assert.equal(readiness.releaseSha, EXPECTED_SHA);
  assert.equal(observedOptions.cache, 'no-store');
  assert.ok(observedOptions.signal instanceof AbortSignal);
});

test('rejects non-HTTPS readiness endpoints before fetching', async () => {
  await assert.rejects(
    verifyDeployedReleaseSha({
      readyUrl: 'http://api.example.test/api/v1/health/ready',
      expectedSha: EXPECTED_SHA,
      fetchImpl: async () => { throw new Error('must not fetch'); },
    }),
    /must use HTTPS/,
  );
});
