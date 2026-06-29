declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import type { WalletLedgerEntry } from '../../types/domain/Bonus';
import { getWalletLedgerTitle } from '../walletLedger';

function ledger(overrides: Partial<WalletLedgerEntry>): WalletLedgerEntry {
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
});
