#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${1:?AI Visual Agent config JSON path is required}"
SRC_DIR="${SRC_DIR:?SRC_DIR is required}"
ENV_FILE="$SRC_DIR/backend/.env"
BACKUP_DIR="${AI_VISUAL_AGENT_BACKUP_DIR:-/www/backup/config/aimaimai-staging}"

if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  echo "AI Visual Agent staging env target is missing or unsafe" >&2
  exit 1
fi
if [ ! -f "$CONFIG_FILE" ] || [ -L "$CONFIG_FILE" ]; then
  echo "AI Visual Agent staging config input is missing or unsafe" >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/${STAMP}-before-ai-visual-agent.env"
install -m 600 "$ENV_FILE" "$BACKUP_FILE"

TEMP_FILE="$(mktemp "${ENV_FILE}.ai-visual.XXXXXX")"
cleanup() {
  if [ -f "$TEMP_FILE" ]; then
    rm -f "$TEMP_FILE"
  fi
}
trap cleanup EXIT

node - "$ENV_FILE" "$CONFIG_FILE" "$TEMP_FILE" <<'NODE'
const fs = require('node:fs');

const [envPath, configPath, outputPath] = process.argv.slice(2);
const orderedKeys = [
  'PUBLIC_API_BASE_URL',
  'AI_VISUAL_AGENT_BAILIAN_API_KEY',
  'AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID',
  'AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET',
  'AI_VISUAL_AGENT_ENABLED',
  'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED',
  'AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED',
  'AI_VISUAL_AGENT_WAN_ENABLED',
  'AI_VISUAL_AGENT_WAN_EXECUTION_ENABLED',
  'AI_VISUAL_AGENT_WAN_ALLOWED_MODELS',
  'AI_VISUAL_AGENT_QWEN_IMAGE_ENABLED',
  'AI_VISUAL_AGENT_QWEN_IMAGE_EXECUTION_ENABLED',
  'AI_VISUAL_AGENT_QWEN_IMAGE_ALLOWED_MODELS',
  'AI_VISUAL_AGENT_QWEN_OCR_ENABLED',
  'AI_VISUAL_AGENT_QWEN_OCR_EXECUTION_ENABLED',
  'AI_VISUAL_AGENT_CANDIDATE_OCR_VERIFY_ENABLED',
  'AI_VISUAL_AGENT_BAILIAN_RESULT_HOST_SUFFIXES',
  'AI_VISUAL_AGENT_FACT_SCAN_HASH_KEY_VERSION',
];

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid AI Visual Agent config object');
const configKeys = Object.keys(config).sort();
if (JSON.stringify(configKeys) !== JSON.stringify([...orderedKeys].sort())) throw new Error('AI Visual Agent config keys are incomplete or unexpected');

for (const key of orderedKeys) {
  if (typeof config[key] !== 'string' || !config[key].length || /[\r\n\0]/.test(config[key])) throw new Error(`invalid ${key}`);
}
if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(config.AI_VISUAL_AGENT_BAILIAN_API_KEY)) throw new Error('invalid Bailian API key');
if (!/^ws-[A-Za-z0-9-]{5,}$/.test(config.AI_VISUAL_AGENT_BAILIAN_WORKSPACE_ID)) throw new Error('invalid Bailian workspace ID');
if (!/^[a-f0-9]{64}$/.test(config.AI_VISUAL_AGENT_FACT_SCAN_HASH_SECRET)) throw new Error('invalid fact-scan hash secret');
if (config.PUBLIC_API_BASE_URL !== 'https://test-api.ai-maimai.com/api/v1') throw new Error('invalid staging public API base URL');

for (const key of [
  'AI_VISUAL_AGENT_ENABLED',
  'AI_VISUAL_AGENT_TEST_ACCESS_ENABLED',
  'AI_VISUAL_AGENT_TEST_ALL_MERCHANTS_ENABLED',
  'AI_VISUAL_AGENT_WAN_ENABLED',
  'AI_VISUAL_AGENT_WAN_EXECUTION_ENABLED',
  'AI_VISUAL_AGENT_QWEN_IMAGE_ENABLED',
  'AI_VISUAL_AGENT_QWEN_IMAGE_EXECUTION_ENABLED',
  'AI_VISUAL_AGENT_QWEN_OCR_ENABLED',
  'AI_VISUAL_AGENT_QWEN_OCR_EXECUTION_ENABLED',
  'AI_VISUAL_AGENT_CANDIDATE_OCR_VERIFY_ENABLED',
]) {
  if (!['true', 'false'].includes(config[key])) throw new Error(`invalid boolean ${key}`);
}
const wanModels = new Set(config.AI_VISUAL_AGENT_WAN_ALLOWED_MODELS.split(',').map((value) => value.trim()).filter(Boolean));
if (!wanModels.size || [...wanModels].some((value) => !['wan2.7-image', 'wan2.7-image-pro'].includes(value))) throw new Error('invalid Wan model allowlist');
const qwenModels = new Set(config.AI_VISUAL_AGENT_QWEN_IMAGE_ALLOWED_MODELS.split(',').map((value) => value.trim()).filter(Boolean));
if (!qwenModels.size || [...qwenModels].some((value) => !['qwen-image-3.0', 'qwen-image-3.0-pro'].includes(value))) throw new Error('invalid Qwen Image model allowlist');
const resultHostSuffixes = new Set(config.AI_VISUAL_AGENT_BAILIAN_RESULT_HOST_SUFFIXES.split(',').map((value) => value.trim()).filter(Boolean));
const requiredResultHostSuffixes = ['oss-cn-beijing.aliyuncs.com', 'oss-accelerate.aliyuncs.com'];
if (resultHostSuffixes.size !== requiredResultHostSuffixes.length
  || requiredResultHostSuffixes.some((value) => !resultHostSuffixes.has(value))) {
  throw new Error('result host suffixes must be the exact Beijing OSS and official OSS acceleration hosts');
}
if (!/^[A-Za-z0-9._-]{1,32}$/.test(config.AI_VISUAL_AGENT_FACT_SCAN_HASH_KEY_VERSION)) throw new Error('invalid fact-scan hash key version');

const managed = new Set(orderedKeys);
const existing = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((line) => {
  const match = line.match(/^([A-Z0-9_]+)=/);
  return !match || !managed.has(match[1]);
});
while (existing.length && existing[existing.length - 1] === '') existing.pop();
existing.push('', '# AI Visual Agent staging configuration (managed by deploy-release.yml)');
for (const key of orderedKeys) existing.push(`${key}=${JSON.stringify(config[key])}`);
fs.writeFileSync(outputPath, `${existing.join('\n')}\n`, { mode: 0o600, flag: 'w' });
NODE

chmod 600 "$TEMP_FILE"
mv "$TEMP_FILE" "$ENV_FILE"
trap - EXIT
echo "ai_visual_agent_staging_env=updated provider_flags=from_staging_environment backup=$BACKUP_FILE"
