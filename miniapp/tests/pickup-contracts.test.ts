import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckoutRepo, OrderRepo } from '@/repos';
import { MiniGroupBuyRepo } from '@/packages/group-buy/repo';
import {
  canCancelPaidOrder,
  canConfirmOrder,
  canOpenPickupPass,
  orderStatusMeta,
  paymentSuccessPresentation,
} from '@/packages/orders/_components/order-utils';
import type { Order } from '@/types';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  ApiClient: {
    get: getMock,
    post: postMock,
  },
}));

const pickup = {
  mode: 'PICKUP' as const,
  recipientName: '张三',
  recipientPhone: '13800000000',
  selections: [{ companyId: 'company-1', pickupPointId: 'point-1' }],
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

const session = {
  sessionId: 'session-1',
  merchantOrderNo: 'CS-1',
  expectedTotal: 88,
  goodsAmount: 88,
  shippingFee: 0,
  discountAmount: 0,
  paymentScene: 'MINI_PROGRAM',
  paymentParams: miniPaymentParams,
} as const;

describe('pickup API contracts', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('discovers merchant pickup points through the order endpoint', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: {
        items: [{
          companyId: 'company-1',
          companyName: '果园甲',
          points: [{
            id: 'point-1',
            companyId: 'company-1',
            name: '果园甲自提点',
            contactName: '王师傅',
            contactPhoneMasked: '138****0000',
            regionText: '浙江省杭州市',
            detail: '丰收路 8 号',
            businessHours: '09:00-18:00',
          }],
        }],
      },
    });

    await expect(CheckoutRepo.listPickupPoints(['company-1', 'company-1']))
      .resolves.toMatchObject({ ok: true, data: [{ companyId: 'company-1' }] });
    expect(getMock).toHaveBeenCalledWith('/orders/pickup-points', { companyIds: 'company-1' });
  });

  it('creates a normal pickup checkout without leaking an address requirement', async () => {
    postMock.mockResolvedValue({ ok: true, data: session });

    await CheckoutRepo.create({
      items: [{ skuId: 'sku-1', quantity: 1 }],
      fulfillment: pickup,
      expectedTotal: 88,
    });

    expect(postMock).toHaveBeenCalledWith('/orders/checkout/mini-program', {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      fulfillment: pickup,
      expectedTotal: 88,
    });
    expect(postMock.mock.calls[0][1]).not.toHaveProperty('addressId');
  });

  it('passes pickup fulfillment through group-buy preview and payment', async () => {
    postMock
      .mockResolvedValueOnce({ ok: true, data: { totalPayable: 88, shippingFee: 0 } })
      .mockResolvedValueOnce({ ok: true, data: session });
    const input = { activityId: 'activity-1', fulfillment: pickup, expectedTotal: 88 };

    await MiniGroupBuyRepo.previewCheckout(input);
    await MiniGroupBuyRepo.createMiniProgramCheckout(input);

    expect(postMock).toHaveBeenNthCalledWith(1, '/group-buy/checkout/preview', input);
    expect(postMock).toHaveBeenNthCalledWith(2, '/group-buy/checkout/mini-program', input);
  });

  it('loads the one-time pickup pass only from the order-scoped endpoint', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: {
        orderId: 'order-1',
        status: 'READY',
        pickupCode: 'A8K2Q9',
        qrPayload: 'aimai-pickup:v1:opaque-token',
        expiresAt: '2026-08-15T12:00:00.000Z',
        pickupPoint: {
          name: '果园甲自提点',
          regionText: '浙江省杭州市',
          detail: '丰收路 8 号',
          businessHours: '09:00-18:00',
        },
        recipient: { name: '张三', phoneMasked: '138****0000' },
      },
    });

    await expect(OrderRepo.getPickupPass('order-1')).resolves.toMatchObject({
      ok: true,
      data: { pickupCode: 'A8K2Q9' },
    });
    expect(getMock).toHaveBeenCalledWith('/orders/order-1/pickup-pass');
  });

  it('maps pickup state and hides delivery-only order actions', () => {
    const order: Order = {
      id: 'order-1',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      fulfillmentMode: 'PICKUP',
      pickupFulfillment: {
        status: 'READY',
        pickupPoint: {
          name: '果园甲自提点',
          regionText: '浙江省杭州市',
          detail: '丰收路 8 号',
          businessHours: '09:00-18:00',
        },
        recipient: { name: '张三', phoneMasked: '138****0000' },
      },
      totalPrice: 88,
      createdAt: '2026-08-14T12:00:00.000Z',
      items: [],
    };

    expect(orderStatusMeta(order).label).toBe('待自提');
    expect(canOpenPickupPass(order)).toBe(true);
    expect(canCancelPaidOrder(order)).toBe(false);
    expect(canConfirmOrder({ ...order, status: 'DELIVERED' })).toBe(false);
    expect(paymentSuccessPresentation([order]).copy).toContain('一次性取货凭证');

    expect(canCancelPaidOrder({
      ...order,
      pickupFulfillment: { ...order.pickupFulfillment!, status: 'PREPARING' },
    })).toBe(true);
  });
});
