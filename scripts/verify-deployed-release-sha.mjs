#!/usr/bin/env node

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function unwrapReadinessPayload(payload) {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload;
}

export function assertReadinessPayload(payload, expectedSha) {
  if (!SHA_PATTERN.test(expectedSha)) throw new Error('EXPECTED_SHA must be a full commit SHA');
  const readiness = unwrapReadinessPayload(payload);
  if (!readiness || readiness.status !== 'ready' || readiness.releaseSha !== expectedSha) {
    throw new Error(`deployed backend is ${readiness?.releaseSha || '<unknown>'}, expected ${expectedSha}`);
  }
  return readiness;
}

export async function verifyDeployedReleaseSha({ readyUrl, expectedSha, fetchImpl = fetch }) {
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
  return assertReadinessPayload(payload, expectedSha);
}

async function main() {
  const expectedSha = String(process.env.EXPECTED_SHA || '').trim();
  const readyUrl = String(process.env.READY_URL || '').trim();
  await verifyDeployedReleaseSha({ readyUrl, expectedSha });
  process.stdout.write(`deployed_backend_release_sha=verified sha=${expectedSha}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`deployed_backend_release_sha=failed reason=${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exit(1);
  });
}
