import { Prisma } from '@prisma/client';
import { AfterSaleTimeoutService } from './after-sale-timeout.service';

const AFTER_SALE_ID = 'as_timeout_001';
const ORDER_ID = 'order_timeout_001';
const NOW = new Date('2026-05-09T12:00:00.000Z');
const STALE_AT = new Date('2026-05-01T12:00:00.000Z');
const FRESH_AT = new Date('2026-05-09T11:30:00.000Z');

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
      requiresReturn: true,
      approvedAt: STALE_AT,
      returnWaybillNo: null,
      returnSfOrderId: null,
      returnShippingPayer: 'BUYER',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      status: 'APPROVED',
      manualReviewRequestedAt: null,
      approvedAt: STALE_AT,
      returnShippedAt: null,
      returnWaybillNo: null,
      returnSfOrderId: null,
    });

    await (service as any).handleBuyerShipTimeout();

    expect(prisma.afterSaleRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        manualReviewRequestedAt: null,
        OR: [
          {
            status: 'APPROVED',
            requiresReturn: true,
            approvedAt: { lt: expect.any(Date) },
          },
          {
            status: 'RETURN_SHIPPING',
            requiresReturn: true,
            returnSfOrderId: { not: null },
            returnWaybillNo: { not: null },
            returnShippedAt: { lt: expect.any(Date) },
          },
        ],
      },
    }));
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: AFTER_SALE_ID,
        status: 'APPROVED',
        manualReviewRequestedAt: null,
        returnWaybillNo: null,
        returnSfOrderId: null,
        approvedAt: STALE_AT,
        returnShippedAt: null,
      },
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

  it('refunds buyer-paid shipping only after closing APPROVED no-waybill timeout', async () => {
    const {
      service,
      prisma,
      tx,
      statusHistory,
      shippingPaymentService,
    } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { id: AFTER_SALE_ID, orderId: ORDER_ID },
    ]);
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'APPROVED',
      requiresReturn: true,
      approvedAt: STALE_AT,
      returnWaybillNo: null,
      returnSfOrderId: null,
      returnShippingPayer: 'BUYER',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: new Date('2026-05-09T10:30:00.000Z'),
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      status: 'APPROVED',
      manualReviewRequestedAt: null,
      approvedAt: STALE_AT,
      returnShippedAt: null,
      returnWaybillNo: null,
      returnSfOrderId: null,
    });

    await (service as any).handleBuyerShipTimeout();

    expect(shippingPaymentService.refundShippingPayment).toHaveBeenCalledWith(
      AFTER_SALE_ID,
      '买家超时未生成退货面单，售后关闭退还运费',
    );
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: AFTER_SALE_ID,
        status: 'APPROVED',
        manualReviewRequestedAt: null,
        returnWaybillNo: null,
        returnSfOrderId: null,
        approvedAt: STALE_AT,
        returnShippedAt: null,
      },
      data: { status: 'CLOSED' },
    });
    expect(statusHistory.create).toHaveBeenCalledWith(tx, expect.objectContaining({
      afterSaleId: AFTER_SALE_ID,
      fromStatus: 'APPROVED',
      toStatus: 'CLOSED',
    }));
    expect(tx.afterSaleRequest.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(shippingPaymentService.refundShippingPayment.mock.invocationCallOrder[0]);
  });

  it('does not refund buyer-paid shipping when timeout close CAS fails', async () => {
    const {
      service,
      prisma,
      tx,
      shippingPaymentService,
    } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { id: AFTER_SALE_ID, orderId: ORDER_ID },
    ]);
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'APPROVED',
      requiresReturn: true,
      approvedAt: STALE_AT,
      returnWaybillNo: null,
      returnSfOrderId: null,
      returnShippingPayer: 'BUYER',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: new Date('2026-05-09T10:30:00.000Z'),
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      status: 'APPROVED',
      manualReviewRequestedAt: null,
      approvedAt: STALE_AT,
      returnShippedAt: null,
      returnWaybillNo: null,
      returnSfOrderId: null,
    });
    tx.afterSaleRequest.updateMany.mockResolvedValue({ count: 0 });

    await (service as any).handleBuyerShipTimeout();

    expect(shippingPaymentService.refundShippingPayment).not.toHaveBeenCalled();
  });

  it('does not cancel, close, or refund when a stale APPROVED candidate now has a fresh generated waybill', async () => {
    const {
      service,
      prisma,
      tx,
      returnShippingService,
      shippingPaymentService,
    } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { id: AFTER_SALE_ID, orderId: ORDER_ID },
    ]);
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      requiresReturn: true,
      returnWaybillNo: 'SF_NEW_001',
      returnSfOrderId: 'sf-new-001',
      returnShippedAt: FRESH_AT,
      returnShippingPayer: 'BUYER',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: new Date('2026-05-09T10:30:00.000Z'),
    });
    returnShippingService.cancelIfNotPickedUp.mockResolvedValue({ cancelled: true });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      status: 'RETURN_SHIPPING',
      returnWaybillNo: null,
      returnSfOrderId: null,
      manualReviewRequestedAt: null,
    });

    await (service as any).handleBuyerShipTimeout();

    expect(returnShippingService.cancelIfNotPickedUp).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalled();
    expect(shippingPaymentService.refundShippingPayment).not.toHaveBeenCalled();
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
      requiresReturn: true,
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
      returnShippedAt: STALE_AT,
      returnShippingPayer: 'PLATFORM',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: null,
    });
    returnShippingService.cancelIfNotPickedUp.mockResolvedValue({ cancelled: true });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      status: 'RETURN_SHIPPING',
      manualReviewRequestedAt: null,
      approvedAt: null,
      returnShippedAt: null,
      returnWaybillNo: null,
      returnSfOrderId: null,
    });

    await (service as any).handleBuyerShipTimeout();

    expect(returnShippingService.cancelIfNotPickedUp).toHaveBeenCalledWith(AFTER_SALE_ID);
    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: AFTER_SALE_ID,
        status: 'RETURN_SHIPPING',
        manualReviewRequestedAt: null,
        returnWaybillNo: null,
        returnSfOrderId: null,
        returnShippedAt: null,
      },
      data: { status: 'CLOSED' },
    });
    expect(shippingPaymentService.refundShippingPayment).toHaveBeenCalledWith(
      AFTER_SALE_ID,
      '退货面单未揽收，售后关闭退还运费',
    );
    expect(tx.afterSaleRequest.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(shippingPaymentService.refundShippingPayment.mock.invocationCallOrder[0]);
    expect(statusHistory.create).toHaveBeenCalledWith(tx, expect.objectContaining({
      fromStatus: 'RETURN_SHIPPING',
      toStatus: 'CLOSED',
    }));
  });

  it('does not refund cancelled generated waybill when timeout close CAS fails', async () => {
    const {
      service,
      prisma,
      tx,
      returnShippingService,
      shippingPaymentService,
    } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { id: AFTER_SALE_ID, orderId: ORDER_ID },
    ]);
    prisma.afterSaleRequest.findUnique.mockResolvedValue({
      id: AFTER_SALE_ID,
      status: 'RETURN_SHIPPING',
      requiresReturn: true,
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
      returnShippedAt: STALE_AT,
      returnShippingPayer: 'PLATFORM',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: null,
    });
    returnShippingService.cancelIfNotPickedUp.mockResolvedValue({ cancelled: true });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      status: 'RETURN_SHIPPING',
      manualReviewRequestedAt: null,
      approvedAt: null,
      returnShippedAt: null,
      returnWaybillNo: null,
      returnSfOrderId: null,
    });
    tx.afterSaleRequest.updateMany.mockResolvedValue({ count: 0 });

    await (service as any).handleBuyerShipTimeout();

    expect(returnShippingService.cancelIfNotPickedUp).toHaveBeenCalledWith(AFTER_SALE_ID);
    expect(shippingPaymentService.refundShippingPayment).not.toHaveBeenCalled();
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
      requiresReturn: true,
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
      returnShippedAt: STALE_AT,
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
      where: {
        id: AFTER_SALE_ID,
        status: { in: ['APPROVED', 'RETURN_SHIPPING'] },
        manualReviewRequestedAt: null,
      },
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

  it('skips buyer ship timeout rows already under manual review without cancelling or clearing reason', async () => {
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
      requiresReturn: true,
      returnWaybillNo: 'SF1234567890',
      returnSfOrderId: 'sf-order-return-001',
      returnShippedAt: STALE_AT,
      returnShippingPayer: 'PLATFORM',
      returnShippingFeeDeducted: false,
      returnShippingPaidAt: null,
      manualReviewRequestedAt: new Date('2026-05-09T11:00:00.000Z'),
      manualReviewReason: '原人工复核原因',
    });

    await (service as any).handleBuyerShipTimeout();

    expect(returnShippingService.cancelIfNotPickedUp).not.toHaveBeenCalled();
    expect(shippingPaymentService.refundShippingPayment).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalled();
    expect(statusHistory.create).not.toHaveBeenCalled();
  });
});

describe('AfterSaleTimeoutService seller receive timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('excludes generated SF return waybills from stale seller auto-receive candidates', async () => {
    const { service, prisma } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([]);

    await (service as any).handleSellerReceiveTimeout();

    expect(prisma.afterSaleRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'RETURN_SHIPPING',
        returnShippedAt: { lt: expect.any(Date) },
        manualReviewRequestedAt: null,
        returnSfOrderId: null,
      },
    }));
  });

  it('does not auto-receive a generated SF return waybill even if a stale row reaches the handler', async () => {
    const { service, prisma, tx, statusHistory } = createMocks();
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      {
        id: AFTER_SALE_ID,
        orderId: ORDER_ID,
        afterSaleType: 'NO_REASON_RETURN',
        refundAmount: 88,
        reason: '七天无理由',
        returnSfOrderId: 'sf-order-return-001',
      },
    ]);

    await (service as any).handleSellerReceiveTimeout();

    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalled();
    expect(statusHistory.create).not.toHaveBeenCalled();
  });
});
