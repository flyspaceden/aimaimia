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

function createTimers() {
  let nextTimer = 0;
  const pendingTimers = new Map();
  const clearedTimers = [];
  const timers = {
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      pendingTimers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      clearedTimers.push(id);
      pendingTimers.delete(id);
    },
  };
  return { timers, pendingTimers, clearedTimers };
}

function runOnlyTimer(pendingTimers) {
  assert.equal(pendingTimers.size, 1);
  const [id, timer] = pendingTimers.entries().next().value;
  pendingTimers.delete(id);
  timer.callback();
  return timer;
}

test('replaces a pending timer before 500ms so only the latest request runs', async () => {
  const { timers, pendingTimers, clearedTimers } = createTimers();
  const requests = [];
  const checks = [];
  const scheduler = createProfitSafetyPreviewScheduler({
    delayMs: 500,
    timers,
    preview: async (updates) => {
      requests.push(updates);
      return { safe: true };
    },
    onChecking: () => checks.push('checking'),
    onCandidate: () => {},
    onError: (error) => { throw error; },
  });

  scheduler.schedule([{ key: 'VIP_TREE_RATE', value: { value: 0.31 } }]);
  scheduler.schedule([{ key: 'VIP_TREE_RATE', value: { value: 0.32 } }]);

  assert.deepEqual(clearedTimers, [1]);
  const timer = runOnlyTimer(pendingTimers);
  assert.equal(timer.delay, 500);
  await Promise.resolve();

  assert.deepEqual(checks, ['checking']);
  assert.deepEqual(requests, [[{ key: 'VIP_TREE_RATE', value: { value: 0.32 } }]]);
});

test('discards a stale non-Error rejection after a newer request succeeds', async () => {
  const { timers, pendingTimers } = createTimers();
  const checks = [];
  const candidates = [];
  const errors = [];
  let rejectFirst;
  let resolveSecond;
  const scheduler = createProfitSafetyPreviewScheduler({
    delayMs: 500,
    timers,
    preview: (updates) => new Promise((resolve, reject) => {
      if (updates[0].value.value === 0.31) rejectFirst = reject;
      else resolveSecond = resolve;
    }),
    onChecking: () => checks.push('checking'),
    onCandidate: (summary) => candidates.push(summary),
    onError: (error) => errors.push(error),
  });

  scheduler.schedule([{ key: 'VIP_TREE_RATE', value: { value: 0.31 } }]);
  runOnlyTimer(pendingTimers);
  scheduler.schedule([{ key: 'VIP_TREE_RATE', value: { value: 0.32 } }]);
  runOnlyTimer(pendingTimers);
  resolveSecond({ safe: false });
  await Promise.resolve();
  rejectFirst('stale failure');
  await Promise.resolve();

  assert.deepEqual(checks, ['checking', 'checking']);
  assert.deepEqual(candidates, [{ safe: false }]);
  assert.deepEqual(errors, []);
});

test('normalizes a current non-Error rejection', async () => {
  const { timers, pendingTimers } = createTimers();
  const errors = [];
  let rejectCurrent;
  const scheduler = createProfitSafetyPreviewScheduler({
    delayMs: 500,
    timers,
    preview: () => new Promise((_resolve, reject) => {
      rejectCurrent = reject;
    }),
    onChecking: () => {},
    onCandidate: () => {},
    onError: (error) => errors.push(error),
  });

  scheduler.schedule([{ key: 'VIP_TREE_RATE', value: { value: 0.31 } }]);
  runOnlyTimer(pendingTimers);
  rejectCurrent('network unavailable');
  await Promise.resolve();

  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  assert.equal(errors[0].message, '预检请求失败');
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
