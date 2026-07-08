jest.mock('../payment/payment.service', () => ({
  PaymentService: class PaymentService {},
}));

import { AfterSaleRefundService } from './after-sale-refund.service';
import { AfterSaleStatusHistoryService } from './after-sale-status-history.service';

describe('AfterSaleRefundService captain void hook', () => {
  const tx: any = {
    refund: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    refundStatusHistory: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    afterSaleRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    afterSaleStatusHistory: {
      create: jest.fn(),
    },
    inventoryLedger: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
    productSKU: {
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
    checkoutSession: {
      findUnique: jest.fn(),
    },
    rewardLedger: {
      findMany: jest.fn(),
    },
    groupBuyRebateLedger: {
      findMany: jest.fn(),
    },
    orderItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund-1',
      orderId: 'order-1',
      afterSaleId: 'as-1',
      amount: 80,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as-1',
      orderId: 'order-1',
      userId: 'buyer-1',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 80,
      requiresReturn: true,
      afterSaleType: 'QUALITY_RETURN',
      order: {
        checkoutSession: { paymentChannel: 'ALIPAY' },
        payments: [],
      },
      orderItem: {
        skuId: 'sku-1',
        quantity: 1,
        companyId: 'company-1',
        isPrize: false,
        productSnapshot: {},
      },
    });
    tx.refund.update.mockResolvedValue({});
    tx.afterSaleRequest.update.mockResolvedValue({});
    tx.inventoryLedger.findMany.mockResolvedValue([]);
    tx.inventoryLedger.createMany.mockResolvedValue({ count: 1 });
    tx.productSKU.update.mockResolvedValue({});
    tx.order.findUnique.mockResolvedValue({ checkoutSessionId: null });
  });

  it('voids captain commission when an after-sale refund succeeds', async () => {
    const service = new AfterSaleRefundService(
      prisma,
      {} as any,
      {
        voidRewardsForOrder: jest.fn().mockResolvedValue(undefined),
        checkAndMarkOrderRefunded: jest.fn().mockResolvedValue(undefined),
      } as any,
      new AfterSaleStatusHistoryService(),
      { send: jest.fn().mockResolvedValue(undefined) } as any,
    );
    const captainCommission = {
      voidForRefund: jest.fn().mockResolvedValue('voided'),
    };
    service.setCaptainCommissionService(captainCommission as any);

    await service.handleRefundSuccess('refund-1', 'provider-1');

    expect(captainCommission.voidForRefund).toHaveBeenCalledWith(
      'order-1',
      'refund-1',
      80,
    );
  });
});
