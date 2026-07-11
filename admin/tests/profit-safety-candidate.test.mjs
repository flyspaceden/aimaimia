import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildProfitSafetyCandidateUpdates,
  createProfitSafetyPreviewScheduler,
  getProfitSafetyPreviewEligibility,
  getProfitSafetyStatusPresentation,
} = require('../.tmp/profit-safety-preview-test/configProfitSafetyPreview.js');

const schema = [
  { key: 'VIP_PLATFORM_RATE' },
  { key: 'VIP_TREE_RATE' },
  { key: 'VIP_CAPTAIN_RATE' },
];

const configs = [
  { key: 'VIP_PLATFORM_RATE', value: { value: 0.5, description: '平台' }, updatedAt: '2026-07-11' },
  { key: 'VIP_TREE_RATE', value: { value: 0.3 }, updatedAt: '2026-07-11' },
  { key: 'VIP_CAPTAIN_RATE', value: 0.06, updatedAt: '2026-07-11' },
];

const unsafeSummary = {
  safe: false,
  scenarios: [{ key: 'VIP_BUYER_VIP_INVITER', safe: false, captainProfitRate: 0.08 }],
  limitingSkus: [{ skuId: 'sku-litchi', shortfall: 0.023 }],
  shortfall: 0.023,
  errors: ['CAPTAIN_PROFIT_RATE exceeds margin'],
};

test('builds every changed RuleConfig-style candidate update and unwraps saved values', () => {
  assert.deepEqual(
    buildProfitSafetyCandidateUpdates(configs, {
      VIP_PLATFORM_RATE: 0.48,
      VIP_TREE_RATE: 0.3,
      VIP_CAPTAIN_RATE: 0.08,
    }, schema),
    [
      { key: 'VIP_PLATFORM_RATE', value: { value: 0.48 } },
      { key: 'VIP_CAPTAIN_RATE', value: { value: 0.08 } },
    ],
  );
});

test('returns all ineligible states before requesting a candidate preview', () => {
  const base = { enabled: true, valuesReady: true, updates: [{ key: 'VIP_TREE_RATE', value: { value: 0.31 } }], sumValid: true, hasValidationErrors: false };
  assert.equal(getProfitSafetyPreviewEligibility({ ...base, enabled: false }), 'saved');
  assert.equal(getProfitSafetyPreviewEligibility({ ...base, valuesReady: false }), 'saved');
  assert.equal(getProfitSafetyPreviewEligibility({ ...base, updates: [] }), 'saved');
  assert.equal(getProfitSafetyPreviewEligibility({ ...base, sumValid: false }), 'invalid-ratio');
  assert.equal(getProfitSafetyPreviewEligibility({ ...base, hasValidationErrors: true }), 'invalid-form');
  assert.equal(getProfitSafetyPreviewEligibility(base), 'ready');
});

test('schedules deterministically after 500ms and discards stale completions', async () => {
  let nextTimer = 0;
  const pendingTimers = new Map();
  const timers = {
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      pendingTimers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      pendingTimers.delete(id);
    },
  };
  const checks = [];
  const candidates = [];
  let resolveFirst;
  let resolveSecond;
  const scheduler = createProfitSafetyPreviewScheduler({
    delayMs: 500,
    timers,
    preview: (updates) => new Promise((resolve) => {
      if (updates[0].value.value === 0.31) resolveFirst = resolve;
      else resolveSecond = resolve;
    }),
    onChecking: () => checks.push('checking'),
    onCandidate: (summary) => candidates.push(summary),
    onError: (error) => { throw error; },
  });

  scheduler.schedule([{ key: 'VIP_TREE_RATE', value: { value: 0.31 } }]);
  const firstTimer = [...pendingTimers.values()][0];
  assert.equal(firstTimer.delay, 500);
  firstTimer.callback();
  pendingTimers.clear();
  scheduler.schedule([{ key: 'VIP_TREE_RATE', value: { value: 0.32 } }]);
  const secondTimer = [...pendingTimers.values()][0];
  assert.equal(secondTimer.delay, 500);
  secondTimer.callback();
  resolveFirst({ safe: true });
  await Promise.resolve();
  resolveSecond({ safe: false });
  await Promise.resolve();

  assert.deepEqual(checks, ['checking', 'checking']);
  assert.deepEqual(candidates, [{ safe: false }]);
});

test('maps candidate and saved status presentations precisely', () => {
  assert.deepEqual(getProfitSafetyStatusPresentation({ kind: 'checking' }), {
    type: 'info', message: '正在校验未保存参数', description: undefined, summary: undefined, linkCaptain: false,
  });
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'invalid-ratio' }).message, '请先使七项比例合计为 100% 再校验利润安全');
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'invalid-form' }).message, '请先修正存在校验错误的参数再校验利润安全');
  assert.deepEqual(getProfitSafetyStatusPresentation({ kind: 'error', error: new Error('network') }), {
    type: 'warning', message: '未保存参数的利润安全校验失败', description: 'network', summary: undefined, linkCaptain: false,
  });
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'candidate', summary: { safe: true } }).message, '未保存参数通过利润安全校验');
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'candidate', summary: unsafeSummary, linkCaptain: true }).message, '未保存参数未通过利润安全校验');
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'candidate', summary: unsafeSummary, linkCaptain: true }).linkCaptain, true);
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'saved', summary: { safe: true } }).message, '服务器利润安全校验通过');
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'saved', summary: unsafeSummary }).message, '服务器利润安全校验未通过');
  assert.equal(getProfitSafetyStatusPresentation({ kind: 'saved', loading: true }).message, '正在读取服务器利润安全状态');
  assert.deepEqual(getProfitSafetyStatusPresentation({ kind: 'saved', error: new Error('offline') }), {
    type: 'warning', message: '利润安全状态暂不可用', description: 'offline', summary: undefined, linkCaptain: false,
  });
});
