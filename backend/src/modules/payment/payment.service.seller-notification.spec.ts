import { PaymentService } from './payment.service';

describe('PaymentService seller order notifications', () => {
  it('emits one seller notification event per company/order pair', async () => {
    const prisma = {
      orderItem: {
        findMany: jest.fn().mockResolvedValue([
          { orderId: 'order-1', companyId: 'company-1' },
          { orderId: 'order-2', companyId: 'company-1' },
          { orderId: 'order-2', companyId: 'company-2' },
          { orderId: 'order-3', companyId: null },
        ]),
      },
      companyStaff: {
        findMany: jest.fn(),
      },
    };
    const notificationService = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentService(
      prisma as any,
      { get: jest.fn() } as any,
      {} as any,
      undefined,
      undefined,
      notificationService as any,
    );

    await service.notifyMerchantsForOrders(['order-1', 'order-2', 'order-3']);

    expect(prisma.orderItem.findMany).toHaveBeenCalledWith({
      where: { orderId: { in: ['order-1', 'order-2', 'order-3'] } },
      select: { orderId: true, companyId: true },
      distinct: ['orderId', 'companyId'],
    });
    expect(prisma.companyStaff.findMany).not.toHaveBeenCalled();
    expect(notificationService.emit).toHaveBeenCalledTimes(3);
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'order.newPaidForSeller',
      aggregateType: 'order',
      aggregateId: 'order-1',
      idempotencyKey: 'seller-order:company-1:order-1:paid',
      actor: { kind: 'system' },
      payload: { companyId: 'company-1', orderId: 'order-1' },
    });
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'order.newPaidForSeller',
      aggregateType: 'order',
      aggregateId: 'order-2',
      idempotencyKey: 'seller-order:company-1:order-2:paid',
      actor: { kind: 'system' },
      payload: { companyId: 'company-1', orderId: 'order-2' },
    });
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'order.newPaidForSeller',
      aggregateType: 'order',
      aggregateId: 'order-2',
      idempotencyKey: 'seller-order:company-2:order-2:paid',
      actor: { kind: 'system' },
      payload: { companyId: 'company-2', orderId: 'order-2' },
    });
  });
});
