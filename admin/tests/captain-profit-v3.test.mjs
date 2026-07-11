import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatProfitSafetyError,
  getCaptainCalculationDisplay,
  getCaptainCalculationModel,
  getCaptainProfitBaseAmount,
  getConfigRollbackState,
  isProfitV3Settlement,
  shouldLinkCaptainSettings,
} from '../src/components/captainProfitV3.ts';

test('uses profit base for V3 orders and labels V2 rows as history', () => {
  assert.equal(getCaptainProfitBaseAmount({
    calculationModel: 'PROFIT_V3',
    profitBaseAmount: 35,
    commissionBase: 120,
  }), 35);
  assert.deepEqual(getCaptainCalculationDisplay('SALES_V2'), {
    label: '历史销售额规则',
    color: 'default',
  });
});

test('recognizes V3 monthly settlements from their server snapshots', () => {
  assert.equal(isProfitV3Settlement({ configSnapshot: { schemaVersion: 3 } }), true);
  assert.equal(isProfitV3Settlement({ meta: { calculationModel: 'PROFIT_V3_ORDER_SNAPSHOT' } }), true);
  assert.equal(isProfitV3Settlement({ configSnapshot: { schemaVersion: 2 } }), false);
});

test('recognizes V3 ledger rows from attribution or config snapshots', () => {
  assert.equal(getCaptainCalculationModel({
    orderAttribution: { calculationModel: 'PROFIT_V3' },
  }), 'PROFIT_V3');
  assert.equal(getCaptainCalculationModel({
    configSnapshot: { schemaVersion: 3 },
  }), 'PROFIT_V3');
  assert.equal(getCaptainCalculationModel({
    configSnapshot: { schemaVersion: 2 },
  }), 'SALES_V2');
});

test('uses server rollback permission and exposes the blocking reason', () => {
  assert.deepEqual(getConfigRollbackState({
    rollbackAllowed: false,
    rollbackBlockedReason: '该版本是不完整历史快照，不允许回滚',
  }), {
    disabled: true,
    reason: '该版本是不完整历史快照，不允许回滚',
  });
});

test('links unsafe captain-funded scenarios to captain settings', () => {
  assert.equal(shouldLinkCaptainSettings({
    safe: false,
    errors: [],
    scenarios: [{ safe: false, captainProfitRate: 0.08 }],
  }), true);
  assert.equal(shouldLinkCaptainSettings({
    safe: false,
    errors: [],
    scenarios: [{ safe: false, captainProfitRate: 0 }],
  }), false);
});

test('formats structured safety details when the current Error exposes them', () => {
  const error = Object.assign(new Error('当前配置会突破平台利润安全底线'), {
    details: {
      scenarios: [{ key: 'VIP_BUYER_VIP_INVITER', safe: false }],
      limitingSkus: [{ skuId: 'sku-low-margin', shortfall: 0.031 }],
      shortfall: 0.031,
    },
  });

  assert.equal(
    formatProfitSafetyError(error),
    '当前配置会突破平台利润安全底线；失败场景 VIP_BUYER_VIP_INVITER；限制 SKU sku-low-margin；利润缺口 3.10%',
  );
  assert.equal(formatProfitSafetyError(new Error('保存失败')), '保存失败');
});
