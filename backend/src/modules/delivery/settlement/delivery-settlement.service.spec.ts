import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySettlementService } from './delivery-settlement.service';

describe('DeliverySettlementService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let service: DeliverySettlementService;

  beforeEach(() => {
    tx = {
      deliverySettlement: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deliverySubOrder: {
        findUnique: jest.fn(),
      },
      deliveryAuditLog: {
        create: jest.fn(),
      },
    };

    deliveryPrisma = {
      deliverySubOrder: {
        findMany: jest.fn(),
      },
      deliverySettlement: {
        createMany: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    service = new DeliverySettlementService(deliveryPrisma as DeliveryPrismaService);
  });

  it('makes settlement available only after delivery suborders are delivered or completed', async () => {
    deliveryPrisma.deliverySubOrder.findMany.mockResolvedValue([
      {
        id: 'sub_delivered',
        merchantId: 'merchant_1',
        status: 'DELIVERED',
        supplyAmountCents: 1000,
        shippingFeeShareCents: 200,
        deliveredAt: new Date('2026-06-19T10:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 'sub_completed',
        merchantId: 'merchant_1',
        status: 'COMPLETED',
        supplyAmountCents: 2000,
        shippingFeeShareCents: 300,
        deliveredAt: new Date('2026-06-19T11:00:00.000Z'),
        completedAt: new Date('2026-06-19T12:00:00.000Z'),
      },
    ]);
    deliveryPrisma.deliverySettlement.createMany.mockResolvedValue({ count: 2 });
    deliveryPrisma.deliverySettlement.count.mockResolvedValue(2);
    deliveryPrisma.deliverySettlement.findMany.mockResolvedValue([
      {
        id: 'settlement_1',
        merchantId: 'merchant_1',
        subOrderId: 'sub_delivered',
        status: 'PENDING',
        settlementMonth: '2026-06',
        supplyAmountCents: 1000,
        settledAmountCents: 0,
        note: null,
        exportFileUrl: null,
        settledAt: null,
        markedSettledByAdminId: null,
        subOrder: {
          id: 'sub_delivered',
          orderId: 'order_1',
          status: 'DELIVERED',
          totalAmountCents: 1200,
          shippingFeeShareCents: 200,
          deliveredAt: new Date('2026-06-19T10:00:00.000Z'),
          completedAt: null,
        },
        merchant: {
          id: 'merchant_1',
          name: '华南仓',
        },
      },
      {
        id: 'settlement_2',
        merchantId: 'merchant_1',
        subOrderId: 'sub_completed',
        status: 'PENDING',
        settlementMonth: '2026-06',
        supplyAmountCents: 2000,
        settledAmountCents: 0,
        note: null,
        exportFileUrl: null,
        settledAt: null,
        markedSettledByAdminId: null,
        subOrder: {
          id: 'sub_completed',
          orderId: 'order_2',
          status: 'COMPLETED',
          totalAmountCents: 2300,
          shippingFeeShareCents: 300,
          deliveredAt: new Date('2026-06-19T11:00:00.000Z'),
          completedAt: new Date('2026-06-19T12:00:00.000Z'),
        },
        merchant: {
          id: 'merchant_1',
          name: '华南仓',
        },
      },
    ]);

    const result = await service.listAdminSettlements({});

    expect(deliveryPrisma.deliverySubOrder.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ['DELIVERED', 'COMPLETED'],
        },
        settlements: {
          none: {},
        },
      },
      select: {
        id: true,
        merchantId: true,
        status: true,
        supplyAmountCents: true,
        shippingFeeShareCents: true,
        deliveredAt: true,
        completedAt: true,
      },
    });
    expect(deliveryPrisma.deliverySettlement.createMany).toHaveBeenCalledWith({
      data: [
        {
          merchantId: 'merchant_1',
          subOrderId: 'sub_delivered',
          settlementMonth: '2026-06',
          supplyAmountCents: 1000,
        },
        {
          merchantId: 'merchant_1',
          subOrderId: 'sub_completed',
          settlementMonth: '2026-06',
          supplyAmountCents: 2000,
        },
      ],
      skipDuplicates: true,
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'settlement_1',
        subOrderId: 'sub_delivered',
        expectedAmountCents: 1200,
      }),
      expect.objectContaining({
        id: 'settlement_2',
        subOrderId: 'sub_completed',
        expectedAmountCents: 2300,
      }),
    ]);
  });

  it('marks a settlement as paid and writes a delivery audit log', async () => {
    tx.deliverySettlement.findUnique.mockResolvedValue({
      id: 'settlement_1',
      merchantId: 'merchant_1',
      subOrderId: 'sub_order_1',
      status: 'PENDING',
      settlementMonth: '2026-06',
      supplyAmountCents: 1000,
      settledAmountCents: 0,
      note: null,
      settledAt: null,
      markedSettledByAdminId: null,
    });
    tx.deliverySubOrder.findUnique.mockResolvedValue({
      id: 'sub_order_1',
      status: 'COMPLETED',
      shippingFeeShareCents: 250,
    });
    tx.deliverySettlement.update.mockResolvedValue({
      id: 'settlement_1',
      merchantId: 'merchant_1',
      subOrderId: 'sub_order_1',
      status: 'SETTLED',
      settlementMonth: '2026-06',
      supplyAmountCents: 1000,
      settledAmountCents: 1250,
      note: '线下打款完成',
      settledAt: new Date('2026-06-19T13:00:00.000Z'),
      markedSettledByAdminId: 'admin_1',
    });
    tx.deliveryAuditLog.create.mockResolvedValue({ id: 'audit_1' });

    const result = await service.markSettlementPaid('admin_1', 'settlement_1', {
      settledAmountCents: 1250,
      note: '线下打款完成',
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.deliverySettlement.update).toHaveBeenCalledWith({
      where: { id: 'settlement_1' },
      data: expect.objectContaining({
        status: 'SETTLED',
        settledAmountCents: 1250,
        note: '线下打款完成',
        markedSettledByAdminId: 'admin_1',
      }),
    });
    expect(tx.deliveryAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin_1',
        module: 'delivery-settlement',
        action: 'mark-paid',
        targetType: 'DeliverySettlement',
        targetId: 'settlement_1',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'settlement_1',
        status: 'SETTLED',
        settledAmountCents: 1250,
      }),
    );
  });

  it('rejects marking a settlement as paid when the linked suborder is not yet delivered', async () => {
    tx.deliverySettlement.findUnique.mockResolvedValue({
      id: 'settlement_1',
      subOrderId: 'sub_order_1',
      status: 'PENDING',
      supplyAmountCents: 1000,
      settledAmountCents: 0,
    });
    tx.deliverySubOrder.findUnique.mockResolvedValue({
      id: 'sub_order_1',
      status: 'PENDING_SHIPMENT',
      shippingFeeShareCents: 200,
    });

    await expect(
      service.markSettlementPaid('admin_1', 'settlement_1', {
        settledAmountCents: 1200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.deliverySettlement.update).not.toHaveBeenCalled();
    expect(tx.deliveryAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects marking an already settled record as paid again', async () => {
    tx.deliverySettlement.findUnique.mockResolvedValue({
      id: 'settlement_1',
      subOrderId: 'sub_order_1',
      status: 'SETTLED',
      supplyAmountCents: 1000,
      settledAmountCents: 1200,
    });

    await expect(
      service.markSettlementPaid('admin_1', 'settlement_1', {
        settledAmountCents: 1200,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws when marking a missing settlement as paid', async () => {
    tx.deliverySettlement.findUnique.mockResolvedValue(null);

    await expect(
      service.markSettlementPaid('admin_1', 'missing', {
        settledAmountCents: 1000,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
