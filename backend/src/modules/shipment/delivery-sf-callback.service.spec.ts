import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/delivery-client';
import { DeliveryPrismaService } from '../../delivery-prisma/delivery-prisma.service';
import { DeliverySfCallbackService } from './delivery-sf-callback.service';

describe('DeliverySfCallbackService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let service: DeliverySfCallbackService;

  beforeEach(() => {
    tx = {
      deliveryShipment: {
        update: jest.fn(),
      },
      deliverySubOrder: {
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      deliveryOrder: {
        updateMany: jest.fn(),
      },
    };
    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      deliveryShipment: {
        findFirst: jest.fn(),
      },
    };
    service = new DeliverySfCallbackService(deliveryPrisma as DeliveryPrismaService);
  });

  it('routes SF delivered callbacks into delivery shipment, suborder, and order records', async () => {
    deliveryPrisma.deliveryShipment.findFirst.mockResolvedValue({
      id: 'shipment_1',
      orderId: 'PSDD0000000000001',
      subOrderId: 'PSZDD000000000001',
      status: 'SHIPPED',
      waybillNo: 'SF1234567890',
      trackingNo: 'SF1234567890',
      shippedAt: new Date('2026-06-20T10:00:00.000Z'),
      createdAt: new Date('2026-06-20T09:59:00.000Z'),
      deliveredAt: null,
      rawCarrierPayload: null,
    });
    tx.deliverySubOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.deliverySubOrder.count.mockResolvedValue(0);
    tx.deliveryOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.handleSfCallback(
        'SF1234567890',
        'DELIVERED',
        [
          {
            time: '2026-06-20 12:00:00',
            message: '已签收',
            location: '广东省广州市',
          },
        ],
        { Body: { WaybillRoute: [{ mailno: 'SF1234567890' }] } },
      ),
    ).resolves.toEqual({ ok: true, handledBy: 'delivery' });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.deliveryShipment.update).toHaveBeenCalledWith({
      where: { id: 'shipment_1' },
      data: expect.objectContaining({
        status: 'DELIVERED',
        deliveredAt: expect.any(Date),
        rawCarrierPayload: expect.objectContaining({
          sfCallbacks: [
            expect.objectContaining({
              trackingNo: 'SF1234567890',
              status: 'DELIVERED',
              events: [
                expect.objectContaining({
                  message: '已签收',
                }),
              ],
            }),
          ],
        }),
      }),
    });
    expect(tx.deliverySubOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'PSZDD000000000001', status: 'SHIPPED' },
      data: {
        status: 'DELIVERED',
        deliveredAt: expect.any(Date),
      },
    });
    expect(tx.deliveryOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'PSDD0000000000001', status: 'SHIPPED' },
      data: {
        status: 'DELIVERED',
        deliveredAt: expect.any(Date),
      },
    });
  });

  it('throws NotFound when the SF waybill does not belong to delivery records', async () => {
    deliveryPrisma.deliveryShipment.findFirst.mockResolvedValue(null);

    await expect(
      service.handleSfCallback('SF_NOT_FOUND', 'DELIVERED', [], {}),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(deliveryPrisma.$transaction).not.toHaveBeenCalled();
  });
});
