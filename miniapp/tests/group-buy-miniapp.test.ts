import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MiniGroupBuyRepo } from '@/packages/group-buy/repo';
import type { GroupBuyActivity } from '@/packages/group-buy/types';
import {
  buildGroupBuySharePath,
  extractGroupBuyCodeFromScan,
  groupBuyProgress,
  groupBuyRemainingText,
  normalizeGroupBuyCode,
  resolveGroupBuyEntryCode,
} from '@/packages/group-buy/utils';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ ApiClient: { get: getMock, post: postMock } }));

const activity: GroupBuyActivity = {
      id: 'activity-1',
      companyId: 'company-1',
  status: 'ACTIVE',
  startAt: null,
  endAt: '2026-08-10T00:00:00.000Z',
  title: '鲜活大龙虾团购',
  description: '组合商品',
  price: 1000,
  freeShipping: false,
  shippingSummary: '按商品配置收取运费',
  product: { id: 'product-1', title: '鲜活大龙虾', imageUrl: null },
  sku: { id: 'sku-1', title: '单只装', stock: 10, weightGram: 1500 },
  tiers: [{ sequence: 1, label: '第一位' }, { sequence: 2, label: '第二位' }],
};

const miniPaymentParams = {
  channel: 'wechat',
  scene: 'mini_program',
  appId: 'wx-mini-id',
  timeStamp: '1785686400',
  nonceStr: 'nonce',
  package: 'prepay_id=wx-prepay',
  signType: 'RSA',
  paySign: 'signature',
  prepayId: 'wx-prepay',
} as const;

