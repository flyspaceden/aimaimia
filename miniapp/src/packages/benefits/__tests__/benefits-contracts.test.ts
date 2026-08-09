import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BenefitsRepo } from '../repos';
import {
  buildPrizeMergeItem,
  clearVipCheckoutDraft,
  clearVipCheckoutSession,
  readVipCheckoutDraft,
  readVipCheckoutSession,
  safeTaskTarget,
  saveVipCheckoutDraft,
  saveVipCheckoutSession,
} from '../utils';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const storageState = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/api/client', () => ({ ApiClient: { get: getMock, post: postMock } }));
vi.mock('@tarojs/taro', () => ({ default: {
  getStorageSync: (key: string) => storageState.get(key),
  setStorageSync: (key: string, value: unknown) => storageState.set(key, value),
  removeStorageSync: (key: string) => storageState.delete(key),
} }));

const gift = {
  id: 'gift-1', title: '丰收礼盒', subtitle: '当季好物', badge: '热门',
  coverMode: 'AUTO_GRID', coverUrl: null, totalPrice: 168, available: true,
  items: [{ skuId: 'sku-1', productTitle: '果品', productImage: null, skuTitle: '1kg', price: 168, quantity: 1 }],
};

describe('benefits repository contracts', () => {
  beforeEach(() => { getMock.mockReset(); postMock.mockReset(); storageState.clear(); });

  it('accepts and preserves multiple server-authoritative VIP packages', async () => {
    getMock.mockResolvedValue({ ok: true, data: { packages: [
      { id: 'package-399', price: 399, sortOrder: 2, giftOptions: [gift] },
      { id: 'package-699', price: 699, sortOrder: 1, giftOptions: [{ ...gift, id: 'gift-2' }] },
    ] } });
    await expect(BenefitsRepo.getVipGiftOptions()).resolves.toMatchObject({ ok: true, data: { packages: [{ price: 399 }, { price: 699 }] } });
    expect(getMock).toHaveBeenCalledWith('/bonus/vip/gift-options');
  });

  it('uses the real normal-tree contract instead of coercing it into a VIP tree', async () => {
    getMock.mockResolvedValue({ ok: true, data: {
      inTree: true,
      node: { level: 3, position: 2, childrenCount: 1, selfPurchaseCount: 5, frozenAt: null },
      breadcrumb: [{ level: 0, isRoot: true }], parent: null,
      children: [{ level: 4, position: 0, childrenCount: 0, hasUser: true }], treeDepth: 3,
    } });
    await expect(BenefitsRepo.getNormalTree()).resolves.toMatchObject({ ok: true, data: { inTree: true, node: { selfPurchaseCount: 5 } } });
  });

  it('passes the opaque queue cursor back unchanged', async () => {
    getMock.mockResolvedValue({ ok: true, data: {
      enabled: true, queueSize: 21, splitUnitAmount: 200, maxPositionsPerOrder: 4,
      distributionMode: 'AVERAGE', wallet: { available: 8, total: 18 }, totalActivePositions: 0,
      positionPage: { pageSize: 20, total: 0, hasMore: false, nextSequence: null },
      activePositions: [], recentOrders: [], recentRewards: [],
    } });
    await BenefitsRepo.getQueueStatus('90071992547409931234', 20);
    expect(getMock).toHaveBeenCalledWith('/bonus/queue/v2/status', { afterSequence: '90071992547409931234', positionPageSize: 20 });
  });

  it('does not expose unpublished lottery configuration returned as extra fields', async () => {
    getMock.mockResolvedValue({ ok: true, data: [{ id: 'prize-1', name: '果园好礼', type: 'DISCOUNT_BUY', probability: 0.2, sortOrder: 1 }] });
    const result = await BenefitsRepo.getLotteryPrizes();
    expect(result).toEqual({ ok: true, data: [{ id: 'prize-1', name: '果园好礼', type: 'DISCOUNT_BUY', sortOrder: 1 }] });
  });

  it('uses a stable-shape fingerprint body for a public draw', async () => {
    const fingerprint = 'mini-fingerprint-12345678901234567890';
    postMock.mockResolvedValue({ ok: true, data: { result: 'NO_PRIZE' } });
    await BenefitsRepo.drawLottery(false, fingerprint);
    expect(postMock).toHaveBeenCalledWith('/lottery/public/draw', { deviceFingerprint: fingerprint });
  });

  it('rejects malformed package responses rather than rendering partial price data', async () => {
    getMock.mockResolvedValue({ ok: true, data: { packages: [{ id: 'bad', price: '399', sortOrder: 1, giftOptions: [] }] } });
    await expect(BenefitsRepo.getVipGiftOptions()).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_CONTRACT' } });
  });
});

