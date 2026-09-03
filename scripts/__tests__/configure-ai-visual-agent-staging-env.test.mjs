import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../configure-ai-visual-agent-staging-env.sh', import.meta.url));

function validConfig(overrides = {}) {
  return {
    AI_VISUAL_AGENT_BAILIAN_API_KEY: `sk-${'a'.repeat(32)}`,
    AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID: `ws-${'b'.repeat(16)}`,
    AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET: 'c'.repeat(64),
    AI_VISUAL_AGENT_ENABLED: 'false',
    AI_VISUAL_AGENT_TEST_ACCESS_ENABLED: 'false',
    AI_VISUAL_AGENT_WAN_ENABLED: 'false',
    AI_VISUAL_AGENT_WAN_EXECUTION_ENABLED: 'false',
    AI_VISUAL_AGENT_WAN_ALLOWED_MODELS: 'wan2.7-image',
    AI_VISUAL_AGENT_QWEN_IMAGE_ENABLED: 'false',
    AI_VISUAL_AGENT_QWEN_IMAGE_EXECUTION_ENABLED: 'false',
    AI_VISUAL_AGENT_QWEN_IMAGE_ALLOWED_MODELS: 'qwen-image-3.0',
    AI_VISUAL_AGENT_QWEN_OCR_ENABLED: 'false',
    AI_VISUAL_AGENT_QWEN_OCR_EXECUTION_ENABLED: 'false',
    AI_VISUAL_AGENT_CANDIDATE_OCR_VERIFY_ENABLED: 'false',
    AI_VISUAL_AGENT_BAILIAN_RESULT_HOST_SUFFIXES: 'oss-cn-beijing.aliyuncs.com,oss-accelerate.aliyuncs.com',
    AI_VISUAL_AGENT_FACT_SCAN_HASH_KEY_VERSION: 'v1',
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'aimai-ai-visual-env-'));
  const backend = path.join(root, 'backend');
  const backup = path.join(root, 'backup');
  const envFile = path.join(backend, '.env');
  const configFile = path.join(root, 'config.json');
  await mkdir(backend, { recursive: true });
  await writeFile(envFile, 'DATABASE_URL="postgresql://example"\nAI_VISUAL_AGENT_ENABLED="true"\n', { mode: 0o600 });
  return { root, backup, envFile, configFile };
}

test('staging AI Visual Agent config is backup-first, atomic, secret-safe, and default-off', async () => {
  const f = await fixture();
  const original = await readFile(f.envFile, 'utf8');
  const config = validConfig();
  try {
    await writeFile(f.configFile, JSON.stringify(config), { mode: 0o600 });
    const result = spawnSync('bash', [script, f.configFile], {
      env: { ...process.env, SRC_DIR: f.root, AI_VISUAL_AGENT_BACKUP_DIR: f.backup },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /sk-[A-Za-z0-9_-]+/);
    assert.match(result.stdout, /provider_flags=from_staging_environment/);

    const updated = await readFile(f.envFile, 'utf8');
    assert.match(updated, /^DATABASE_URL="postgresql:\/\/example"$/m);
    for (const [key, value] of Object.entries(config)) assert.match(updated, new RegExp(`^${key}=${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.equal((await stat(f.envFile)).mode & 0o777, 0o600);

    const backups = await readdir(f.backup);
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(f.backup, backups[0]), 'utf8'), original);
    assert.equal((await stat(path.join(f.backup, backups[0]))).mode & 0o777, 0o600);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('invalid staging AI Visual Agent config leaves the target env unchanged', async () => {
  const f = await fixture();
  const original = await readFile(f.envFile, 'utf8');
  try {
    await writeFile(f.configFile, JSON.stringify(validConfig({ AI_VISUAL_AGENT_BAILIAN_API_KEY: 'invalid' })), { mode: 0o600 });
    const result = spawnSync('bash', [script, f.configFile], {
      env: { ...process.env, SRC_DIR: f.root, AI_VISUAL_AGENT_BACKUP_DIR: f.backup },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(f.envFile, 'utf8'), original);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
