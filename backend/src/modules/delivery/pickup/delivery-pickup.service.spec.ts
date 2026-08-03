import { BadRequestException } from '@nestjs/common';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { SfPickupCarrierService } from '../carriers/sf-pickup-carrier.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryConfigService } from '../config/delivery-config.service';
import { DeliveryPickupService } from './delivery-pickup.service';

describe('DeliveryPickupService SF fulfillment', () => {
  let batch: any;
  let carrierOrder: any;
  let tx: any;
  let deliveryPrisma: any;
  let sfCarrier: any;
  let deliveryConfig: any;
  let service: DeliveryPickupService;

  beforeEach(() => {
    carrierOrder = null;
    batch = createBatch();
    tx = {
      $executeRaw: jest.fn(),
      deliveryPickupBatch: {
        findFirst: jest.fn(async () => batch),
        findUnique: jest.fn(async () => batch),
        findMany: jest.fn(async () => [{ status: batch.status }]),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(batch, data);
          return batch;
        }),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(batch, data);
          return { count: 1 };
        }),
        aggregate: jest.fn(async () => ({
          _sum: { actualCarrierCostCents: batch.actualCarrierCostCents },
        })),
      },
      deliveryCarrierOrder: {
        create: jest.fn(async ({ data }: any) => {
          carrierOrder = {
            ...data,
            carrierOrderNo: null,
            waybillUrl: null,
            estimatePayload: null,
            orderPayload: null,
            detailPayload: null,
            cancelPayload: null,
            estimatedFeeCents: null,
            actualFeeCents: null,
            lastSyncedAt: null,
            createdAt: new Date('2026-08-03T10:00:00Z'),
            updatedAt: new Date('2026-08-03T10:00:00Z'),
            waybills: [],
          };
          batch.carrierOrders = [carrierOrder];
          return carrierOrder;
        }),
        update: jest.fn(async ({ data }: any) => {
          const waybillCreates = data.waybills?.create;
          const { waybills: _waybills, ...scalarData } = data;
          Object.assign(carrierOrder, scalarData);
          if (waybillCreates) {
            carrierOrder.waybills = waybillCreates.map((item: any, index: number) => ({
              id: `waybill_${index + 1}`,
              carrierOrderId: carrierOrder.id,
              deliveredAt: null,
              lastSyncedAt: null,
              rawPayload: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...item,
            }));
          }
          return carrierOrder;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      deliveryCarrierWaybill: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const target = carrierOrder?.waybills?.find(
            (item: any) => item.trackingNo === where.trackingNo,
          );
          if (!target) return { count: 0 };
          Object.assign(target, data);
          return { count: 1 };
        }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      deliveryPickupBatchItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      deliveryOrderItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      deliverySubOrder: {
        findUnique: jest.fn().mockResolvedValue({ status: 'PENDING_SHIPMENT' }),
        findMany: jest.fn().mockResolvedValue([{ status: 'PENDING_SHIPMENT' }]),
        update: jest.fn().mockResolvedValue({}),
      },
      deliveryOrder: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'PENDING_SHIPMENT',
          prepaidPickupShippingFeeCents: 500,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      deliveryAuditLog: { create: jest.fn().mockResolvedValue({}) },
      deliveryShippingCostLedger: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    deliveryPrisma = {
      ...tx,
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    sfCarrier = {
      createShipment: jest.fn().mockResolvedValue({
        provider: 'SF',
        outsideOrderId: 'AIMM-DELIVERY-BATCH-hash',
        sfOrderId: 'sf_order_1',
        primaryWaybillNo: 'SF001',
        waybillNos: ['SF001', 'SF002'],
        waybillUrl: 'https://oss.example/waybill.pdf',
        status: 'WAITING_DRIVER',
        rawPayload: { sfOrderId: 'sf_order_1' },
      }),
      syncWaybills: jest.fn(),
      cancelShipment: jest.fn(),
      reprintWaybill: jest.fn(),
    };
    deliveryConfig = {
      getSfExpressProducts: jest
        .fn()
        .mockResolvedValue([{ expressTypeId: 1, name: '顺丰标快', enabled: true }]),
    };
    service = new DeliveryPickupService(
      deliveryPrisma as DeliveryPrismaService,
      { nextInTransaction: jest.fn().mockResolvedValue('PSCY0000000000001') } as any as DeliveryIdService,
      sfCarrier as SfPickupCarrierService,
      deliveryConfig as DeliveryConfigService,
    );
  });

  it('lets the owning seller create one idempotent SF shipment with multiple waybills', async () => {
    const result = await service.createSfShipment('merchant_1', 'staff_1', batch.id, {
      expressTypeId: 1,
      packageCount: 2,
      totalWeightKg: 35.5,
    });

    expect(sfCarrier.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        expressTypeId: 1,
        expressTypeName: '顺丰标快',
        packageCount: 2,
        totalWeightKg: 35.5,
      }),
    );
    expect(carrierOrder.carrierOrderNo).toBe('SF001');
    expect(carrierOrder.waybills).toHaveLength(2);
    expect(batch.status).toBe('WAITING_DRIVER');
    expect(result).not.toHaveProperty('actualCarrierCostCents');
    expect(result.latestCarrierOrder).not.toHaveProperty('actualFeeCents');

    await service.createSfShipment('merchant_1', 'staff_1', batch.id, {
      expressTypeId: 1,
      packageCount: 2,
      totalWeightKg: 35.5,
    });
    expect(sfCarrier.createShipment).toHaveBeenCalledTimes(1);
  });

  it('rejects a product code that the platform has not enabled', async () => {
    await expect(
      service.createSfShipment('merchant_1', 'staff_1', batch.id, {
        expressTypeId: 999,
        packageCount: 1,
        totalWeightKg: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deliveryPrisma.$transaction).not.toHaveBeenCalled();
    expect(sfCarrier.createShipment).not.toHaveBeenCalled();
  });

  it('keeps manual cost adjustments attributed to SF instead of creating a manual carrier', async () => {
    await service.manualAdjustCost(batch.id, 'admin_1', 250, '顺丰月结账单补差');

    expect(tx.deliveryShippingCostLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'SF',
        type: 'MANUAL_ADJUSTMENT',
        amountCents: 250,
        source: 'ADMIN_MANUAL_ADJUSTMENT',
      }),
    });
    expect(batch.actualCarrierCostCents).toBe(250);
  });

  it('allows the seller to recover a stale SF creation reservation with the same outside order id', async () => {
    batch.status = 'CALLING_CARRIER';
    carrierOrder = {
      id: 'PSCY0000000000001',
      batchId: batch.id,
      provider: 'SF',
      attempt: 1,
      outsideOrderId: 'AIMM-DELIVERY-BATCH-hash',
      carrierOrderNo: null,
      expressTypeId: 1,
      expressTypeName: '顺丰标快',
      packageCount: 1,
      totalWeightKg: 25,
      waybillUrl: null,
      status: 'CREATING_SF_ORDER',
      updatedAt: new Date(Date.now() - 16 * 60 * 1000),
      createdAt: new Date(Date.now() - 16 * 60 * 1000),
      waybills: [],
    };
    batch.carrierOrders = [carrierOrder];

    await service.createSfShipment('merchant_1', 'staff_1', batch.id, {
      expressTypeId: 1,
      packageCount: 1,
      totalWeightKg: 25,
    });

    expect(tx.deliveryCarrierOrder.create).not.toHaveBeenCalled();
    expect(sfCarrier.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ outsideOrderId: 'AIMM-DELIVERY-BATCH-hash' }),
    );
    expect(carrierOrder.carrierOrderNo).toBe('SF001');
  });

  it('completes a batch only after all SF waybills complete and releases reserved quantity', async () => {
    batch.status = 'DELIVERING';
    batch.items[0].quantity = 2;
    carrierOrder = {
      id: 'PSCY0000000000001',
      batchId: batch.id,
      provider: 'SF',
      attempt: 1,
      outsideOrderId: 'AIMM-DELIVERY-BATCH-hash',
      carrierOrderNo: 'SF001',
      expressTypeId: 1,
      expressTypeName: '顺丰标快',
      packageCount: 2,
      totalWeightKg: 35.5,
      waybillUrl: null,
      payType: 'PLATFORM_MONTHLY',
      status: 'DELIVERING',
      estimatePayload: null,
      orderPayload: null,
      detailPayload: null,
      cancelPayload: null,
      estimatedFeeCents: null,
      actualFeeCents: null,
      lastSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      waybills: [
        { id: 'w1', trackingNo: 'SF001', status: 'IN_TRANSIT' },
        { id: 'w2', trackingNo: 'SF002', status: 'IN_TRANSIT' },
      ],
    };
    batch.carrierOrders = [carrierOrder];
    sfCarrier.syncWaybills.mockResolvedValue({
      provider: 'SF',
      status: 'COMPLETED',
      waybills: [
        { trackingNo: 'SF001', status: 'DELIVERED', mappedStatus: 'COMPLETED', events: [] },
        { trackingNo: 'SF002', status: 'DELIVERED', mappedStatus: 'COMPLETED', events: [] },
      ],
      rawPayload: {},
    });

    await service.syncCarrier(batch.id, 'admin_1');

    expect(tx.deliveryOrderItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reservedPickupQuantity: { gte: 2 } }),
        data: {
          pickedQuantity: { increment: 2 },
          reservedPickupQuantity: { decrement: 2 },
        },
      }),
    );
    expect(batch.status).toBe('COMPLETED');
  });

  it('does not regress a completed multi-waybill batch when a stale route query arrives', async () => {
    batch.status = 'COMPLETED';
    batch.completedAt = new Date('2026-08-03T12:00:00Z');
    batch.items[0].pickedQuantity = batch.items[0].quantity;
    carrierOrder = {
      id: 'PSCY0000000000001',
      batchId: batch.id,
      provider: 'SF',
      attempt: 1,
      outsideOrderId: 'AIMM-DELIVERY-BATCH-hash',
      carrierOrderNo: 'SF001',
      status: 'COMPLETED',
      updatedAt: new Date(),
      createdAt: new Date(),
      waybills: [
        { id: 'w1', trackingNo: 'SF001', status: 'DELIVERED', deliveredAt: new Date() },
        { id: 'w2', trackingNo: 'SF002', status: 'DELIVERED', deliveredAt: new Date() },
      ],
    };
    batch.carrierOrders = [carrierOrder];
    sfCarrier.syncWaybills.mockResolvedValue({
      provider: 'SF',
      status: 'DELIVERING',
      waybills: [
        { trackingNo: 'SF001', status: 'IN_TRANSIT', mappedStatus: 'DELIVERING', events: [] },
        { trackingNo: 'SF002', status: 'IN_TRANSIT', mappedStatus: 'DELIVERING', events: [] },
      ],
      rawPayload: {},
    });

    await service.syncCarrier(batch.id, 'admin_1');

    expect(batch.status).toBe('COMPLETED');
    expect(carrierOrder.status).toBe('COMPLETED');
    expect(carrierOrder.waybills.map((item: any) => item.status)).toEqual(['DELIVERED', 'DELIVERED']);
    expect(tx.deliveryOrderItem.updateMany).not.toHaveBeenCalled();
  });
});