describe('benefits navigation and claim boundaries', () => {
  it('maps only known App task targets to miniapp routes', () => {
    expect(safeTaskTarget('/lottery')).toBe('/packages/benefits/lottery/index');
    expect(safeTaskTarget('/me/growth')).toBe('/packages/benefits/growth/index');
    expect(safeTaskTarget('https://outside.example/product')).toBeUndefined();
    expect(safeTaskTarget('/unknown/server/route')).toBeUndefined();
  });

  it('builds an anonymous prize merge item without inventing a real sku', () => {
    expect(buildPrizeMergeItem({ claimToken: 'signed-token', prizeId: 'p-1', prizeName: '奖品', createdAt: '2026-08-02', mergeKey: 'merge-1' })).toEqual({
      localKey: 'pending-prize-p-1', skuId: 'pending-prize-signed-token', quantity: 1, isPrize: true, claimToken: 'signed-token',
    });
    const longItem = buildPrizeMergeItem({ claimToken: 'x'.repeat(180), prizeId: 'p-2', prizeName: '奖品2', createdAt: '2026-08-02', mergeKey: 'merge-2' });
    expect(longItem.skuId.length).toBeLessThanOrEqual(64);
  });

  it('keeps the VIP page request free of client-selected payment identity fields', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../vip-gifts/index.tsx'), 'utf8');
    expect(source).not.toMatch(/paymentChannel|openId/);
    expect(source).toContain('CheckoutRepo.createVip');
    expect(source).toContain('requestMiniProgramPayment');
    expect(source).toContain('/packages/benefits/member-agreement/index');
    expect(source).toContain('saveVipCheckoutDraft');
    expect(source).toContain('readVipCheckoutSession');
    expect(source).toContain('CheckoutRepo.getPendingVip');
    expect(source).toContain("created.error.code === 'PENDING_CHECKOUT_EXISTS'");
    expect(source).toContain('authRevision');
    expect(source).toContain('current.userId === userId');
  });

  it('restores VIP checkout attempts only for the owning account', () => {
    const draft = { userId: 'user-1', idempotencyKey: 'vip-key-001', packageId: 'package-1', giftOptionId: 'gift-1', addressId: 'address-1', expectedTotal: 399, createdAt: '2026-08-02' };
    saveVipCheckoutDraft(draft);
    expect(readVipCheckoutDraft('user-1')).toEqual(draft);
    expect(readVipCheckoutDraft('user-2')).toBeUndefined();
    clearVipCheckoutDraft();
    expect(readVipCheckoutDraft('user-1')).toBeUndefined();

    const session = {
      sessionId: 'session-1', merchantOrderNo: 'VIP-1', expectedTotal: 399,
      goodsAmount: 399, shippingFee: 0, discountAmount: 0, paymentScene: 'MINI_PROGRAM' as const,
      paymentParams: { channel: 'wechat' as const, scene: 'mini_program' as const, appId: 'wx-app', timeStamp: '1', nonceStr: 'nonce', package: 'prepay_id=prepay' as const, signType: 'RSA' as const, paySign: 'sign', prepayId: 'prepay' },
    };
    saveVipCheckoutSession('user-1', session);
    expect(readVipCheckoutSession('user-1')).toEqual(session);
    expect(readVipCheckoutSession('user-2')).toBeUndefined();
    clearVipCheckoutSession();
    expect(readVipCheckoutSession('user-1')).toBeUndefined();
  });
});
