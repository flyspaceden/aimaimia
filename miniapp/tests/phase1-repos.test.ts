import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AddressRepo,
  CartRepo,
  CheckoutRepo,
  CompanyRepo,
  CouponRepo,
  LogisticsRepo,
  OrderRepo,
  ProductRepo,
  UserRepo,
} from '@/repos';
import { isMiniProgramPaymentParams } from '@/types';
import type { MiniProgramCheckoutInput, UpdateUserProfileInput } from '@/types';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const uploadFileMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  ApiClient: {
    get: getMock,
    post: postMock,
    put: putMock,
    delete: deleteMock,
    uploadFile: uploadFileMock,
  },
}));

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

const miniSession = {
  sessionId: 'session-1',
  merchantOrderNo: 'CS-1',
  expectedTotal: 88,
  goodsAmount: 88,
  shippingFee: 0,
  discountAmount: 0,
  paymentScene: 'MINI_PROGRAM',
  paymentParams: miniPaymentParams,
} as const;

describe('Phase 1 typed repo contracts', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();
  });

  it('accepts only a platform avatar upload-shaped image response', async () => {
    uploadFileMock.mockResolvedValueOnce({
      ok: true,
      data: {
        url: 'https://assets.ai-maimai.com/avatars/550e8400-e29b-41d4-a716-446655440000.webp',
        key: 'avatars/550e8400-e29b-41d4-a716-446655440000.webp',
        size: 2048,
        mimeType: 'image/webp',
      },
    });
    await expect(UserRepo.uploadAvatar('wxfile://avatar')).resolves.toMatchObject({
      ok: true,
      data: { key: 'avatars/550e8400-e29b-41d4-a716-446655440000.webp' },
    });

    uploadFileMock.mockResolvedValueOnce({
      ok: true,
      data: {
        url: 'https://tracker.example/pixel',
        key: 'general/pixel.html',
        size: 1,
        mimeType: 'text/html',
      },
    });
    await expect(UserRepo.uploadAvatar('wxfile://avatar')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_AVATAR_UPLOAD_RESPONSE' },
    });
  });

  it('keeps payment selection and response-only profile fields out of request types', () => {
    // @ts-expect-error expectedTotal 是小程序结算必须的价格漂移 guard。
    const missingExpectedTotal: MiniProgramCheckoutInput = {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
    };
    const forbiddenPaymentSelection: MiniProgramCheckoutInput = {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      expectedTotal: 88,
      // @ts-expect-error 小程序通道和 OpenID 必须由服务端根据当前 Session 决定。
      paymentChannel: 'wechat',
    };
    const responseOnlyFrame: UpdateUserProfileInput = {
      // @ts-expect-error PUT /me 只允许 avatarFrameId。
      avatarFrame: { id: 'frame-vip', type: 'vip', label: 'VIP' },
    };
    const invalidBirthday: UpdateUserProfileInput = {
      // @ts-expect-error UpdateProfileDto 不接收 null 生日。
      birthday: null,
    };

    expect(missingExpectedTotal).toBeDefined();
    expect(forbiddenPaymentSelection).toBeDefined();
    expect(responseOnlyFrame).toBeDefined();
    expect(invalidBirthday).toBeDefined();
  });

  it('serializes product filters and derives nextPage from the server page', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: { items: [], total: 21, page: 2, pageSize: 8 },
    });

    await expect(ProductRepo.list({
      page: 2,
      constraints: ['organic', 'fresh'],
      recommendThemes: ['hot', 'seasonal'],
      preferRecommended: true,
    })).resolves.toMatchObject({ ok: true, data: { nextPage: 3 } });

    expect(getMock).toHaveBeenCalledWith('/products', expect.objectContaining({
      page: 2,
      pageSize: 8,
      constraints: 'organic,fresh',
      recommendThemes: 'hot,seasonal',
      preferRecommended: 1,
    }));
  });

  it('rejects malformed pagination instead of passing unknown data to pages', async () => {
    getMock.mockResolvedValue({ ok: true, data: { items: [], page: 1, pageSize: 8 } });
    await expect(ProductRepo.list()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTRACT' },
    });
  });

  it('uses the live company array endpoint without inventing keyword pagination', async () => {
    getMock.mockResolvedValue({ ok: true, data: [] });
    await CompanyRepo.list('tag-1');
    expect(getMock).toHaveBeenCalledWith('/companies', { tagId: 'tag-1' });

    await CompanyRepo.listProducts('company-1', { page: 2, pageSize: 10, category: '水果' });
    expect(getMock).toHaveBeenLastCalledWith('/companies/company-1/products', {
      page: 2,
      pageSize: 10,
      category: '水果',
    });
  });

  it('sends preview totals only as server-side consistency guards', async () => {
    postMock.mockResolvedValue({ ok: true, data: miniSession });
    const input = {
      items: [{ skuId: 'sku-1', quantity: 2 }],
      addressId: 'address-1',
      expectedTotal: 88,
      couponInstanceIds: ['coupon-1'],
      deductionAmount: 10,
      idempotencyKey: 'checkout-1',
    };

    const untrustedInput = {
      ...input,
      paymentChannel: 'other',
      openId: 'client-must-not-select-openid',
      finalAmount: 1,
    };
    await expect(CheckoutRepo.create(untrustedInput)).resolves.toEqual({
      ok: true,
      data: miniSession,
    });
    expect(postMock).toHaveBeenCalledWith('/orders/checkout/mini-program', {
      ...input,
      fulfillment: { mode: 'DELIVERY', addressId: 'address-1' },
    });
    const sent = postMock.mock.calls[0][1];
    expect(sent).not.toHaveProperty('paymentChannel');
    expect(sent).not.toHaveProperty('openId');
    expect(sent).not.toHaveProperty('finalAmount');
    expect(sent).toHaveProperty('expectedTotal', 88);

    const vipInput = {
      packageId: 'vip-package-1',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      expectedTotal: 399,
      idempotencyKey: 'vip-checkout-1',
    };
    const untrustedVipInput = {
      ...vipInput,
      paymentChannel: 'other',
      openId: 'client-must-not-select-openid',
      finalAmount: 1,
    };
    await CheckoutRepo.createVip(untrustedVipInput);
    expect(postMock).toHaveBeenLastCalledWith('/orders/vip-checkout/mini-program', {
      ...vipInput,
      fulfillment: { mode: 'DELIVERY', addressId: 'address-1' },
    });
  });

  it('fails closed when checkout returns non-mini payment parameters', async () => {
    postMock.mockResolvedValue({
      ok: true,
      data: {
        ...miniSession,
        paymentParams: { channel: 'other', orderStr: 'forbidden' },
      },
    });

    await expect(CheckoutRepo.create({
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      expectedTotal: 88,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTRACT' },
    });
  });

  it('uses only mini-program pending and resume endpoints', async () => {
    getMock.mockResolvedValue({ ok: true, data: null });
    await CheckoutRepo.getPending();
    expect(getMock).toHaveBeenCalledWith('/orders/checkout/me/pending/mini-program');

    getMock.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'vip-session-1',
        merchantOrderNo: 'VIP-MINI-1',
        expectedTotal: 399,
        expiresAt: '2026-08-02T12:30:00.000Z',
        bizType: 'VIP_PACKAGE',
        paymentScene: 'MINI_PROGRAM',
      },
    });
    await expect(CheckoutRepo.getPendingVip()).resolves.toMatchObject({
      ok: true,
      data: { sessionId: 'vip-session-1', paymentScene: 'MINI_PROGRAM' },
    });
    expect(getMock).toHaveBeenCalledWith('/orders/vip-checkout/me/pending/mini-program');

    postMock.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'session-1',
        merchantOrderNo: 'CS-1',
        expectedTotal: 88,
        paymentScene: 'MINI_PROGRAM',
        paymentParams: miniPaymentParams,
      },
    });
    await expect(CheckoutRepo.resume('session-1')).resolves.toMatchObject({ ok: true });
    expect(postMock).toHaveBeenCalledWith('/orders/checkout/session-1/resume/mini-program');
  });

  it('rejects a non-mini-program VIP pending response', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: {
        sessionId: 'vip-session-app',
        merchantOrderNo: 'VIP-APP-1',
        expectedTotal: 399,
        expiresAt: '2026-08-02T12:30:00.000Z',
        bizType: 'VIP_PACKAGE',
        paymentScene: 'APP',
      },
    });

    await expect(CheckoutRepo.getPendingVip()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTRACT' },
    });
  });

  it('marks coupon order amount as preview-only at the public boundary', async () => {
    postMock.mockResolvedValue({ ok: true, data: [] });
    await CouponRepo.getCheckoutEligible({
      previewOrderAmount: 100,
      categoryIds: ['category-1'],
      companyIds: ['company-1'],
    });
    expect(postMock).toHaveBeenCalledWith('/coupons/checkout-eligible', {
      orderAmount: 100,
      categoryIds: ['category-1'],
      companyIds: ['company-1'],
    });
  });

  it('maps historical non-WeChat order channels to other without exposing a pay path', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: {
        items: [{
          id: 'order-1',
          status: 'RECEIVED',
          totalPrice: 88,
          createdAt: '2026-08-02 10:00',
          paymentMethod: 'legacy-channel',
          items: [],
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    });
    await expect(OrderRepo.list()).resolves.toMatchObject({
      ok: true,
      data: { items: [{ paymentMethod: 'other' }] },
    });
    expect(getMock).toHaveBeenCalledWith('/orders', {
      status: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it('accepts legacy pending orders as read-only data and rejects unknown statuses', async () => {
    getMock.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [{
          id: 'legacy-order-1',
          status: 'PENDING_PAYMENT',
          totalPrice: 88,
          createdAt: '2026-08-02 10:00',
          items: [],
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    });
    await expect(OrderRepo.list()).resolves.toMatchObject({
      ok: true,
      data: { items: [{ status: 'PENDING_PAYMENT' }] },
    });
    expect(OrderRepo).not.toHaveProperty('payOrder');
    expect(OrderRepo).not.toHaveProperty('resumePendingOrder');

    getMock.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [{
          id: 'broken-order-1',
          status: 'UNKNOWN_STATUS',
          totalPrice: 88,
          createdAt: '2026-08-02 10:00',
          items: [],
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    });
    await expect(OrderRepo.list()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTRACT' },
    });
  });

  it('merges the anonymous cart with one reusable idempotency key', async () => {
    postMock.mockResolvedValue({ ok: true, data: { id: 'cart-1', items: [] } });
    const items = [{ localKey: 'local-1', skuId: 'sku-1', quantity: 2 }];
    const generatedKey = CartRepo.createMergeIdempotencyKey(items);
    expect(generatedKey).toMatch(/^mini-cart-merge:[A-Za-z0-9:]+$/);

    await CartRepo.mergeItems(items, 'cart-merge-login-1');
    expect(postMock).toHaveBeenCalledWith(
      '/cart/merge',
      { items },
      { idempotencyKey: 'cart-merge-login-1' },
    );

    await expect(CartRepo.mergeItems(items, 'invalid key with spaces')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_IDEMPOTENCY_KEY' },
    });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('keeps cart, address, user, order action and logistics paths exact', async () => {
    getMock.mockResolvedValue({ ok: true, data: null });
    postMock.mockResolvedValue({ ok: true, data: {} });
    putMock.mockResolvedValue({ ok: true, data: {} });
    deleteMock.mockResolvedValue({ ok: true, data: undefined });

    await UserRepo.profile();
    const untrustedProfileInput = {
      avatarFrameId: 'vip',
      avatarFrame: { id: 'frame-vip', type: 'vip', label: 'VIP' },
    };
    await UserRepo.updateProfile(untrustedProfileInput);
    await CartRepo.toggleSelected('sku-1', true);
    await AddressRepo.setDefault('address-1');
    await OrderRepo.confirmReceive('order-1');
    await OrderRepo.repurchase('order-1');
    await LogisticsRepo.refreshTracking('order-1');

    expect(getMock).toHaveBeenCalledWith('/me');
    expect(putMock).toHaveBeenCalledWith('/me', { avatarFrameId: 'vip' });
    expect(putMock).toHaveBeenCalledWith('/cart/items/sku-1/select', { isSelected: true });
    expect(putMock).toHaveBeenCalledWith('/addresses/address-1/default');
    expect(postMock).toHaveBeenCalledWith('/orders/order-1/receive');
    expect(postMock).toHaveBeenCalledWith('/orders/order-1/repurchase');
    expect(getMock).toHaveBeenCalledWith('/shipments/order-1/track');
  });
});

describe('Phase 1 runtime payment guard', () => {
  it('only accepts requestPayment-compatible mini-program parameters', () => {
    expect(isMiniProgramPaymentParams(miniPaymentParams)).toBe(true);
    expect(isMiniProgramPaymentParams({ ...miniPaymentParams, scene: 'app' })).toBe(false);
    expect(isMiniProgramPaymentParams({ ...miniPaymentParams, package: 'wx-prepay' })).toBe(false);
    expect(isMiniProgramPaymentParams({ ...miniPaymentParams, paySign: '' })).toBe(false);
  });
});