describe('WeChat mini-program group-buy', () => {
  beforeEach(() => { getMock.mockReset(); postMock.mockReset(); });

  it('uses the live public, private, lifecycle and read-only ledger routes', async () => {
    getMock.mockResolvedValue({ ok: true, data: { items: [activity] } });
    postMock.mockResolvedValue({ ok: true, data: { status: 'TERMINATED' } });
    await MiniGroupBuyRepo.listActivities();
    expect(getMock).toHaveBeenLastCalledWith('/group-buy/activities');
    await MiniGroupBuyRepo.getLanding('ABCDEF2345');
    expect(getMock).toHaveBeenLastCalledWith('/group-buy/landing/ABCDEF2345');
    await MiniGroupBuyRepo.getCurrent();
    expect(getMock).toHaveBeenLastCalledWith('/group-buy/me/current');
    await MiniGroupBuyRepo.terminateCurrent();
    expect(postMock).toHaveBeenLastCalledWith('/group-buy/me/current/terminate');
    await MiniGroupBuyRepo.abandonCurrent('instance-1');
    expect(postMock).toHaveBeenLastCalledWith('/group-buy/me/current/instance-1/abandon');
    await MiniGroupBuyRepo.getRebateAccount();
    expect(getMock).toHaveBeenLastCalledWith('/group-buy/me/rebate-account');
    getMock.mockResolvedValueOnce({ ok: true, data: { items: [], total: 21, page: 1, pageSize: 20 } });
    await expect(MiniGroupBuyRepo.listRebateLedgers()).resolves.toMatchObject({ ok: true, data: { nextPage: 2 } });
    expect(getMock).toHaveBeenLastCalledWith('/group-buy/me/rebate-ledgers', { page: 1, pageSize: 20 });
  });

  it('whitelists cash-only checkout fields and calls only the mini-program endpoint', async () => {
    postMock.mockResolvedValue({ ok: true, data: {
      sessionId: 'session-1', merchantOrderNo: 'GB-1', expectedTotal: 1012,
      goodsAmount: 1000, shippingFee: 12, discountAmount: 0,
      paymentScene: 'MINI_PROGRAM', paymentParams: miniPaymentParams,
    } });
    const untrusted = {
      activityId: 'activity-1', addressId: 'address-1', expectedTotal: 1012,
      shareCode: 'ABCDEF2345', idempotencyKey: 'group-buy-key-1',
      paymentChannel: 'other', openId: 'client-openid', couponInstanceIds: ['coupon-1'],
      deductionAmount: 100, groupBuyRebateDeductionAmount: 100, rewardId: 'reward-1',
    };
    await expect(MiniGroupBuyRepo.createMiniProgramCheckout(untrusted)).resolves.toMatchObject({ ok: true });
    expect(postMock).toHaveBeenCalledWith('/group-buy/checkout/mini-program', {
      activityId: 'activity-1', addressId: 'address-1', expectedTotal: 1012,
      fulfillment: { mode: 'DELIVERY', addressId: 'address-1' },
      shareCode: 'ABCDEF2345', idempotencyKey: 'group-buy-key-1',
    });
    const sent = postMock.mock.calls[0][1];
    expect(sent).not.toHaveProperty('paymentChannel');
    expect(sent).not.toHaveProperty('openId');
    expect(sent).not.toHaveProperty('couponInstanceIds');
    expect(sent).not.toHaveProperty('deductionAmount');
    expect(sent).not.toHaveProperty('groupBuyRebateDeductionAmount');
    expect(sent).not.toHaveProperty('rewardId');

    postMock.mockResolvedValueOnce({ ok: true, data: { expectedTotal: 1012, goodsAmount: 1000, shippingFee: 12, discountAmount: 0 } });
    await MiniGroupBuyRepo.previewCheckout(untrusted);
    expect(postMock).toHaveBeenLastCalledWith('/group-buy/checkout/preview', {
      activityId: 'activity-1', addressId: 'address-1', expectedTotal: 1012,
      fulfillment: { mode: 'DELIVERY', addressId: 'address-1' },
      shareCode: 'ABCDEF2345',
    });
  });

  it('fails closed for App or malformed payment parameters', async () => {
    postMock.mockResolvedValueOnce({ ok: true, data: {
      sessionId: 'session-1', merchantOrderNo: 'GB-1', expectedTotal: 1000,
      goodsAmount: 1000, shippingFee: 0, discountAmount: 0,
      paymentScene: 'APP', paymentParams: { channel: 'wechat', prepayId: 'app-prepay' },
    } });
    await expect(MiniGroupBuyRepo.createMiniProgramCheckout({ activityId: 'activity-1', addressId: 'address-1', expectedTotal: 1000 })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_CONTRACT' } });

    postMock.mockResolvedValueOnce({ ok: true, data: {
      sessionId: 'session-2', merchantOrderNo: 'GB-2', expectedTotal: 1000,
      goodsAmount: 1000, shippingFee: 0, discountAmount: 0,
      paymentScene: 'MINI_PROGRAM', paymentParams: { ...miniPaymentParams, package: 'not-a-prepay-package' },
    } });
    await expect(MiniGroupBuyRepo.createMiniProgramCheckout({ activityId: 'activity-1', addressId: 'address-1', expectedTotal: 1000 })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_CONTRACT' } });
  });

  it('normalizes direct, scene and scanned group-buy codes without treating arbitrary URLs as codes', () => {
    expect(normalizeGroupBuyCode(' gb_abcdef2345 ')).toBe('ABCDEF2345');
    expect(resolveGroupBuyEntryCode({ shareCode: 'bad code', scene: 'GB:ABCDEF2345' })).toBe('ABCDEF2345');
    expect(extractGroupBuyCodeFromScan('https://ai-maimai.com/gb/ABCDEF2345')).toBe('ABCDEF2345');
    expect(extractGroupBuyCodeFromScan('https://example.test/?shareCode=ABCDEF2345')).toBe('ABCDEF2345');
    expect(extractGroupBuyCodeFromScan('packages/group-buy/activity-detail/index?scene=GB_ABCDEF2345')).toBe('ABCDEF2345');
    expect(extractGroupBuyCodeFromScan('javascript:alert(1)')).toBeNull();
    expect(buildGroupBuySharePath('ABCDEF2345', 'activity/unsafe')).toBe('/packages/group-buy/activity-detail/index?activityId=activity%2Funsafe&shareCode=ABCDEF2345');
  });

  it('derives progress and countdown from server state', () => {
    expect(groupBuyProgress({
      id: 'instance-1', status: 'SHARING', validReferralCount: 1, candidateCount: 1,
      code: { code: 'ABCDEF2345', status: 'ACTIVE' }, activity,
      referrals: [
        { id: 'r1', status: 'VALID', candidateSequence: 1, effectiveSequence: 1 },
        { id: 'r2', status: 'CANDIDATE', candidateSequence: 2, effectiveSequence: null },
      ],
    })).toEqual({ target: 2, locked: 2, valid: 1, remaining: 0 });
    expect(groupBuyRemainingText('2026-08-03T01:30:00.000Z', new Date('2026-08-03T00:00:00.000Z').getTime())).toBe('剩余 1 小时 30 分钟');
    expect(groupBuyRemainingText('2026-08-02T00:00:00.000Z', new Date('2026-08-03T00:00:00.000Z').getTime())).toBe('活动已结束');
  });

  it('keeps pages login-gated, three-state, share-honest and free of forbidden pay paths', () => {
    const root = path.resolve(process.cwd(), 'src/packages/group-buy');
    const sources = fs.readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((entry) => /\.(ts|tsx)$/.test(entry))
      .map((entry) => fs.readFileSync(path.join(root, entry), 'utf8'))
      .join('\n');
    expect(sources).toContain('returnUrl=');
    expect(sources).toContain("kind='loading'");
    expect(sources).toContain("kind='empty'");
    expect(sources).toContain("kind='error'");
    expect(sources).toContain("openType='share'");
    expect(sources).not.toMatch(/showToast\([^)]*分享成功/);
    expect(sources).not.toMatch(/alipay|支付宝/i);
    expect(sources).not.toMatch(/requestRebateWithdraw|rebate-withdraw/);
    expect(sources).not.toMatch(/\/group-buy\/checkout(?:['"`])/);
    const checkoutSource = fs.readFileSync(path.join(root, 'checkout/index.tsx'), 'utf8');
    const pendingSource = fs.readFileSync(path.join(root, 'checkout-pending/index.tsx'), 'utf8');
    expect(checkoutSource).toContain('/packages/group-buy/checkout-pending/index');
    expect(checkoutSource).not.toContain('/packages/commerce/checkout-pending/index');
    expect(pendingSource).toContain('CheckoutRepo.switchFromApp');
    expect(pendingSource).toContain('CheckoutRepo.resume');
    expect(pendingSource).toContain('CheckoutRepo.activeQuery');
  });
});
