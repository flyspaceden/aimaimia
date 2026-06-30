import { ShipmentMonitorService } from './shipment-monitor.service';

describe('ShipmentMonitorService', () => {
  it('emits logistics.stale notification for stale in-transit shipments', async () => {
    const prisma: any = {
      shipment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'shipment-stale-1',
            orderId: 'order-stale-1',
            order: { userId: 'buyer-stale-1' },
          },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'shipment-stale-1' }),
      },
    };
    const notificationService = {
      emit: jest.fn().mockResolvedValue({ id: 'outbox-stale-1' }),
    };
    const service = new ShipmentMonitorService(
      prisma as any,
      notificationService as any,
    );

    await service.checkStaleShipments();

    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'logistics.stale',
      aggregateType: 'shipment',
      aggregateId: 'shipment-stale-1',
      idempotencyKey: 'shipment:shipment-stale-1:stale',
      actor: { kind: 'system' },
      payload: {
        shipmentId: 'shipment-stale-1',
        orderId: 'order-stale-1',
        buyerUserId: 'buyer-stale-1',
      },
    });
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 'shipment-stale-1' },
      data: { updatedAt: expect.any(Date) },
    });
  });
});
