declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import type { WalletLedgerEntry } from '../../types/domain/Bonus';
import { getWalletLedgerTitle, isWalletDeductionTitle } from '../walletLedger';

function ledger(overrides: Partial<WalletLedgerEntry> & Record<string, unknown>): WalletLedgerEntry {
  return {
    id: 'ledger-1',
    entryType: 'RELEASE',
    source: 'REWARD',
    sourceLedgerId: 'ledger-1',
    type: 'RELEASE',
    amount: 10,
    status: 'AVAILABLE',
    balanceAfter: 10,
    refType: 'ORDER',
    refId: 'order-1',
    meta: null,
    createdAt: '2026-06-29T00:00:00.000Z',
    accountType: 'VIP_REWARD',
    ...overrides,
  };
}

describe('wallet ledger display titles', () => {
  it('labels group-buy pending rebates as frozen group-buy rebates', () => {
    expect(getWalletLedgerTitle(ledger({
      source: 'GROUP_BUY_REBATE',
      entryType: 'PENDING_REBATE',
      type: 'PENDING_REBATE',
      status: 'PENDING',
      accountType: 'GROUP_BUY_REBATE',
    }))).toBe('团购返还冻结中');
  });

  it('labels group-buy available, deduction, and withdrawal rows distinctly', () => {
    expect(getWalletLedgerTitle(ledger({
      source: 'GROUP_BUY_REBATE',
      entryType: 'RELEASE',
      type: 'RELEASE',
      status: 'AVAILABLE',
      accountType: 'GROUP_BUY_REBATE',
    }))).toBe('团购返还到账');

    expect(getWalletLedgerTitle(ledger({
      source: 'GROUP_BUY_REBATE',
      entryType: 'DEDUCT',
      type: 'DEDUCT',
      accountType: 'GROUP_BUY_REBATE',
    }))).toBe('团购返还抵扣');

    expect(getWalletLedgerTitle(ledger({
      source: 'GROUP_BUY_REBATE',
      entryType: 'WITHDRAW',
      type: 'WITHDRAW',
      refType: 'WITHDRAW',
      accountType: 'GROUP_BUY_REBATE',
    }))).toBe('团购返还提现');
  });

  it('keeps seller-owner industry fund rows separate from generic consumption points', () => {
    expect(getWalletLedgerTitle(ledger({
      accountType: 'INDUSTRY_FUND',
      source: 'REWARD',
      refType: 'ORDER',
    }))).toBe('产业基金');
  });

  it('labels VIP direct referral commission by scheme even when refType is ORDER', () => {
    expect(getWalletLedgerTitle(ledger({
      refType: 'ORDER',
      meta: { scheme: 'VIP_DIRECT_REFERRAL' },
    }))).toBe('VIP 直推佣金');
  });

  it('prefers backend reward sourceLabel without overriding group-buy special states', () => {
    expect(getWalletLedgerTitle(ledger({
      refType: 'ORDER',
      sourceLabel: 'VIP 直推佣金',
    }))).toBe('VIP 直推佣金');

    expect(getWalletLedgerTitle(ledger({
      source: 'GROUP_BUY_REBATE',
      entryType: 'PENDING_REBATE',
      type: 'PENDING_REBATE',
      status: 'PENDING',
      accountType: 'GROUP_BUY_REBATE',
      sourceLabel: 'VIP 直推佣金',
    }))).toBe('团购返还冻结中');
  });

  it('keeps VIP upstream and VIP referral titles distinct', () => {
    expect(getWalletLedgerTitle(ledger({
      refType: 'ORDER',
      scheme: 'VIP_UPSTREAM',
      meta: { scheme: 'VIP_DIRECT_REFERRAL' },
    }))).toBe('VIP 上溯分润');

    expect(getWalletLedgerTitle(ledger({
      refType: 'VIP_REFERRAL',
      meta: { scheme: 'VIP_REFERRAL' },
    }))).toBe('VIP 推荐奖励');
  });

  it('falls back to withdraw and deduction titles when unknown schemes have no sourceLabel', () => {
    expect(getWalletLedgerTitle(ledger({
      entryType: 'WITHDRAW',
      type: 'WITHDRAW',
      refType: 'WITHDRAW',
      meta: { scheme: 'POINTS_WITHDRAW' },
    }))).toBe('提现到支付宝');

    expect(getWalletLedgerTitle(ledger({
      entryType: 'DEDUCT',
      type: 'DEDUCT',
      refType: 'ORDER',
      meta: { scheme: 'POINTS_DEDUCTION' },
    }))).toBe('消费抵扣');
  });

  it('classifies both reward and group-buy deduction titles as consumption deductions', () => {
    expect(isWalletDeductionTitle('消费抵扣')).toBe(true);
    expect(isWalletDeductionTitle('团购返还抵扣')).toBe(true);
    expect(isWalletDeductionTitle('团购返还提现')).toBe(false);
  });
});
