import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

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

  it('keeps an incomplete checkout compact and explains why pickup is unavailable', () => {
    const switchSource = source('src/components/pickup-fulfillment.tsx');
    const checkoutStyles = source('src/packages/commerce/checkout/index.scss');

    expect(switchSource).toContain("当前商品暂无可用自提点");
    expect(switchSource).toContain("pickupLoading ? '正在查询可用自提点'");
    expect(checkoutStyles).toContain('align-content: start');
    expect(checkoutStyles).toContain('grid-auto-rows: max-content');
    for (const page of [
      'src/packages/commerce/checkout/index.tsx',
      'src/packages/group-buy/checkout/index.tsx',
      'src/packages/benefits/vip-gifts/index.tsx',
    ]) {
      expect(source(page)).toContain('pickupLoading={pickupPointsQuery.isLoading}');
    }
  });

  it('queries the pickup QR canvas across Taro component boundaries without CustomWrapper', () => {
    const passSource = source('src/packages/orders/pickup-pass/index.tsx');
    const passStyle = source('src/packages/orders/pickup-pass/index.scss');
    const packageJson = JSON.parse(source('package.json')) as { scripts: Record<string, string> };
    const cleanScript = source('scripts/clean-weapp-dist.mjs');
    const artifactScript = source('scripts/verify-weapp-artifact.mjs');

    expect(passSource).toContain('function drawPickupQr(payload: string): Promise<void>');
    expect(passSource).toContain("setQrState('failed')");
    expect(passSource).toContain('二维码未能显示');
    expect(passSource).toContain('请向商家出示下方 8 位取货码');
    expect(passSource).toContain('重新生成二维码');
    expect(passSource).not.toContain('CustomWrapper');
    expect(passSource).not.toContain('query.in(scope)');
    expect(passSource).toContain("const QR_CANVAS_SELECTOR = `.pickup-pass-page >>> #${QR_CANVAS_ID}`");
    expect(passSource).toContain('query.select(QR_CANVAS_SELECTOR)');
    expect(passSource).toContain("fields({ node: true, size: true }, (fieldResult)");
    expect(passSource).toContain('[pickup-pass] QR canvas draw failed');
    expect(passStyle).toContain('.pickup-pass-qr--hidden');
    expect(passStyle).not.toContain('.pickup-pass-qr-scope');
    expect(packageJson.scripts['build:staging']).toContain('npm run clean:weapp');
    expect(packageJson.scripts['build:production']).toContain('npm run clean:weapp');
    expect(cleanScript).toContain("path.basename(distRoot), 'dist'");
    expect(artifactScript).not.toContain("'custom-wrapper.wxml'");
  });
});
