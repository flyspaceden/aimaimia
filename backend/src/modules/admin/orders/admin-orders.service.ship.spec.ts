import { BadRequestException } from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';

describe('AdminOrdersService.ship', () => {
  const makeService = () => {
    const prisma = {
      order: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const sfExpress = {
      createOrder: jest.fn(),
      cancelOrder: jest.fn(),
      printWaybill: jest.fn(),
    };
    const service = new (AdminOrdersService as any)(
      prisma,
      {},
      sfExpress,
      {},
      {},
    );
    return { service, prisma, sfExpress };
  };

  it('手填发货拒绝 4 位短单号，避免误以为已在顺丰沙箱下单', async () => {
    const { service, prisma, sfExpress } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-001',
      status: 'PAID',
      items: [{ companyId: 'company-001' }],
    });

    await expect(
      service.ship('order-001', {
        useCarrierAuto: false,
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        trackingNo: '1234',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(sfExpress.createOrder).not.toHaveBeenCalled();
  });
});
