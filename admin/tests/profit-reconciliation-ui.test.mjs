import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('profit reconciliation API covers the complete review workflow', () => {
  const source = read('../src/api/profit-reconciliation.ts');

  for (const operation of [
    'getProfitReconciliations',
    'getProfitReconciliation',
    'recalculateProfit',
    'rejectProfitReconciliation',
    'getProfitAdjustments',
    'getProfitAdjustment',
    'approveAndApplyProfitAdjustment',
    'rejectProfitAdjustment',
  ]) {
    assert.match(source, new RegExp(`export const ${operation}`));
  }
  for (const endpoint of [
    '/admin/profit-reconciliation',
    '/recalculate',
    '/reject',
    '/admin/profit-adjustments',
    '/approve-and-apply',
  ]) {
    assert.match(source, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
  assert.match(source, /costCorrections/);
  assert.match(source, /replacementChain/);
  assert.match(source, /formatProfitWorkflowError/);
  assert.match(source, /PagedProfitResult/);
  assert.match(source, /pageSize/);
});

test('admin routes and captain operations menu expose both pages', () => {
  const app = read('../src/App.tsx');
  const layout = read('../src/layouts/AdminLayout.tsx');

  assert.match(app, /captain\/profit-reconciliations/);
  assert.match(app, /captain\/profit-adjustments/);
  assert.match(app, /RequirePermission/);
  assert.match(app, /PERMISSIONS\.CAPTAIN_READ/);
  assert.match(layout, /利润纠错/);
  assert.match(layout, /利润调整单/);
});

test('reconciliation page captures every non-prize item cost and an audited reason', () => {
  const source = read('../src/pages/captain/reconciliations.tsx');

  assert.match(source, /filter\(\(item\) => !item\.isPrize\)/);
  assert.match(source, /unitCostCents/);
  assert.match(source, /reason/);
  assert.match(source, /sourceSnapshot/);
  assert.match(source, /resolvedSnapshot/);
  assert.match(source, /利润规则 V3/);
  assert.match(source, /历史模型/);
  assert.match(source, /params\.current/);
  assert.match(source, /result\.items/);
  assert.match(source, /result\.total/);
});

test('adjustment page exposes deltas, funding source, and replacement chain', () => {
  const source = read('../src/pages/captain/adjustments.tsx');

  assert.match(source, /beforeCents/);
  assert.match(source, /targetCents/);
  assert.match(source, /deltaCents/);
  assert.match(source, /fundingType/);
  assert.match(source, /replacementChain/);
  assert.match(source, /approveAndApplyProfitAdjustment/);
  assert.match(source, /rejectProfitAdjustment/);
  assert.match(source, /利润规则 V3/);
  assert.match(source, /历史模型/);
  assert.match(source, /params\.current/);
  assert.match(source, /result\.items/);
  assert.match(source, /result\.total/);
});

test('captain settings exposes limiting SKU economics and reasons', () => {
  const source = read('../src/pages/captain/settings.tsx');

  assert.match(source, /summary\.limitingSkus/);
  assert.match(source, /grossMarginRate/);
  assert.match(source, /platformRequiredRevenueRate/);
  assert.match(source, /reason/);
  assert.match(source, /safetyQuery\.isError/);
  assert.match(source, /safetyQuery\.refetch/);
  assert.match(source, /利润安全预检失败/);
});

test('buyer me page never turns a captain profile failure into an application entry', () => {
  const source = read('../../app/(tabs)/me.tsx');

  assert.match(source, /captainProfileFailed/);
  assert.match(source, /refetchCaptainProfile/);
  assert.match(source, /团长状态加载失败/);
  assert.match(source, /if \(!captainProfileFailed\)/);
});

test('captain settlements expose reconciliation blockers and action errors', () => {
  const source = read('../src/pages/captain/settlements.tsx');

  assert.match(source, /reviewBlockedReason/);
  assert.match(source, /利润对账/);
  assert.match(source, /message\.error/);
  assert.match(source, /Boolean\(record\.reviewBlockedReason\)/);
});
