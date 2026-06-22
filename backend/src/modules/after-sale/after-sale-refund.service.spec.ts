import { BadRequestException } from '@nestjs/common';
import { AfterSaleOperatorType } from '@prisma/client';
import { AfterSaleRefundService } from './after-sale-refund.service';
import { AfterSaleStatusHistoryService } from './after-sale-status-history.service';

describe('AfterSaleRefundService', () => {
  const tx = {
    afterSaleRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refund: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    refundStatusHistory: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    afterSaleStatusHistory: {
      create: jest.fn(),
    },
    inventoryLedger: {
      create: jest.fn(),
      createMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
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
    $executeRaw: jest.fn(),
  };

  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    refund: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const paymentService = {
    initiateRefund: jest.fn(),
    reconcileWechatRefundBeforeRetry: jest.fn(),
  };

  const rewardService = {
    voidRewardsForOrder: jest.fn(),
    checkAndMarkOrderRefunded: jest.fn(),
  };

  const inboxService = {
    send: jest.fn(),
  };

  const productBundleService = {
    buildInventoryMovements: jest.fn(),
  };

  let service: AfterSaleRefundService;

  beforeEach(() => {
    jest.clearAllMocks();
    productBundleService.buildInventoryMovements.mockReset();
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      reason: '质量问题',
    });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
    });
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.afterSaleRequest.update.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundId: 'refund_001',
    });
    tx.refund.update.mockResolvedValue({
      id: 'refund_001',
      status: 'REFUNDED',
    });
    tx.refund.updateMany.mockResolvedValue({ count: 1 });
    tx.refundStatusHistory.findFirst.mockResolvedValue(null);
    tx.inventoryLedger.create.mockResolvedValue({ id: 'inv_ledger_001' });
    tx.inventoryLedger.findFirst.mockResolvedValue(null);
    tx.inventoryLedger.findMany.mockResolvedValue([]);
    tx.inventoryLedger.createMany.mockResolvedValue({ count: 1 });
    tx.productSKU.update.mockResolvedValue({ id: 'sku_001', stock: 12 });
    tx.order.findUnique.mockResolvedValue({ userId: 'user_001' });
    tx.checkoutSession.findUnique.mockResolvedValue(null);
    tx.rewardLedger.findMany.mockResolvedValue([]);
    tx.groupBuyRebateLedger.findMany.mockResolvedValue([]);
    tx.orderItem.findFirst.mockResolvedValue(null);
    tx.orderItem.findMany.mockResolvedValue([]);
    prisma.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      paymentId: null,
      providerRefundId: 'provider_pending_001',
    });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      providerRefundId: 'provider_refund_001',
      message: 'OK',
    });
    paymentService.reconcileWechatRefundBeforeRetry.mockResolvedValue(false);
    rewardService.voidRewardsForOrder.mockResolvedValue(undefined);
    rewardService.checkAndMarkOrderRefunded.mockResolvedValue(undefined);
    inboxService.send.mockResolvedValue(undefined);

    service = new AfterSaleRefundService(
      prisma as any,
      paymentService as any,
      rewardService as any,
      new AfterSaleStatusHistoryService(),
      inboxService as any,
      productBundleService as any,
    );
  });

  it('startRefund/createOrGetRefund uses stable AS-afterSaleId merchantRefundNo and upserts by merchantRefundNo', async () => {
    tx.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'refund_001',
        orderId: 'order_001',
        afterSaleId: 'as_001',
        amount: 88,
        status: 'REFUNDING',
        merchantRefundNo: 'AS-as_001',
        providerRefundId: null,
      });

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(tx.refund.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchantRefundNo: 'AS-as_001' },
      create: expect.objectContaining({
        afterSaleId: 'as_001',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
      }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        refundId: 'refund_001',
      }),
    }));
    expect(paymentService.initiateRefund).toHaveBeenCalledWith(
      'order_001',
      88,
      'AS-as_001',
    );
  });

  it('startRefund keeps pending provider refunds in REFUNDING and only stores providerRefundId', async () => {
    tx.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'refund_001',
        orderId: 'order_001',
        afterSaleId: 'as_001',
        amount: 88,
        status: 'REFUNDING',
        merchantRefundNo: 'AS-as_001',
        providerRefundId: null,
      });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'provider_pending_001',
      message: 'PROCESSING',
    });
    const successSpy = jest.spyOn(service, 'handleRefundSuccess');
    const failureSpy = jest.spyOn(service, 'handleRefundFailure');

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(successSpy).not.toHaveBeenCalled();
    expect(failureSpy).not.toHaveBeenCalled();
    expect(tx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001', status: 'REFUNDING' },
      data: { providerRefundId: 'provider_pending_001' },
    }));
    expect(tx.refund.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(tx.refund.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        refundId: 'refund_001',
      }),
    }));
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('startRefund schedules short reconciliation for pending provider refunds without reissuing refund', async () => {
    jest.useFakeTimers();
    try {
      tx.refund.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          id: 'refund_001',
          orderId: 'order_001',
          afterSaleId: 'as_001',
          amount: 88,
          status: 'REFUNDING',
          merchantRefundNo: 'AS-as_001',
          paymentId: null,
          providerRefundId: null,
        });
      paymentService.initiateRefund.mockResolvedValue({
        success: true,
        pending: true,
        providerRefundId: 'provider_pending_001',
        message: 'PROCESSING',
      });
      paymentService.reconcileWechatRefundBeforeRetry.mockResolvedValue(true);

      await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

      expect(paymentService.reconcileWechatRefundBeforeRetry).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(15_000);

      expect(prisma.refund.findUnique).toHaveBeenCalledWith({
        where: { id: 'refund_001' },
        select: {
          id: true,
          orderId: true,
          amount: true,
          status: true,
          merchantRefundNo: true,
          paymentId: true,
          providerRefundId: true,
        },
      });
      expect(paymentService.reconcileWechatRefundBeforeRetry).toHaveBeenCalledWith({
        id: 'refund_001',
        orderId: 'order_001',
        amount: 88,
        status: 'REFUNDING',
        merchantRefundNo: 'AS-as_001',
        paymentId: null,
        providerRefundId: 'provider_pending_001',
      });
      expect(paymentService.initiateRefund).toHaveBeenCalledTimes(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('startRefund does not call provider again for an existing REFUNDING refund', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
      reason: '质量问题',
    });

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        refundId: 'refund_001',
      }),
    }));
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('handleRefundFailure sets Refund FAILED and keeps AfterSaleRequest out of FAILED', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      status: 'REFUNDING',
    });

    await service.handleRefundFailure('refund_001', '支付宝失败');

    expect(tx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001', status: 'REFUNDING' },
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(tx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'refund_001',
        fromStatus: 'REFUNDING',
        toStatus: 'FAILED',
        remark: '支付宝失败',
      }),
    }));
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('handleRefundFailure does not downgrade a REFUNDED refund', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      status: 'REFUNDED',
    });

    await service.handleRefundFailure('refund_001', '迟到的失败回调');

    expect(tx.refund.update).not.toHaveBeenCalled();
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(tx.refundStatusHistory.create).not.toHaveBeenCalled();
  });

  it('handleRefundSuccess sets REFUNDED statuses and creates AfterSaleStatusHistory once', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.refund.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        providerRefundId: 'provider_refund_001',
      }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        refundId: 'refund_001',
      }),
    }));
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        afterSaleId: 'as_001',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDED',
      }),
    }));
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
    expect(rewardService.checkAndMarkOrderRefunded).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess reverses digital asset cumulative spend after refund closes', async () => {
    const digitalAssetService = {
      reverseRefund: jest.fn().mockResolvedValue(undefined),
    };
    service.setDigitalAssetService(digitalAssetService as any);
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(digitalAssetService.reverseRefund).toHaveBeenCalledWith('refund_001');
  });

  it('handleRefundSuccess does not fail when digital asset reversal fails', async () => {
    const reversalError = new Error('digital asset down');
    const digitalAssetService = {
      reverseRefund: jest.fn().mockRejectedValue(reversalError),
      recordRefundReversalFailure: jest.fn().mockResolvedValue(undefined),
    };
    service.setDigitalAssetService(digitalAssetService as any);
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await expect(service.handleRefundSuccess('refund_001', 'provider_refund_001'))
      .resolves.toBeUndefined();

    expect(digitalAssetService.reverseRefund).toHaveBeenCalledWith('refund_001');
    expect(digitalAssetService.recordRefundReversalFailure).toHaveBeenCalledWith(
      'refund_001',
      reversalError,
      { source: 'AFTER_SALE_REFUND' },
    );
    expect(inboxService.send).toHaveBeenCalled();
  });

  it('handleRefundSuccess restores proportional group-buy rebate deduction after ordinary order refund succeeds', async () => {
    const groupBuyRebateDeductionService = {
      refundDeduction: jest.fn().mockResolvedValue(undefined),
    };
    (service as any).setGroupBuyRebateDeductionService(groupBuyRebateDeductionService);
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: false,
      orderItem: {
        skuId: 'sku_001',
        quantity: 1,
        isPrize: false,
      },
    });
    tx.order.findUnique.mockResolvedValue({ checkoutSessionId: 'cs_001' });
    tx.checkoutSession.findUnique.mockResolvedValue({
      deductionGroupId: null,
      discountAmount: 0,
      groupBuyRebateDeductionGroupId: 'GBD-1',
      groupBuyRebateDeductionAmount: 20,
      goodsAmount: 200,
    });
    tx.orderItem.findFirst.mockResolvedValue({ unitPrice: 100 });
    tx.groupBuyRebateLedger.findMany.mockResolvedValue([]);

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(groupBuyRebateDeductionService.refundDeduction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        refundId: 'refund_001',
        orderId: 'order_001',
        originalGoodsAmount: 200,
        originalGoodsRefundAmount: 100,
        originalDeductAmount: 20,
        deductionGroupId: 'GBD-1',
        isFinalRefund: false,
        cumulativeGoodsRefundAmount: 100,
      }),
    );
  });

  it('handleRefundSuccess 对 bundle 退货按组件幂等回填库存，不回填 bundle 售卖 SKU', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_bundle_001',
      afterSaleId: 'as_bundle_001',
      orderId: 'order_bundle_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_bundle_001',
      orderId: 'order_bundle_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      refundId: 'refund_bundle_001',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: true,
      orderItem: {
        skuId: 'bundle-selling-sku',
        quantity: 2,
        isPrize: false,
        productSnapshot: {
          productType: 'BUNDLE',
          bundleItems: [
            { skuId: 'component-sku-a', quantityPerBundle: 2 },
            { skuId: 'component-sku-b', quantityPerBundle: 1 },
          ],
        },
      },
    });
    productBundleService.buildInventoryMovements.mockReturnValue([
      { skuId: 'component-sku-a', quantity: 4, companyId: 'company-1', label: 'A' },
      { skuId: 'component-sku-b', quantity: 2, companyId: 'company-1', label: 'B' },
    ]);
    tx.inventoryLedger.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    await service.handleRefundSuccess('refund_bundle_001', 'provider_refund_bundle_001');

    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_bundle_001' },
      include: expect.objectContaining({
        orderItem: {
          select: {
            skuId: true,
            quantity: true,
            companyId: true,
            isPrize: true,
            productSnapshot: true,
          },
        },
      }),
    }));
    expect(productBundleService.buildInventoryMovements).toHaveBeenCalledWith({
      skuId: 'bundle-selling-sku',
      quantity: 2,
      companyId: '',
      productSnapshot: {
        productType: 'BUNDLE',
        bundleItems: [
          { skuId: 'component-sku-a', quantityPerBundle: 2 },
          { skuId: 'component-sku-b', quantityPerBundle: 1 },
        ],
      },
    });
    expect(tx.inventoryLedger.findMany).toHaveBeenCalledWith({
      where: {
        skuId: { in: ['component-sku-a', 'component-sku-b'] },
        type: 'RELEASE',
        refType: 'AFTER_SALE',
        refId: 'as_bundle_001',
      },
      select: { skuId: true },
    });
    expect(tx.inventoryLedger.createMany).toHaveBeenNthCalledWith(1, {
      data: [{
        skuId: 'component-sku-a',
        type: 'RELEASE',
        qty: 4,
        refType: 'AFTER_SALE',
        refId: 'as_bundle_001',
      }],
      skipDuplicates: true,
    });
    expect(tx.inventoryLedger.createMany).toHaveBeenNthCalledWith(2, {
      data: [{
        skuId: 'component-sku-b',
        type: 'RELEASE',
        qty: 2,
        refType: 'AFTER_SALE',
        refId: 'as_bundle_001',
      }],
      skipDuplicates: true,
    });
    expect(tx.productSKU.update).toHaveBeenCalledTimes(2);
    expect(tx.productSKU.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'component-sku-a' },
      data: { stock: { increment: 4 } },
    });
    expect(tx.productSKU.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'component-sku-b' },
      data: { stock: { increment: 2 } },
    });
    expect(tx.productSKU.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bundle-selling-sku' },
    }));
  });

  it('handleRefundSuccess 对 bundle 退货仅回填缺失的组件 ledger', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_bundle_partial_001',
      afterSaleId: 'as_bundle_partial_001',
      orderId: 'order_bundle_partial_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_bundle_partial_001',
      orderId: 'order_bundle_partial_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      refundId: 'refund_bundle_partial_001',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: true,
      orderItem: {
        skuId: 'bundle-selling-sku',
        quantity: 2,
        isPrize: false,
        productSnapshot: {
          productType: 'BUNDLE',
          bundleItems: [
            { skuId: 'component-sku-a', quantityPerBundle: 2 },
            { skuId: 'component-sku-b', quantityPerBundle: 1 },
          ],
        },
      },
    });
    productBundleService.buildInventoryMovements.mockReturnValue([
      { skuId: 'component-sku-a', quantity: 4, companyId: 'company-1', label: 'A' },
      { skuId: 'component-sku-b', quantity: 2, companyId: 'company-1', label: 'B' },
    ]);
    tx.inventoryLedger.findMany.mockResolvedValue([{ skuId: 'component-sku-a' }]);
    tx.inventoryLedger.createMany.mockResolvedValue({ count: 1 });

    await service.handleRefundSuccess(
      'refund_bundle_partial_001',
      'provider_refund_bundle_partial_001',
    );

    expect(tx.inventoryLedger.findMany).toHaveBeenCalledWith({
      where: {
        skuId: { in: ['component-sku-a', 'component-sku-b'] },
        type: 'RELEASE',
        refType: 'AFTER_SALE',
        refId: 'as_bundle_partial_001',
      },
      select: { skuId: true },
    });
    expect(tx.inventoryLedger.createMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryLedger.createMany).toHaveBeenCalledWith({
      data: [{
        skuId: 'component-sku-b',
        type: 'RELEASE',
        qty: 2,
        refType: 'AFTER_SALE',
        refId: 'as_bundle_partial_001',
      }],
      skipDuplicates: true,
    });
    expect(tx.productSKU.update).toHaveBeenCalledTimes(1);
    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'component-sku-b' },
      data: { stock: { increment: 2 } },
    });
    expect(tx.productSKU.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'component-sku-a' },
    }));
  });

  it('handleRefundSuccess restocks returned normal items exactly once when returned-goods refund succeeds', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      refundId: 'refund_001',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: true,
      orderItem: {
        skuId: 'sku_001',
        quantity: 3,
        isPrize: false,
      },
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      include: expect.objectContaining({
        orderItem: {
          select: {
            skuId: true,
            quantity: true,
            companyId: true,
            isPrize: true,
            productSnapshot: true,
          },
        },
      }),
    }));
    expect(tx.inventoryLedger.create).not.toHaveBeenCalled();
    expect(tx.inventoryLedger.findMany).toHaveBeenCalledWith({
      where: {
        skuId: { in: ['sku_001'] },
        type: 'RELEASE',
        refType: 'AFTER_SALE',
        refId: 'as_001',
      },
      select: { skuId: true },
    });
    expect(tx.inventoryLedger.createMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryLedger.createMany).toHaveBeenCalledWith({
      data: [{
        skuId: 'sku_001',
        type: 'RELEASE',
        qty: 3,
        refType: 'AFTER_SALE',
        refId: 'as_001',
      }],
      skipDuplicates: true,
    });
    expect(tx.productSKU.update).toHaveBeenCalledTimes(1);
    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'sku_001' },
      data: { stock: { increment: 3 } },
    });
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
    expect(rewardService.checkAndMarkOrderRefunded).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess retries P2034 once and restocks returned goods once after success', async () => {
    prisma.$transaction
      .mockImplementationOnce(async () => {
        throw { code: 'P2034' };
      })
      .mockImplementationOnce((cb: any) => cb(tx));
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      refundId: 'refund_001',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: true,
      orderItem: {
        skuId: 'sku_001',
        quantity: 3,
        isPrize: false,
      },
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.refund.update).toHaveBeenCalledTimes(1);
    expect(tx.refundStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.afterSaleRequest.update).toHaveBeenCalledTimes(1);
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.inventoryLedger.createMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryLedger.createMany).toHaveBeenCalledWith({
      data: [{
        skuId: 'sku_001',
        type: 'RELEASE',
        qty: 3,
        refType: 'AFTER_SALE',
        refId: 'as_001',
      }],
      skipDuplicates: true,
    });
    expect(tx.productSKU.update).toHaveBeenCalledTimes(1);
    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'sku_001' },
      data: { stock: { increment: 3 } },
    });
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledTimes(1);
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
    expect(rewardService.checkAndMarkOrderRefunded).toHaveBeenCalledTimes(1);
    expect(rewardService.checkAndMarkOrderRefunded).toHaveBeenCalledWith('order_001');
    expect(inboxService.send).toHaveBeenCalledTimes(1);
  });

  it('does not double-restock bundle components on duplicate refund notifications', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_bundle_002',
      afterSaleId: 'as_bundle_002',
      orderId: 'order_bundle_002',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_bundle_002',
      orderId: 'order_bundle_002',
      userId: 'user_001',
      status: 'REFUNDED',
      refundAmount: 88,
      refundId: 'refund_bundle_002',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: true,
      orderItem: {
        skuId: 'bundle-selling-sku',
        quantity: 2,
        isPrize: false,
        productSnapshot: {
          productType: 'BUNDLE',
          bundleItems: [
            { skuId: 'component-sku-a', quantityPerBundle: 2 },
            { skuId: 'component-sku-b', quantityPerBundle: 1 },
          ],
        },
      },
    });

    await service.handleRefundSuccess('refund_bundle_002', 'provider_refund_bundle_002');

    expect(productBundleService.buildInventoryMovements).not.toHaveBeenCalled();
    expect(tx.inventoryLedger.create).not.toHaveBeenCalled();
    expect(tx.inventoryLedger.findMany).not.toHaveBeenCalled();
    expect(tx.inventoryLedger.createMany).not.toHaveBeenCalled();
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(rewardService.voidRewardsForOrder).not.toHaveBeenCalled();
  });

  it('handleRefundSuccess does not restock exchange types', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      refundId: 'refund_001',
      afterSaleType: 'NO_REASON_EXCHANGE',
      requiresReturn: true,
      orderItem: {
        skuId: 'sku_001',
        quantity: 2,
        isPrize: false,
      },
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        orderItem: {
          select: {
            skuId: true,
            quantity: true,
            companyId: true,
            isPrize: true,
            productSnapshot: true,
          },
        },
      }),
    }));
    expect(tx.inventoryLedger.create).not.toHaveBeenCalled();
    expect(tx.inventoryLedger.createMany).not.toHaveBeenCalled();
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess does not restock refund-only return types without returned goods', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      refundId: 'refund_001',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: false,
      orderItem: {
        skuId: 'sku_001',
        quantity: 2,
        isPrize: false,
      },
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        orderItem: {
          select: {
            skuId: true,
            quantity: true,
            companyId: true,
            isPrize: true,
            productSnapshot: true,
          },
        },
      }),
    }));
    expect(tx.inventoryLedger.create).not.toHaveBeenCalled();
    expect(tx.inventoryLedger.createMany).not.toHaveBeenCalled();
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess does not restock prize items', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      refundId: 'refund_001',
      afterSaleType: 'QUALITY_RETURN',
      requiresReturn: true,
      orderItem: {
        skuId: 'sku_001',
        quantity: 2,
        isPrize: true,
      },
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        orderItem: {
          select: {
            skuId: true,
            quantity: true,
            companyId: true,
            isPrize: true,
            productSnapshot: true,
          },
        },
      }),
    }));
    expect(tx.inventoryLedger.create).not.toHaveBeenCalled();
    expect(tx.inventoryLedger.createMany).not.toHaveBeenCalled();
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess closes after-sale when refund is already REFUNDED but request is still REFUNDING', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDED',
      providerRefundId: 'provider_existing',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.refund.update).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        refundId: 'refund_001',
      }),
    }));
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
    expect(rewardService.checkAndMarkOrderRefunded).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess does nothing when refund and after-sale are already REFUNDED', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDED',
      providerRefundId: 'provider_existing',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDED',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.refund.update).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
    expect(tx.afterSaleStatusHistory.create).not.toHaveBeenCalled();
    expect(rewardService.voidRewardsForOrder).not.toHaveBeenCalled();
  });

  it('startRefund routes existing REFUNDED refund through success closure', async () => {
    tx.refund.findUnique
      .mockResolvedValueOnce({
        id: 'refund_001',
        afterSaleId: 'as_001',
        orderId: 'order_001',
        amount: 88,
        status: 'REFUNDED',
        merchantRefundNo: 'AS-as_001',
        providerRefundId: 'provider_existing',
      })
      .mockResolvedValueOnce({
        id: 'refund_001',
        afterSaleId: 'as_001',
        orderId: 'order_001',
        amount: 88,
        status: 'REFUNDED',
        merchantRefundNo: 'AS-as_001',
        providerRefundId: 'provider_existing',
      });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDED',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: 'provider_existing',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
      reason: '质量问题',
    });

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        afterSaleId: 'as_001',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDED',
      }),
    }));
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
  });

  it('retryRefund uses refund-retry advisory lock and 30-second throttle through RefundStatusHistory', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
    });

    await service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.ADMIN,
      id: 'admin_001',
    });

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.refundStatusHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        refundId: 'refund_001',
        toStatus: 'REFUNDING',
        remark: { contains: '重试开始' },
        createdAt: { gte: expect.any(Date) },
      }),
    }));
    expect(tx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'refund_001',
        fromStatus: 'FAILED',
        toStatus: 'REFUNDING',
        remark: '管理员手动重试开始',
        operatorId: 'admin_001',
      }),
    }));
    expect(paymentService.initiateRefund).toHaveBeenCalledWith(
      'order_001',
      88,
      'AS-as_001',
    );
  });

  it('retryRefund keeps pending provider refunds in REFUNDING and only stores providerRefundId', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
      providerRefundId: null,
    });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'provider_pending_retry_001',
      message: 'PROCESSING',
    });
    const successSpy = jest.spyOn(service, 'handleRefundSuccess');
    const failureSpy = jest.spyOn(service, 'handleRefundFailure');

    await service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.ADMIN,
      id: 'admin_001',
    });

    expect(successSpy).not.toHaveBeenCalled();
    expect(failureSpy).not.toHaveBeenCalled();
    expect(tx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001', status: 'FAILED' },
      data: { status: 'REFUNDING' },
    }));
    expect(tx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001', status: 'REFUNDING' },
      data: { providerRefundId: 'provider_pending_retry_001' },
    }));
    expect(tx.refund.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(tx.refund.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('retryRefund asks payment service to reconcile REFUNDING WeChat refund before reissuing', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
      paymentId: 'payment_001',
      providerRefundId: 'wx-refund-001',
    });
    paymentService.reconcileWechatRefundBeforeRetry.mockResolvedValue(true);

    await service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.SYSTEM,
    });

    expect(paymentService.reconcileWechatRefundBeforeRetry).toHaveBeenCalledWith(expect.objectContaining({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      merchantRefundNo: 'AS-as_001',
      paymentId: 'payment_001',
    }));
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('retryRefund never reissues a REFUNDING refund when reconciliation does not handle it', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
      paymentId: 'payment_001',
      providerRefundId: 'provider_pending_001',
    });
    paymentService.reconcileWechatRefundBeforeRetry.mockResolvedValue(false);

    await expect(service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.SYSTEM,
    })).resolves.toEqual(expect.objectContaining({
      id: 'refund_001',
      status: 'REFUNDING',
    }));

    expect(paymentService.reconcileWechatRefundBeforeRetry).toHaveBeenCalledWith(expect.objectContaining({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      merchantRefundNo: 'AS-as_001',
      paymentId: 'payment_001',
    }));
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('retryRefund rejects recent manual retry within 30 seconds', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
    });
    tx.refundStatusHistory.findFirst.mockResolvedValue({ id: 'hist_recent' });

    await expect(service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.ADMIN,
      id: 'admin_001',
    })).rejects.toThrow(BadRequestException);

    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('retryRefund is blocked by a recent auto retry marker', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
    });
    tx.refundStatusHistory.findFirst.mockResolvedValue({
      id: 'hist_auto_recent',
      remark: '自动退款补偿重试开始',
    });

    await expect(service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.ADMIN,
      id: 'admin_001',
    })).rejects.toThrow(BadRequestException);

    expect(tx.refundStatusHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        refundId: 'refund_001',
        toStatus: 'REFUNDING',
        remark: { contains: '重试开始' },
      }),
    }));
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('startRefund does not call provider for existing FAILED refund with recent retry marker', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.refundStatusHistory.findFirst.mockResolvedValue({
      id: 'hist_recent',
      remark: '自动退款补偿重试开始',
    });

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(tx.refundStatusHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        refundId: 'refund_001',
        toStatus: 'REFUNDING',
        remark: { contains: '重试开始' },
      }),
    }));
    expect(tx.refund.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001', status: 'FAILED' },
    }));
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('startRefund writes shared retry marker and calls provider once for existing FAILED refund without recent marker', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.refundStatusHistory.findFirst.mockResolvedValue(null);

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(tx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001', status: 'FAILED' },
      data: { status: 'REFUNDING' },
    }));
    expect(tx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'refund_001',
        fromStatus: 'FAILED',
        toStatus: 'REFUNDING',
        remark: expect.stringContaining('重试开始'),
      }),
    }));
    expect(paymentService.initiateRefund).toHaveBeenCalledTimes(1);
    expect(paymentService.initiateRefund).toHaveBeenCalledWith(
      'order_001',
      88,
      'AS-as_001',
    );
  });
});
