import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test, { after } from 'node:test';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const testOutputDir = resolve(adminRoot, '.tmp/profit-safety-guidance-test');
const testOutputParent = resolve(adminRoot, '.tmp');
const cleanup = () => {
  rmSync(testOutputDir, { force: true, recursive: true });
  try {
    rmdirSync(testOutputParent);
  } catch {
    // Preserve a non-empty shared temporary directory.
  }
};

process.once('exit', cleanup);
after(cleanup);

rmSync(testOutputDir, { force: true, recursive: true });
mkdirSync(testOutputDir, { recursive: true });
writeFileSync(resolve(testOutputDir, 'package.json'), '{"type":"commonjs"}');
execFileSync(process.execPath, [
  resolve(adminRoot, 'node_modules/typescript/bin/tsc'),
  '--target', 'ES2022',
  '--module', 'commonjs',
  '--moduleResolution', 'node',
  '--strict',
  '--skipLibCheck',
  '--rootDir', 'src/utils',
  '--outDir', '.tmp/profit-safety-guidance-test',
  'src/utils/configProfitSafetyPreview.ts',
  'src/utils/profitSafetyGuidance.ts',
], { cwd: adminRoot, stdio: 'inherit' });

const require = createRequire(import.meta.url);
const {
  getProfitSafetyGuidance,
  getSystemConfigCompletenessNotice,
} = require(resolve(testOutputDir, 'profitSafetyGuidance.js'));

const safeScenarios = [
  { buyerPath: 'VIP', inviterPath: 'VIP', safe: true, captainProfitRate: 0 },
  { buyerPath: 'VIP', inviterPath: 'NORMAL', safe: true, captainProfitRate: 0 },
  { buyerPath: 'NORMAL', inviterPath: 'VIP', safe: true, captainProfitRate: 0 },
  { buyerPath: 'NORMAL', inviterPath: 'NORMAL', safe: true, captainProfitRate: 0 },
];

test('treats an unsaved or disabled captain program as a neutral zero-reward state', () => {
  const guidance = getProfitSafetyGuidance({
    safe: true,
    captainConfigState: 'DISABLED',
    errors: [],
    scenarios: safeScenarios,
  });

  assert.equal(guidance.state, 'disabled');
  assert.match(guidance.title, /未启用/);
  assert.equal(guidance.alertType, 'info');
  assert.equal(guidance.actions[0]?.label, '开始配置团长激励');
});

test('turns incomplete financial inputs into concrete setup actions instead of a false SKU-risk alert', () => {
  const guidance = getProfitSafetyGuidance({
    safe: false,
    captainConfigState: 'INVALID',
    errors: ['INVALID_CAPTAIN_CONFIG'],
    scenarios: safeScenarios,
    profitSafetyConfigCompleteness: {
      missingKeys: ['VIP_DISCOUNT_RATE', 'NORMAL_REWARD_PERCENT'],
    },
  });

  assert.equal(guidance.state, 'setup');
  assert.equal(guidance.alertType, 'warning');
  assert.deepEqual(guidance.actions.map((action) => action.id), [
    'vip-config',
    'normal-config',
    'captain-settings',
  ]);
});

test('prioritizes incomplete or invalid inputs over non-authoritative SKU calculations', () => {
  const guidance = getProfitSafetyGuidance({
    safe: false,
    captainConfigState: 'INVALID',
    errors: ['INVALID_CAPTAIN_CONFIG'],
    scenarios: [
      { buyerPath: 'VIP', inviterPath: 'VIP', safe: false, captainProfitRate: 0.08 },
      ...safeScenarios.slice(1),
    ],
  });

  assert.equal(guidance.state, 'setup');
  assert.equal(guidance.alertType, 'warning');
  assert.deepEqual(guidance.actions.map((action) => action.id), ['captain-settings']);
});

test('maps an invalid automatic pricing input to platform pricing rather than unrelated captain settings', () => {
  const guidance = getProfitSafetyGuidance({
    safe: false,
    captainConfigState: 'ENABLED',
    errors: ['INVALID_MARKUP_RATE'],
    scenarios: safeScenarios,
  });

  assert.equal(guidance.state, 'setup');
  assert.deepEqual(guidance.actions.map((action) => action.id), ['platform-pricing']);
});

test('sends an actual margin risk to the product, captain and affected reward configuration pages', () => {
  const guidance = getProfitSafetyGuidance({
    safe: false,
    captainConfigState: 'ENABLED',
    errors: [],
    scenarios: [
      { buyerPath: 'VIP', inviterPath: 'VIP', safe: false, captainProfitRate: 0.08 },
      ...safeScenarios.slice(1),
    ],
  });

  assert.equal(guidance.state, 'risk');
  assert.equal(guidance.alertType, 'error');
  assert.deepEqual(guidance.actions.map((action) => action.id), [
    'captain-settings',
    'products',
    'vip-config',
  ]);
});

test('keeps unrelated missing system settings out of the profit-risk state but provides direct setup links', () => {
  const notice = getSystemConfigCompletenessNotice({
    ruleConfigCompleteness: {
      missingKeys: [
        'GROWTH_VIP_CHECKIN_POINTS_MULTIPLIER',
        'DIGITAL_ASSET_CREDIT_TIERS',
        'DISCOVERY_COMPANY_FILTERS',
      ],
    },
  });

  assert.ok(notice);
  assert.match(notice.message, /不会被当作商品利润缺口/);
  assert.deepEqual(notice.actions.map((action) => action.id), [
    'growth-config',
    'digital-assets',
    'discovery-filters',
  ]);
});

test('does not repeat an unsaved disabled captain program as a system configuration warning', () => {
  const notice = getSystemConfigCompletenessNotice({
    captainConfigState: 'DISABLED',
    ruleConfigCompleteness: {
      missingKeys: ['CAPTAIN_SEAFOOD_CONFIG'],
    },
  });

  assert.equal(notice, null);
});

test('captain settings uses the actionable state model and product names instead of raw limiting SKU ids', () => {
  const source = readFileSync(resolve(adminRoot, 'src/pages/captain/settings.tsx'), 'utf8');

  assert.match(source, /getProfitSafetyGuidance/);
  assert.match(source, /getSystemConfigCompletenessNotice/);
  assert.match(source, /商品名称待补充/);
  assert.match(source, /查看四种买家与推荐人组合测算/);
  assert.match(source, /onCaptainSettings/);
  assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  assert.match(source, /已定位到团长基础开关/);
  assert.doesNotMatch(source, /团长激励未启用，当前按 0% 团长奖励测算/);
  assert.doesNotMatch(source, /当前参数将突破平台利润底线/);
});
