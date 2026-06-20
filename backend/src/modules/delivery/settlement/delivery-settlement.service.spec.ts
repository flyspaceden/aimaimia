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
        findMany: jest.fn(),
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
        upsert: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    service = new DeliverySettlementService(deliveryPrisma as DeliveryPrismaService);
    tx.deliverySettlement.findMany.mockResolvedValue([]);
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
    deliveryPrisma.deliverySettlement.upsert.mockResolvedValue({
      id: 'settlement_1',
    });
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
    expect(deliveryPrisma.deliverySettlement.upsert).toHaveBeenNthCalledWith(1, {
      where: { subOrderId: 'sub_delivered' },
      create: {
        merchantId: 'merchant_1',
        subOrderId: 'sub_delivered',
        settlementMonth: '2026-06',
        supplyAmountCents: 1000,
      },
      update: {},
    });
    expect(deliveryPrisma.deliverySettlement.upsert).toHaveBeenNthCalledWith(2, {
      where: { subOrderId: 'sub_completed' },
      create: {
        merchantId: 'merchant_1',
        subOrderId: 'sub_completed',
        settlementMonth: '2026-06',
        supplyAmountCents: 2000,
      },
      update: {},
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

  it('returns seller settlements scoped to the merchant without buyer final totals', async () => {
    deliveryPrisma.deliverySubOrder.findMany.mockResolvedValue([]);
    deliveryPrisma.deliverySettlement.count.mockResolvedValue(1);
    deliveryPrisma.deliverySettlement.findMany.mockResolvedValue([
      {
        id: 'settlement_1',
        merchantId: 'merchant_1',
        subOrderId: 'sub_order_1',
        status: 'PENDING',
        settlementMonth: '2026-06',
        supplyAmountCents: 1800,
        settledAmountCents: 0,
        note: '待月结',
        exportFileUrl: null,
        settledAt: null,
        markedSettledByAdminId: null,
        createdAt: new Date('2026-06-19T09:00:00.000Z'),
        updatedAt: new Date('2026-06-19T09:00:00.000Z'),
        merchant: {
          id: 'merchant_1',
          name: '华南仓',
        },
        subOrder: {
          id: 'sub_order_1',
          orderId: 'order_1',
          status: 'COMPLETED',
          totalAmountCents: 2600,
          shippingFeeShareCents: 200,
          deliveredAt: new Date('2026-06-18T10:00:00.000Z'),
          completedAt: new Date('2026-06-19T08:00:00.000Z'),
        },
      },
    ]);

    const result = await service.listSellerSettlements('merchant_1', {
      page: 1,
      pageSize: 20,
      status: 'PENDING',
    });

    expect(deliveryPrisma.deliverySettlement.count).toHaveBeenCalledWith({
      where: {
        merchantId: 'merchant_1',
        status: 'PENDING',
      },
    });
    expect(deliveryPrisma.deliverySettlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          merchantId: 'merchant_1',
          status: 'PENDING',
        },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'settlement_1',
      merchantId: 'merchant_1',
      settlementMonth: '2026-06',
      status: 'PENDING',
      supplyAmountCents: 1800,
      settledAmountCents: 0,
      expectedAmountCents: 2000,
      merchant: {
        id: 'merchant_1',
        name: '华南仓',
      },
      subOrder: {
        id: 'sub_order_1',
        orderId: 'order_1',
        status: 'COMPLETED',
        deliveredAt: new Date('2026-06-18T10:00:00.000Z'),
        completedAt: new Date('2026-06-19T08:00:00.000Z'),
      },
    });
    expect(result.items[0].subOrder).not.toHaveProperty('totalAmountCents');
    expect(result.items[0].subOrder).not.toHaveProperty('shippingFeeShareCents');
    expect(result.items[0]).not.toHaveProperty('totalAmountCents');
    expect(result.items[0]).not.toHaveProperty('buyerPaymentTotalAmountCents');
    expect(result.items[0]).not.toHaveProperty('finalBuyerPriceCents');
    expect(result.items[0]).not.toHaveProperty('markupAmountCents');
    expect(result.items[0]).not.toHaveProperty('marginAmountCents');
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

  it('rejects marking a settlement as paid when duplicate rows exist for the same suborder', async () => {
    tx.deliverySettlement.findUnique.mockResolvedValue({
      id: 'settlement_1',
      subOrderId: 'sub_order_1',
      status: 'PENDING',
      supplyAmountCents: 1000,
      settledAmountCents: 0,
    });
    tx.deliverySettlement.findMany.mockResolvedValue([
      { id: 'settlement_1', subOrderId: 'sub_order_1', status: 'PENDING' },
      { id: 'settlement_2', subOrderId: 'sub_order_1', status: 'PENDING' },
    ]);

    await expect(
      service.markSettlementPaid('admin_1', 'settlement_1', {
        settledAmountCents: 1200,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.deliverySettlement.update).not.toHaveBeenCalled();
    expect(tx.deliveryAuditLog.create).not.toHaveBeenCalled();
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
