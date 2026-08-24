#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TREE_PATTERN = /^[0-9a-f]{40}$/;

export function resolveBackendTreeFromGit(sha) {
  if (!SHA_PATTERN.test(sha)) throw new Error('backend release SHA must be a full commit SHA');
  let tree;
  try {
    tree = execFileSync('git', ['rev-parse', `${sha}:backend`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`cannot resolve backend tree for ${sha}`);
  }
  if (!TREE_PATTERN.test(tree)) throw new Error(`invalid backend tree for ${sha}`);
  return tree;
}

export function unwrapReadinessPayload(payload) {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload;
}

export function assertReadinessPayload(
  payload,
  expectedSha,
  { allowBackendTreeEquivalent = false, resolveBackendTree } = {},
) {
  if (!SHA_PATTERN.test(expectedSha)) throw new Error('EXPECTED_SHA must be a full commit SHA');
  const readiness = unwrapReadinessPayload(payload);
  if (!readiness || readiness.status !== 'ready') {
    throw new Error(`deployed backend is ${readiness?.releaseSha || '<unknown>'}, expected ${expectedSha}`);
  }
  if (readiness.releaseSha === expectedSha) {
    return { ...readiness, verificationMode: 'exact-sha' };
  }
  if (
    allowBackendTreeEquivalent
    && SHA_PATTERN.test(readiness.releaseSha || '')
    && typeof resolveBackendTree === 'function'
  ) {
    const expectedTree = resolveBackendTree(expectedSha);
    const deployedTree = resolveBackendTree(readiness.releaseSha);
    if (TREE_PATTERN.test(expectedTree) && expectedTree === deployedTree) {
      return {
        ...readiness,
        verificationMode: 'backend-tree-equivalent',
        backendTree: expectedTree,
      };
    }
  }
  throw new Error(`deployed backend is ${readiness.releaseSha || '<unknown>'}, expected ${expectedSha}`);
}

export async function verifyDeployedReleaseSha({
  readyUrl,
  expectedSha,
  allowBackendTreeEquivalent = false,
  resolveBackendTree,
  fetchImpl = fetch,
}) {
  if (!readyUrl) throw new Error('READY_URL is missing');
  const parsedUrl = new URL(readyUrl);
  if (parsedUrl.protocol !== 'https:') throw new Error('READY_URL must use HTTPS');

  const response = await fetchImpl(parsedUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`backend readiness returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Error(`backend readiness returned HTTP ${response.status}`);
  return assertReadinessPayload(payload, expectedSha, {
    allowBackendTreeEquivalent,
    resolveBackendTree,
  });
}

async function main() {
  const expectedSha = String(process.env.EXPECTED_SHA || '').trim();
  const readyUrl = String(process.env.READY_URL || '').trim();
  const allowBackendTreeEquivalent = process.env.ALLOW_BACKEND_TREE_EQUIVALENT === 'true';
  const readiness = await verifyDeployedReleaseSha({
    readyUrl,
    expectedSha,
    allowBackendTreeEquivalent,
    resolveBackendTree: allowBackendTreeEquivalent ? resolveBackendTreeFromGit : undefined,
  });
  process.stdout.write(
    `deployed_backend_release_sha=verified sha=${expectedSha} mode=${readiness.verificationMode}`
    + `${readiness.backendTree ? ` backend_tree=${readiness.backendTree}` : ''}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`deployed_backend_release_sha=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exit(1);
  });
}
