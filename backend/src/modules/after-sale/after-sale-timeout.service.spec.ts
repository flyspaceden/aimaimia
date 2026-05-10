import { Prisma } from '@prisma/client';
import { AfterSaleTimeoutService } from './after-sale-timeout.service';

const AFTER_SALE_ID = 'as_timeout_001';
const ORDER_ID = 'order_timeout_001';
const NOW = new Date('2026-05-09T12:00:00.000Z');

function createMocks() {
  const tx = {
    afterSaleRequest: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    ruleConfig: {
      findUnique: jest.fn().mockResolvedValue({ value: 7 }),
    },
    afterSaleRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const paymentService = {};
  const afterSaleRewardService = {
    voidRewardsForOrder: jest.fn(),
  };
  const inboxService = {};
  const afterSaleRefundService = {
    startRefund: jest.fn(),
  };
  const statusHistory = {
    create: jest.fn(),
  };
  const returnShippingService = {
    cancelIfNotPickedUp: jest.fn(),
  };
  const shippingPaymentService = {
    refundShippingPayment: jest.fn(),
  };
  const service = new AfterSaleTimeoutService(
    prisma as any,
    paymentService as any,
    afterSaleRewardService as any,
    inboxService as any,
    afterSaleRefundService as any,
    statusHistory as any,
    returnShippingService as any,
    shippingPaymentService as any,
  );

  tx.afterSaleRequest.updateMany.mockResolvedValue({ count: 1 });

  return {
    service,
    prisma,
    tx,
    statusHistory,
    returnShippingService,
    shippingPaymentService,
  };
}

describe('AfterSaleTimeoutService buyer ship timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('closes APPROVED no-waybill unpaid requests to CLOSED and writes status history', async () => {
    const { service, prisma, tx, statusHistory } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { id: AFTER_SALE_ID, orderId: ORDER_ID },
    ]);
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'APPROVED',
      returnWaybillNo: null,
      returnShippingPayer: 'BUYER',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({ status: 'APPROVED' });

    await (service as any).handleBuyerShipTimeout();

    expect(prisma.afterSaleRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          {
            status: 'APPROVED',
            requiresReturn: true,
            approvedAt: { lt: expect.any(Date) },
          },
          {
            status: 'RETURN_SHIPPING',
            requiresReturn: true,
            returnWaybillNo: { not: null },
            returnShippedAt: { lt: expect.any(Date) },
          },
        ],
      },
    }));
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: AFTER_SALE_ID, status: 'APPROVED' },
      data: { status: 'CLOSED' },
    });
    expect(statusHistory.create).toHaveBeenCalledWith(tx, {
      afterSaleId: AFTER_SALE_ID,
      fromStatus: 'APPROVED',
      toStatus: 'CLOSED',
      reason: '买家寄回超时，系统自动关闭',
      operatorType: 'SYSTEM',
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('cancels stale RETURN_SHIPPING generated waybill, refunds shipping payment, and closes to CLOSED', async () => {
    const {
      service,
      prisma,
      tx,
      statusHistory,
      returnShippingService,
      shippingPaymentService,
    } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { id: AFTER_SALE_ID, orderId: ORDER_ID },
    ]);
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      returnWaybillNo: 'SF1234567890',
      returnShippingPayer: 'PLATFORM',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: null,
    });
    returnShippingService.cancelIfNotPickedUp.mockResolvedValue({ cancelled: true });
    tx.afterSaleRequest.findUnique.mockResolvedValue({ status: 'RETURN_SHIPPING' });

    await (service as any).handleBuyerShipTimeout();

    expect(returnShippingService.cancelIfNotPickedUp).toHaveBeenCalledWith(AFTER_SALE_ID);
    expect(shippingPaymentService.refundShippingPayment).toHaveBeenCalledWith(
      AFTER_SALE_ID,
      '退货面单未揽收，售后关闭退还运费',
    );
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: AFTER_SALE_ID, status: 'RETURN_SHIPPING' },
      data: { status: 'CLOSED' },
    });
    expect(statusHistory.create).toHaveBeenCalledWith(tx, expect.objectContaining({
      fromStatus: 'RETURN_SHIPPING',
      toStatus: 'CLOSED',
    }));
  });

  it('marks manual review when stale RETURN_SHIPPING generated waybill cancellation fails and does not close', async () => {
    const {
      service,
      prisma,
      tx,
      statusHistory,
      returnShippingService,
      shippingPaymentService,
    } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { id: AFTER_SALE_ID, orderId: ORDER_ID },
    ]);
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      returnWaybillNo: 'SF1234567890',
      returnShippingPayer: 'PLATFORM',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: null,
    });
    returnShippingService.cancelIfNotPickedUp.mockResolvedValue({
      cancelled: false,
      reason: 'CANCEL_FAILED',
    });

    await (service as any).handleBuyerShipTimeout();

    expect(returnShippingService.cancelIfNotPickedUp).toHaveBeenCalledWith(AFTER_SALE_ID);
    expect(shippingPaymentService.refundShippingPayment).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: AFTER_SALE_ID, status: { in: ['APPROVED', 'RETURN_SHIPPING'] } },
      data: {
        manualReviewReason: '买家寄回超时但退货面单取消失败（CANCEL_FAILED），需人工核查是否已揽收',
        manualReviewRequestedAt: expect.any(Date),
      },
    });
    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: expect.any(String) } }),
    );
    expect(statusHistory.create).not.toHaveBeenCalled();
  });
});
