import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../configure-ai-visual-agent-staging-env.sh', import.meta.url));
const workflow = await readFile(
  new URL('../../.github/workflows/deploy-release.yml', import.meta.url),
  'utf8',
);

function validConfig(overrides = {}) {
  return {
    PUBLIC_API_BASE_URL: 'https://test-api.ai-maimai.com/api/v1',
    AI_VISUAL_AGENT_BAILIAN_API_KEY: `sk-${'a'.repeat(32)}`,
    AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID: `ws-${'b'.repeat(16)}`,
    AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET: 'c'.repeat(64),
    AI_VISUAL_AGENT_ENABLED: 'false',
    AI_VISUAL_AGENT_TEST_ACCESS_ENABLED: 'false',
    AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED: 'false',
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
    assert.match(updated, /^AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED="false"$/m);
    assert.match(updated, /^AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED="false"$/m);
    assert.equal((await stat(f.envFile)).mode & 0o777, 0o600);

    const backups = await readdir(f.backup);
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(f.backup, backups[0]), 'utf8'), original);
    assert.equal((await stat(path.join(f.backup, backups[0]))).mode & 0o777, 0o600);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('new structure verification booleans accept an explicitly approved true staging value', async () => {
  const f = await fixture();
  try {
    const config = validConfig({
      AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED: 'true',
      AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED: 'true',
    });
    await writeFile(f.configFile, JSON.stringify(config), { mode: 0o600 });
    const result = spawnSync('bash', [script, f.configFile], {
      env: { ...process.env, SRC_DIR: f.root, AI_VISUAL_AGENT_BACKUP_DIR: f.backup },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const updated = await readFile(f.envFile, 'utf8');
    assert.match(updated, /^AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED="true"$/m);
    assert.match(updated, /^AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED="true"$/m);
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

test('invalid structure verification boolean leaves the target env unchanged', async () => {
  const f = await fixture();
  const original = await readFile(f.envFile, 'utf8');
  try {
    await writeFile(f.configFile, JSON.stringify(validConfig({
      AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED: 'not-a-boolean',
      AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED: 'false',
    })), { mode: 0o600 });
    const result = spawnSync('bash', [script, f.configFile], {
      env: { ...process.env, SRC_DIR: f.root, AI_VISUAL_AGENT_BACKUP_DIR: f.backup },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid boolean AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED/);
    assert.equal(await readFile(f.envFile, 'utf8'), original);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('unexpected config keys are rejected and missing legacy required keys stay required', async () => {
  for (const config of [
    validConfig({ AI_VISUAL_AGENT_UNEXPECTED: 'false' }),
    (() => {
      const legacyConfig = validConfig();
      delete legacyConfig.AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET;
      return legacyConfig;
    })(),
  ]) {
    const f = await fixture();
    const original = await readFile(f.envFile, 'utf8');
    try {
      await writeFile(f.configFile, JSON.stringify(config), { mode: 0o600 });
      const result = spawnSync('bash', [script, f.configFile], {
        env: { ...process.env, SRC_DIR: f.root, AI_VISUAL_AGENT_BACKUP_DIR: f.backup },
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /AI Visual Agent config keys are incomplete or unexpected/);
      assert.equal(await readFile(f.envFile, 'utf8'), original);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test('production API hostname is rejected without changing staging env', async () => {
  const f = await fixture();
  const original = await readFile(f.envFile, 'utf8');
  try {
    await writeFile(f.configFile, JSON.stringify(validConfig({
      PUBLIC_API_BASE_URL: 'https://api.ai-maimai.com/api/v1',
    })), { mode: 0o600 });
    const result = spawnSync('bash', [script, f.configFile], {
      env: { ...process.env, SRC_DIR: f.root, AI_VISUAL_AGENT_BACKUP_DIR: f.backup },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid staging public API base URL/);
    assert.equal(await readFile(f.envFile, 'utf8'), original);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('staging workflow reads structure flags from staging vars, defaults them off, and never runs the writer on production', () => {
  const configureStart = workflow.indexOf('      - name: Configure staging AI Visual Agent secrets and flags');
  const configureEnd = workflow.indexOf('\n\n  deploy-backend:', configureStart);
  assert.ok(configureStart >= 0 && configureEnd > configureStart, 'staging AI Visual Agent configure step must exist');
  const configureStep = workflow.slice(configureStart, configureEnd);
  assert.match(configureStep, /if: github\.ref == 'refs\/heads\/staging-next' && needs\.detect-changes\.outputs\.backend == 'true'/);
  for (const key of [
    'AI_VISUAL_AGENT_STRUCTURE_VERIFY_ENABLED',
    'AI_VISUAL_AGENT_STRUCTURE_VERIFY_EXECUTION_ENABLED',
  ]) {
    assert.match(configureStep, new RegExp(`${key}: \\$\\{\\{ vars\\.${key} \\|\\| 'false' \\}\\}`));
    assert.match(configureStep, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(configureStep, /refs\/heads\/main/);
});
