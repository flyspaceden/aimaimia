import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemberCouponRepo, MemberDigitalAssetRepo, MemberWalletRepo } from '../repos';
import {
  ASSET_FILTER_QUERY,
  createWithdrawIdempotencyKey,
  hasMerchantTransferConfirmation,
  isPendingWithdrawStatus,
  walletLedgerPresentation,
} from '../utils';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  ApiClient: { get: getMock, post: postMock },
}));

const ledger = {
  id: 'asset-1',
  type: 'CONSUMPTION_CONFIRMED',
  sourceType: 'CONSUMPTION_CONFIRMED',
  subjectType: 'CUMULATIVE_SPEND',
  direction: 'CREDIT',
  amount: 88,
  balanceAfter: 288,
  title: '消费累计',
  createdAt: '2026-08-02T10:00:00.000Z',
};

describe('member asset repo contracts', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('exposes only the unified wallet read model to member pages', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: {
        balance: 120,
        frozen: 20,
        total: 140,
        deductibleBalance: 90,
        withdrawableBalance: 120,
        vip: { balance: 50, frozen: 10 },
        normal: { balance: 70, frozen: 10 },
        industryFund: { balance: 1, frozen: 0 },
      },
    });

    await expect(MemberWalletRepo.getWallet()).resolves.toEqual({
      ok: true,
      data: {
        balance: 120,
        frozen: 20,
        total: 140,
        deductibleBalance: 90,
        withdrawableBalance: 120,
      },
    });
  });

  it('submits a WeChat-only withdrawal with an explicit idempotency key', async () => {
    postMock.mockResolvedValue({
      ok: true,
      data: {
        withdrawId: 'withdraw-1', grossAmount: 100, taxAmount: 20, taxRate: 0.2,
        netAmount: 80, status: 'PROCESSING', message: '请在微信中确认收款',
        mchId: '1900000109', appId: 'wx-mini', package: 'confirm-package',
      },
    });

    const result = await MemberWalletRepo.requestWechatWithdraw(100, 'withdraw-key-001');
    expect(postMock).toHaveBeenCalledWith(
      '/bonus/withdraw',
      { amount: 100, channel: 'wechat' },
      { idempotencyKey: 'withdraw-key-001' },
    );
    expect(result.ok && hasMerchantTransferConfirmation(result.data)).toBe(true);
  });

  it('generates valid independent withdrawal idempotency keys', () => {
    const first = createWithdrawIdempotencyKey();
    const second = createWithdrawIdempotencyKey();
    expect(first).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(second).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(first).not.toBe(second);
  });

  it('uses the wallet ledger nextPage returned by the server unchanged', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: {
        items: [{
          id: 'wallet-1', entryType: 'WITHDRAW', amount: 50, status: 'PROCESSING',
          refType: 'WITHDRAW', meta: null, accountType: null, createdAt: '2026-08-02T10:00:00Z',
        }],
        nextPage: 7,
      },
    });

    await expect(MemberWalletRepo.getLedger(4, 20)).resolves.toMatchObject({ ok: true, data: { nextPage: 7 } });
    expect(getMock).toHaveBeenCalledWith('/bonus/wallet/ledger', { page: 4, pageSize: 20 });
  });

  it('uses channel-neutral copy for historical withdrawal ledgers', () => {
    const presentation = walletLedgerPresentation({
      id: 'wallet-1', entryType: 'WITHDRAW', amount: 50, status: 'SETTLED',
      refType: 'WITHDRAW', meta: null, accountType: null, createdAt: '2026-08-02T10:00:00Z',
    });
    expect(presentation).toMatchObject({ title: '余额提现', amount: -50, tone: 'expense' });
    expect(`${presentation.title}${presentation.description}`).toBe('余额提现提现记录');
  });

  it('treats every non-terminal withdrawal state as pending', () => {
    expect(['REQUESTED', 'APPROVED', 'PROCESSING'].every(isPendingWithdrawStatus)).toBe(true);
    expect(['PAID', 'FAILED', 'REJECTED'].some(isPendingWithdrawStatus)).toBe(false);
  });

  it('sends digital asset filters to the authoritative paginated endpoint', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: { items: [ledger], total: 41, page: 2, pageSize: 20 },
    });

    await expect(MemberDigitalAssetRepo.getLedgers({
      page: 2,
      pageSize: 20,
      ...ASSET_FILTER_QUERY.refund,
    })).resolves.toMatchObject({ ok: true, data: { nextPage: 3 } });
    expect(getMock).toHaveBeenCalledWith('/me/digital-assets/ledgers', {
      page: 2,
      pageSize: 20,
      subjectType: undefined,
      sourceType: 'REFUND_REVERSAL',
    });
  });

  it('rejects malformed digital asset pagination instead of rendering partial data', async () => {
    getMock.mockResolvedValue({ ok: true, data: { items: [ledger], page: 1, pageSize: 20 } });
    await expect(MemberDigitalAssetRepo.getLedgers()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTRACT' },
    });
  });

  it('keeps coupon status filtering server-side and renders server status as-is', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: [{
        id: 'coupon-1', campaignName: '新人券', discountType: 'FIXED', discountValue: 10,
        maxDiscountAmount: null, minOrderAmount: 50, status: 'RESERVED',
        issuedAt: '2026-08-01T00:00:00Z', expiresAt: '2026-08-31T00:00:00Z',
        usedAt: null, usedOrderId: null, usedAmount: null,
      }],
    });

    await expect(MemberCouponRepo.getMine('RESERVED')).resolves.toMatchObject({
      ok: true,
      data: [{ status: 'RESERVED' }],
    });
    expect(getMock).toHaveBeenCalledWith('/coupons/my', { status: 'RESERVED' });
  });
});