function createBatch() {
  return {
    id: 'PSTH0000000000001',
    orderId: 'PSDD0000000000001',
    subOrderId: 'PSZDD000000000001',
    merchantId: 'merchant_1',
    batchNo: 1,
    status: 'READY_TO_CALL',
    provider: 'SF',
    plannedPickupAt: null,
    readyAt: new Date('2026-08-03T09:00:00Z'),
    calledAt: null,
    loadedAt: null,
    completedAt: null,
    canceledAt: null,
    receiverSnapshot: null,
    senderSnapshot: null,
    cargoSnapshot: null,
    estimatedShippingFeeCents: 500,
    actualCarrierCostCents: 0,
    shippingCostDiffCents: 500,
    createdByAdminId: null,
    lastOperatorType: null,
    lastOperatorId: null,
    remark: null,
    createdAt: new Date('2026-08-03T08:00:00Z'),
    updatedAt: new Date('2026-08-03T08:00:00Z'),
    merchant: {
      id: 'merchant_1',
      name: '华南配送中心',
      contactName: '李四',
      contactPhone: '13900000000',
      servicePhone: null,
      addressJson: {
        provinceName: '广东省',
        cityName: '广州市',
        districtName: '天河区',
        detailAddress: '科韵路 8 号',
      },
    },
    order: {
      id: 'PSDD0000000000001',
      unitId: 'unit_1',
      pickupMode: 'MULTI_BATCH',
      plannedPickupCount: 2,
      pickupStatus: 'NOT_STARTED',
      prepaidPickupShippingFeeCents: 1000,
      actualCarrierCostCents: 0,
      shippingCostDiffCents: 1000,
      unitSnapshot: {},
      addressSnapshot: {
        recipientName: '张三',
        phone: '13800000000',
        provinceName: '广东省',
        cityName: '广州市',
        districtName: '天河区',
        detailAddress: '体育东路 1 号',
      },
      status: 'PENDING_SHIPMENT',
    },
    subOrder: {
      id: 'PSZDD000000000001',
      orderId: 'PSDD0000000000001',
      merchantId: 'merchant_1',
      status: 'PENDING_SHIPMENT',
      pickupStatus: 'NOT_STARTED',
    },
    items: [
      {
        id: 'batch_item_1',
        batchId: 'PSTH0000000000001',
        subOrderId: 'PSZDD000000000001',
        orderItemId: 'order_item_1',
        skuId: 'sku_1',
        productSnapshot: { productTitle: '大米', skuTitle: '25kg/袋', weightGram: 25000 },
        quantity: 1,
        pickedQuantity: 0,
        createdAt: new Date(),
      },
    ],
    carrierOrders: [],
  };
}
