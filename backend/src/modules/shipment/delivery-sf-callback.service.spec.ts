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
      $executeRaw: jest.fn(),
      deliveryShipment: {
        update: jest.fn(),
      },
      deliverySubOrder: {
        updateMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      deliveryOrder: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deliveryCarrierWaybill: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deliveryCarrierOrder: {
        update: jest.fn(),
      },
      deliveryPickupBatch: {
        update: jest.fn(),
        findMany: jest.fn(),
      },
      deliveryPickupBatchItem: {
        updateMany: jest.fn(),
      },
      deliveryOrderItem: {
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
      deliveryCarrierWaybill: {
        findUnique: jest.fn(),
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
    deliveryPrisma.deliveryCarrierWaybill.findUnique.mockResolvedValue(null);

    await expect(
      service.handleSfCallback('SF_NOT_FOUND', 'DELIVERED', [], {}),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(deliveryPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('routes multi-waybill callbacks into the pickup batch and releases reservations once', async () => {
    deliveryPrisma.deliveryShipment.findFirst.mockResolvedValue(null);
    const batch = {
      id: 'batch_1',
      orderId: 'order_1',
      subOrderId: 'sub_1',
      status: 'DELIVERING',
      loadedAt: new Date('2026-08-03T10:00:00Z'),
      completedAt: null,
      items: [
        {
          id: 'batch_item_1',
          orderItemId: 'order_item_1',
          subOrderId: 'sub_1',
          quantity: 2,
          pickedQuantity: 0,
        },
      ],
    };
    const outerWaybill = {
      id: 'waybill_2',
      trackingNo: 'SF002',
      status: 'IN_TRANSIT',
      deliveredAt: null,
      rawPayload: null,
      createdAt: new Date('2026-08-03T09:00:00Z'),
      carrierOrderId: 'carrier_1',
      carrierOrder: { batchId: 'batch_1', batch },
    };
    const latestWaybill = {
      ...outerWaybill,
      carrierOrder: {
        id: 'carrier_1',
        batchId: 'batch_1',
        batch,
        waybills: [
          { id: 'waybill_1', status: 'DELIVERED' },
          { id: 'waybill_2', status: 'IN_TRANSIT' },
        ],
      },
    };
    deliveryPrisma.deliveryCarrierWaybill.findUnique.mockResolvedValue(outerWaybill);
    tx.deliveryCarrierWaybill.findUnique.mockResolvedValue(latestWaybill);
    tx.deliveryPickupBatch.findMany.mockResolvedValue([{ status: 'COMPLETED' }]);
    tx.deliveryPickupBatchItem.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOrderItem.updateMany.mockResolvedValue({ count: 1 });
    tx.deliverySubOrder.findUnique.mockResolvedValue({ status: 'SHIPPED' });
    tx.deliverySubOrder.findMany.mockResolvedValue([{ status: 'DELIVERED' }]);
    tx.deliveryOrder.findUnique.mockResolvedValue({ status: 'SHIPPED' });

    await expect(
      service.handleSfCallback(
        'SF002',
        'DELIVERED',
        [{ time: '2026-08-03 12:00:00', message: '已签收', opCode: '80' }],
        {},
      ),
    ).resolves.toEqual({ ok: true, handledBy: 'delivery' });

    expect(tx.deliveryPickupBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch_1' },
      data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
    });
    expect(tx.deliveryOrderItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          pickedQuantity: { increment: 2 },
          reservedPickupQuantity: { decrement: 2 },
        },
      }),
    );
  });
});
