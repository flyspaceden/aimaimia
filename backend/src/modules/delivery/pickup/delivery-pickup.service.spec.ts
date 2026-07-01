import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DeliveryAuditActorType,
  DeliveryCarrierProvider,
  DeliveryPickupBatchStatus,
  DeliveryShippingCostLedgerType,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { HuolalaCarrierService } from '../carriers/huolala-carrier.service';
import { DeliveryAdminPickupController } from './delivery-admin-pickup.controller';
import { DeliveryPickupService } from './delivery-pickup.service';

describe('DeliveryPickupService admin flows', () => {
  let tx: any;
  let deliveryPrisma: any;
  let deliveryIdService: { nextInTransaction: jest.Mock };
  let huolalaCarrier: {
    quote: jest.Mock;
    requestOrder: jest.Mock;
    getOrderDetail: jest.Mock;
    cancelOrder: jest.Mock;
    mapHuolalaStatus: jest.Mock;
  };
  let service: DeliveryPickupService;

  const now = new Date('2026-06-30T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    tx = createPrismaMock();
    deliveryPrisma = {
      ...tx,
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    deliveryIdService = {
      nextInTransaction: jest.fn().mockResolvedValue('PSCY0000000000001'),
    };
    huolalaCarrier = {
      quote: jest.fn().mockResolvedValue({
        provider: 'HUOLALA',
        priceCalculateId: 'price_calc_001',
        estimatedFeeCents: 320,
        rawPayload: { quote: 'payload' },
      }),
      requestOrder: jest.fn().mockResolvedValue({
        provider: 'HUOLALA',
        outsideOrderId: 'PSTH0000000000001',
        carrierOrderNo: 'HL001',
        status: 'driver_assigned',
        rawPayload: { order: 'payload' },
      }),
      getOrderDetail: jest.fn().mockResolvedValue({
        provider: 'HUOLALA',
        outsideOrderId: 'PSTH0000000000001',
        carrierOrderNo: 'HL001',
        status: 'delivering',
        mappedStatus: DeliveryPickupBatchStatus.DELIVERING,
        actualFeeCents: 380,
        driverSnapshot: { name: 'driver-a' },
        vehicleSnapshot: { plateNo: '粤A12345' },
        rawPayload: { status: 'delivering', version: 1 },
      }),
      cancelOrder: jest.fn().mockResolvedValue({
        provider: 'HUOLALA',
        carrierOrderNo: 'HL001',
        status: 'canceled',
        rawPayload: { status: 'canceled' },
      }),
      mapHuolalaStatus: jest.fn(() => DeliveryPickupBatchStatus.DRIVER_ASSIGNED),
    };

    service = new DeliveryPickupService(
      deliveryPrisma as DeliveryPrismaService,
      deliveryIdService as unknown as DeliveryIdService,
      huolalaCarrier as unknown as HuolalaCarrierService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists freight batches with prepaid, actual, and difference fields for admin', async () => {
    deliveryPrisma.deliveryPickupBatch.aggregate.mockResolvedValue({
      _sum: {
        estimatedShippingFeeCents: 600,
        actualCarrierCostCents: 760,
        shippingCostDiffCents: 160,
      },
    });
    deliveryPrisma.deliveryPickupBatch.count.mockResolvedValue(1);
    deliveryPrisma.deliveryPickupBatch.findMany.mockResolvedValue([
      buildBatch({
        estimatedShippingFeeCents: 600,
        actualCarrierCostCents: 760,
        shippingCostDiffCents: 160,
        status: DeliveryPickupBatchStatus.EXCEPTION,
        carrierOrders: [
          buildCarrierOrder({
            carrierOrderNo: 'HL001',
            status: 'exception',
            actualFeeCents: 760,
          }),
        ],
      }),
    ]);

    const dashboard = await service.getFreightDashboard({
      merchantId: 'merchant_1',
      status: DeliveryPickupBatchStatus.EXCEPTION,
    });
    const list = await service.listAdminPickupBatches({
      page: 1,
      pageSize: 10,
      merchantId: 'merchant_1',
    });

    expect(deliveryPrisma.deliveryPickupBatch.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        merchantId: 'merchant_1',
        status: DeliveryPickupBatchStatus.EXCEPTION,
      }),
      _sum: {
        estimatedShippingFeeCents: true,
        actualCarrierCostCents: true,
        shippingCostDiffCents: true,
      },
    });
    expect(dashboard).toEqual({
      prepaidPickupShippingFeeCents: 600,
      actualCarrierCostCents: 760,
      shippingCostDiffCents: 160,
      exceptionBatchCount: 1,
    });
    expect(list.items[0]).toMatchObject({
      id: 'PSTH0000000000001',
      merchantName: '华南仓',
      prepaidPickupShippingFeeCents: 600,
      actualCarrierCostCents: 760,
      shippingCostDiffCents: 160,
      latestCarrierOrder: expect.objectContaining({
        carrierOrderNo: 'HL001',
        status: 'exception',
      }),
    });
  });

  it('calls Huolala once per batch and stores carrier order idempotently', async () => {
    tx.deliveryPickupBatch.findUnique
      .mockResolvedValueOnce(buildBatch({ carrierOrders: [] }))
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.DRIVER_ASSIGNED,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              priceCalculateId: 'price_calc_001',
              status: 'driver_assigned',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              status: 'driver_assigned',
            }),
          ],
        }),
      )
      .mockResolvedValue(
        buildBatch({
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              status: 'driver_assigned',
            }),
          ],
        }),
      );
    tx.deliveryCarrierOrder.findFirst.mockResolvedValue(null);
    tx.deliveryCarrierOrder.create.mockResolvedValue(
      buildCarrierOrder({
        id: 'PSCY0000000000001',
        carrierOrderNo: null,
        priceCalculateId: null,
        status: 'CALLING_CARRIER',
      }),
    );
    tx.deliveryCarrierOrder.update.mockResolvedValue(
      buildCarrierOrder({
        carrierOrderNo: 'HL001',
        priceCalculateId: 'price_calc_001',
        status: 'driver_assigned',
      }),
    );
    tx.deliveryShippingCostLedger.findFirst.mockResolvedValue(null);
    tx.deliveryPickupBatch.update.mockResolvedValue(
      buildBatch({ status: DeliveryPickupBatchStatus.DRIVER_ASSIGNED }),
    );

    const result = await service.callHuolala('PSTH0000000000001', 'admin_1');

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(huolalaCarrier.quote).toHaveBeenCalledTimes(1);
    expect(huolalaCarrier.quote).toHaveBeenCalledWith(
      expect.objectContaining({
        outsideOrderId: 'PSTH0000000000001',
      }),
    );
    expect(huolalaCarrier.requestOrder).toHaveBeenCalledTimes(1);
    expect(tx.deliveryCarrierOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'PSCY0000000000001',
        outsideOrderId: 'PSTH0000000000001',
      }),
    });
    expect(tx.deliveryAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin_1',
        module: 'delivery-pickup',
        action: 'CALL_HUOLALA',
      }),
    });
    expect(result.latestCarrierOrder?.carrierOrderNo).toBe('HL001');

    await expect(
      service.callHuolala('PSTH0000000000001', 'admin_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(huolalaCarrier.requestOrder).toHaveBeenCalledTimes(1);
  });

  it('allows retry after Huolala quote failure leaves a carrier row without carrier order number', async () => {
    huolalaCarrier.quote
      .mockRejectedValueOnce(new Error('quote unavailable'))
      .mockResolvedValueOnce({
        provider: 'HUOLALA',
        priceCalculateId: 'price_calc_retry',
        estimatedFeeCents: 330,
        rawPayload: { quote: 'retry-payload' },
      });
    tx.deliveryPickupBatch.findUnique
      .mockResolvedValueOnce(buildBatch({ carrierOrders: [] }))
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.CALLING_CARRIER,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: null,
              priceCalculateId: null,
              status: 'CALLING_CARRIER',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.CALLING_CARRIER,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: null,
              priceCalculateId: null,
              status: 'CALLING_CARRIER',
            }),
          ],
        }),
      )
      .mockResolvedValue(
        buildBatch({
          status: DeliveryPickupBatchStatus.DRIVER_ASSIGNED,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              priceCalculateId: 'price_calc_retry',
              status: 'driver_assigned',
            }),
          ],
        }),
      );
    tx.deliveryCarrierOrder.create.mockResolvedValue(
      buildCarrierOrder({
        id: 'PSCY0000000000001',
        carrierOrderNo: null,
        priceCalculateId: null,
        status: 'CALLING_CARRIER',
      }),
    );
    tx.deliveryShippingCostLedger.findFirst.mockResolvedValue(null);

    await expect(
      service.callHuolala('PSTH0000000000001', 'admin_1'),
    ).rejects.toThrow('quote unavailable');

    const result = await service.callHuolala('PSTH0000000000001', 'admin_1');

    expect(tx.deliveryCarrierOrder.create).toHaveBeenCalledTimes(1);
    expect(huolalaCarrier.quote).toHaveBeenCalledTimes(2);
    expect(huolalaCarrier.requestOrder).toHaveBeenCalledTimes(1);
    expect(result.latestCarrierOrder?.carrierOrderNo).toBe('HL001');
  });

  it('syncs carrier detail and updates actual cost ledger idempotently', async () => {
    tx.deliveryPickupBatch.findUnique
      .mockResolvedValueOnce(
        buildBatch({
          carrierOrders: [buildCarrierOrder({ carrierOrderNo: 'HL001' })],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          carrierOrders: [buildCarrierOrder({ carrierOrderNo: 'HL001' })],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.DELIVERING,
          actualCarrierCostCents: 380,
          shippingCostDiffCents: -220,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              actualFeeCents: 380,
              status: 'delivering',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          carrierOrders: [buildCarrierOrder({ carrierOrderNo: 'HL001' })],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.DELIVERING,
          actualCarrierCostCents: 380,
          shippingCostDiffCents: -220,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              actualFeeCents: 380,
              status: 'delivering',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.DELIVERING,
          actualCarrierCostCents: 380,
          shippingCostDiffCents: -220,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              actualFeeCents: 380,
              status: 'delivering',
            }),
          ],
        }),
      );
    tx.deliveryShippingCostLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ledger_actual_1' });

    const result = await service.syncCarrier('PSTH0000000000001', 'admin_1');
    await service.syncCarrier('PSTH0000000000001', 'admin_1');

    expect(result.actualCarrierCostCents).toBe(380);
    expect(tx.deliveryCarrierOrder.update).toHaveBeenCalledWith({
      where: { id: 'PSCY0000000000001' },
      data: expect.objectContaining({
        status: 'delivering',
        actualFeeCents: 380,
      }),
    });
    expect(tx.deliveryShippingCostLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.deliveryShippingCostLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchId: 'PSTH0000000000001',
        type: DeliveryShippingCostLedgerType.CARRIER_ACTUAL,
        amountCents: 380,
        source: 'HUOLALA_DETAIL',
      }),
    });
    expect(tx.deliveryOrder.update).toHaveBeenCalledWith({
      where: { id: 'PSDD0000000000001' },
      data: expect.objectContaining({
        actualCarrierCostCents: 380,
        shippingCostDiffCents: -220,
      }),
    });
  });

  it('rejects manual cost adjustment without admin actor id or remark', async () => {
    await expect(
      service.manualAdjustCost('PSTH0000000000001', '', 100, 'manual fix'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.manualAdjustCost('PSTH0000000000001', 'admin_1', 100, '   '),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deliveryPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-integer manual cost adjustment strings before writing ledger', async () => {
    await expect(
      service.manualAdjustCost('PSTH0000000000001', 'admin_1', '100abc' as any, 'manual fix'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.manualAdjustCost('PSTH0000000000001', 'admin_1', '10.5' as any, 'manual fix'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(deliveryPrisma.$transaction).not.toHaveBeenCalled();
    expect(tx.deliveryShippingCostLedger.create).not.toHaveBeenCalled();
  });

  it('rejects loaded delivering completed cancellation and accepts cancellable status', async () => {
    for (const status of [
      DeliveryPickupBatchStatus.LOADED,
      DeliveryPickupBatchStatus.DELIVERING,
      DeliveryPickupBatchStatus.COMPLETED,
    ]) {
      tx.deliveryPickupBatch.findUnique.mockResolvedValueOnce(
        buildBatch({
          status,
          carrierOrders: [buildCarrierOrder({ carrierOrderNo: 'HL001' })],
        }),
      );
      await expect(
        service.cancelCarrier('PSTH0000000000001', 'admin_1', 'changed'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(huolalaCarrier.cancelOrder).not.toHaveBeenCalled();

    tx.deliveryPickupBatch.findUnique
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.WAITING_DRIVER,
          carrierOrders: [buildCarrierOrder({ carrierOrderNo: 'HL001' })],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.WAITING_DRIVER,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              status: 'waiting_driver',
            }),
          ],
        }),
      )
      .mockResolvedValue(
        buildBatch({
          status: DeliveryPickupBatchStatus.CANCELED,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              status: 'canceled',
            }),
          ],
        }),
      );

    const result = await service.cancelCarrier('PSTH0000000000001', 'admin_1', 'changed');

    expect(huolalaCarrier.cancelOrder).toHaveBeenCalledWith({
      carrierOrderNo: 'HL001',
      reason: 'changed',
    });
    expect(result.status).toBe(DeliveryPickupBatchStatus.CANCELED);
  });

  it('re-checks latest batch status before final cancel write and refuses loaded batches', async () => {
    tx.deliveryPickupBatch.findUnique
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.WAITING_DRIVER,
          carrierOrders: [buildCarrierOrder({ carrierOrderNo: 'HL001' })],
        }),
      )
      .mockResolvedValueOnce(
        buildBatch({
          status: DeliveryPickupBatchStatus.LOADED,
          carrierOrders: [buildCarrierOrder({ carrierOrderNo: 'HL001' })],
        }),
      );

    await expect(
      service.cancelCarrier('PSTH0000000000001', 'admin_1', 'changed'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(huolalaCarrier.cancelOrder).toHaveBeenCalledTimes(1);
    expect(tx.deliveryPickupBatch.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DeliveryPickupBatchStatus.CANCELED,
        }),
      }),
    );
    expect(tx.deliveryCarrierOrder.update).not.toHaveBeenCalled();
  });

  it('passes raw manual adjustment amount strings from controller to strict service validation', async () => {
    const controllerService = {
      manualAdjustCost: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new DeliveryAdminPickupController(controllerService as any);

    await controller.manualAdjustCost('admin_1', 'PSTH0000000000001', '100abc', 'manual fix');

    expect(controllerService.manualAdjustCost).toHaveBeenCalledWith(
      'PSTH0000000000001',
      'admin_1',
      '100abc',
      'manual fix',
    );
  });

  describe('DeliveryPickupService seller flows', () => {
    it('lists only batches for the seller merchantId', async () => {
      deliveryPrisma.deliveryPickupBatch.count.mockResolvedValue(1);
      deliveryPrisma.deliveryPickupBatch.findMany.mockResolvedValue([
        buildBatch({
          status: DeliveryPickupBatchStatus.PLANNED,
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              priceCalculateId: 'price_calc_001',
              estimatedFeeCents: 320,
              actualFeeCents: 380,
            }),
          ],
        }),
      ]);

      const result = await service.listSellerPickupBatches('merchant_1', {
        page: '2',
        pageSize: '5',
        status: DeliveryPickupBatchStatus.PLANNED,
      });

      expect(deliveryPrisma.deliveryPickupBatch.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          merchantId: 'merchant_1',
          status: DeliveryPickupBatchStatus.PLANNED,
        }),
      });
      expect(deliveryPrisma.deliveryPickupBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            merchantId: 'merchant_1',
            status: DeliveryPickupBatchStatus.PLANNED,
          }),
          skip: 5,
          take: 5,
        }),
      );
      expect(result).toMatchObject({
        total: 1,
        page: 2,
        pageSize: 5,
      });
      expect(result.items).toHaveLength(1);
      assertSellerPickupBatchHidesCosts(result.items[0]);
    });

    it('omits prepaid and actual freight fields from seller batch views', async () => {
      deliveryPrisma.deliveryPickupBatch.findFirst.mockResolvedValue(
        buildBatch({
          estimatedShippingFeeCents: 600,
          actualCarrierCostCents: 760,
          shippingCostDiffCents: 160,
          costLedgers: [{ id: 'ledger_estimate_1', amountCents: 600 }],
          costLedgersBySubOrder: [{ id: 'ledger_actual_1', amountCents: 760 }],
          carrierOrders: [
            buildCarrierOrder({
              carrierOrderNo: 'HL001',
              priceCalculateId: 'price_calc_001',
              estimatedFeeCents: 600,
              actualFeeCents: 760,
              driverSnapshot: { name: 'driver-a' },
              vehicleSnapshot: { plateNo: '粤A12345' },
            }),
          ],
        }),
      );

      const result = await service.getSellerPickupBatch('merchant_1', 'PSTH0000000000001');

      expect(deliveryPrisma.deliveryPickupBatch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'PSTH0000000000001',
            merchantId: 'merchant_1',
          },
        }),
      );
      expect(result).toMatchObject({
        id: 'PSTH0000000000001',
        merchantId: 'merchant_1',
        latestCarrierOrder: expect.objectContaining({
          carrierOrderNo: 'HL001',
          driverSnapshot: { name: 'driver-a' },
          vehicleSnapshot: { plateNo: '粤A12345' },
        }),
      });
      assertSellerPickupBatchHidesCosts(result);
    });

    it('marks a planned batch ready and writes seller audit log', async () => {
      tx.deliveryPickupBatch.findFirst
        .mockResolvedValueOnce(buildBatch({ status: DeliveryPickupBatchStatus.PLANNED }))
        .mockResolvedValueOnce(
          buildBatch({
            status: DeliveryPickupBatchStatus.READY_TO_CALL,
            readyAt: now,
          }),
        );

      const result = await service.markReady(
        'merchant_1',
        'staff_1',
        'PSTH0000000000001',
      );

      expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(tx.deliveryPickupBatch.update).toHaveBeenCalledWith({
        where: { id: 'PSTH0000000000001' },
        data: expect.objectContaining({
          status: DeliveryPickupBatchStatus.READY_TO_CALL,
          readyAt: now,
          lastOperatorType: DeliveryAuditActorType.SELLER,
          lastOperatorId: 'staff_1',
        }),
      });
      expect(tx.deliveryAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: DeliveryAuditActorType.SELLER,
          actorId: 'staff_1',
          module: 'delivery-pickup',
          action: 'SELLER_MARK_READY',
          targetId: 'PSTH0000000000001',
        }),
      });
      expect(result.status).toBe(DeliveryPickupBatchStatus.READY_TO_CALL);
      assertSellerPickupBatchHidesCosts(result);
    });

    it('marks an arrived batch loaded and does not complete quantities until carrier completion sync', async () => {
      tx.deliveryPickupBatch.findFirst
        .mockResolvedValueOnce(
          buildBatch({
            status: DeliveryPickupBatchStatus.ARRIVED,
          }),
        )
        .mockResolvedValueOnce(
          buildBatch({
            status: DeliveryPickupBatchStatus.LOADED,
            loadedAt: now,
            items: [
              {
                id: 'batch_item_1',
                batchId: 'PSTH0000000000001',
                subOrderId: 'PSZDD000000000001',
                orderItemId: 'order_item_1',
                skuId: 'sku_1',
                productSnapshot: {
                  productTitle: '西红柿',
                  skuTitle: '5kg/箱',
                  unitName: '箱',
                },
                quantity: 2,
                pickedQuantity: 0,
                createdAt: new Date('2026-06-30T10:00:00.000Z'),
              },
            ],
          }),
        );

      const result = await service.markLoaded(
        'merchant_1',
        'staff_1',
        'PSTH0000000000001',
      );

      expect(tx.deliveryPickupBatch.update).toHaveBeenCalledWith({
        where: { id: 'PSTH0000000000001' },
        data: expect.objectContaining({
          status: DeliveryPickupBatchStatus.LOADED,
          loadedAt: now,
          lastOperatorType: DeliveryAuditActorType.SELLER,
          lastOperatorId: 'staff_1',
        }),
      });
      expect(tx.deliveryPickupBatchItem.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe(DeliveryPickupBatchStatus.LOADED);
      expect(result.items[0]).toMatchObject({
        quantity: 2,
        pickedQuantity: 0,
      });
      assertSellerPickupBatchHidesCosts(result);
    });

    it('records seller exception reports without exposing cost fields', async () => {
      tx.deliveryPickupBatch.findFirst
        .mockResolvedValueOnce(
          buildBatch({
            status: DeliveryPickupBatchStatus.DRIVER_ASSIGNED,
            estimatedShippingFeeCents: 600,
            actualCarrierCostCents: 760,
            shippingCostDiffCents: 160,
            carrierOrders: [
              buildCarrierOrder({
                carrierOrderNo: 'HL001',
                estimatedFeeCents: 600,
                actualFeeCents: 760,
              }),
            ],
          }),
        )
        .mockResolvedValueOnce(
          buildBatch({
            status: DeliveryPickupBatchStatus.EXCEPTION,
            remark: '司机联系不上',
            estimatedShippingFeeCents: 600,
            actualCarrierCostCents: 760,
            shippingCostDiffCents: 160,
            carrierOrders: [
              buildCarrierOrder({
                carrierOrderNo: 'HL001',
                estimatedFeeCents: 600,
                actualFeeCents: 760,
              }),
            ],
          }),
        );

      const result = await service.reportException(
        'merchant_1',
        'staff_1',
        'PSTH0000000000001',
        '  司机联系不上  ',
      );

      expect(tx.deliveryPickupBatch.update).toHaveBeenCalledWith({
        where: { id: 'PSTH0000000000001' },
        data: expect.objectContaining({
          status: DeliveryPickupBatchStatus.EXCEPTION,
          remark: '司机联系不上',
          lastOperatorType: DeliveryAuditActorType.SELLER,
          lastOperatorId: 'staff_1',
        }),
      });
      expect(tx.deliveryAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorType: DeliveryAuditActorType.SELLER,
          actorId: 'staff_1',
          module: 'delivery-pickup',
          action: 'SELLER_REPORT_EXCEPTION',
          targetId: 'PSTH0000000000001',
        }),
      });
      expect(result).toMatchObject({
        status: DeliveryPickupBatchStatus.EXCEPTION,
      });
      assertSellerPickupBatchHidesCosts(result);
    });

    it('rejects operations for wrong merchantId and terminal statuses', async () => {
      tx.deliveryPickupBatch.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.markReady('merchant_other', 'staff_1', 'PSTH0000000000001'),
      ).rejects.toBeInstanceOf(NotFoundException);

      tx.deliveryPickupBatch.findFirst.mockResolvedValueOnce(
        buildBatch({ status: DeliveryPickupBatchStatus.COMPLETED }),
      );
      await expect(
        service.markReady('merchant_1', 'staff_1', 'PSTH0000000000001'),
      ).rejects.toBeInstanceOf(BadRequestException);

      tx.deliveryPickupBatch.findFirst.mockResolvedValueOnce(
        buildBatch({ status: DeliveryPickupBatchStatus.PLANNED }),
      );
      await expect(
        service.markLoaded('merchant_1', 'staff_1', 'PSTH0000000000001'),
      ).rejects.toBeInstanceOf(BadRequestException);

      tx.deliveryPickupBatch.findFirst.mockResolvedValueOnce(
        buildBatch({ status: DeliveryPickupBatchStatus.CANCELED }),
      );
      await expect(
        service.reportException('merchant_1', 'staff_1', 'PSTH0000000000001', '异常'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.deliveryPickupBatch.update).not.toHaveBeenCalled();
      expect(tx.deliveryAuditLog.create).not.toHaveBeenCalled();
    });
  });
});

function createPrismaMock() {
  return {
    deliveryPickupBatch: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          estimatedShippingFeeCents: 600,
          actualCarrierCostCents: 380,
          shippingCostDiffCents: -220,
        },
      }),
      count: jest.fn(),
      findMany: jest.fn().mockResolvedValue([{ status: DeliveryPickupBatchStatus.DELIVERING }]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    deliveryPickupBatchItem: {
      updateMany: jest.fn(),
    },
    deliveryCarrierOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    deliveryShippingCostLedger: {
      create: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          amountCents: 0,
        },
      }),
    },
    deliveryOrder: {
      findUnique: jest.fn().mockResolvedValue({
        prepaidPickupShippingFeeCents: 600,
      }),
      update: jest.fn(),
    },
    deliverySubOrder: {
      update: jest.fn(),
    },
    deliveryAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit_1' }),
    },
  };
}

function assertSellerPickupBatchHidesCosts(batch: Record<string, any>) {
  for (const field of [
    'prepaidShippingFeeCents',
    'prepaidPickupShippingFeeCents',
    'estimatedShippingFeeCents',
    'actualCarrierCostCents',
    'shippingCostDiffCents',
    'costLedgers',
    'costLedgersBySubOrder',
  ]) {
    expect(batch).not.toHaveProperty(field);
  }
  if (batch.latestCarrierOrder) {
    for (const field of ['priceCalculateId', 'estimatedFeeCents', 'actualFeeCents']) {
      expect(batch.latestCarrierOrder).not.toHaveProperty(field);
    }
  }
}

function buildBatch(overrides: Record<string, unknown> = {}) {
  const carrierOrders = (overrides.carrierOrders as unknown[]) ?? [];
  return {
    id: 'PSTH0000000000001',
    orderId: 'PSDD0000000000001',
    subOrderId: 'PSZDD000000000001',
    merchantId: 'merchant_1',
    batchNo: 1,
    status: DeliveryPickupBatchStatus.READY_TO_CALL,
    provider: DeliveryCarrierProvider.HUOLALA,
    plannedPickupAt: null,
    readyAt: null,
    calledAt: null,
    loadedAt: null,
    completedAt: null,
    canceledAt: null,
    receiverSnapshot: null,
    senderSnapshot: null,
    cargoSnapshot: null,
    estimatedShippingFeeCents: 600,
    actualCarrierCostCents: null,
    shippingCostDiffCents: null,
    createdByAdminId: null,
    lastOperatorType: null,
    lastOperatorId: null,
    remark: null,
    createdAt: new Date('2026-06-30T10:00:00.000Z'),
    updatedAt: new Date('2026-06-30T10:00:00.000Z'),
    merchant: {
      id: 'merchant_1',
      name: '华南仓',
      contactName: '仓库负责人',
      contactPhone: '13800000001',
      servicePhone: '400-100',
      addressJson: {
        provinceName: '广东省',
        cityName: '广州市',
        cityCode: '440100',
        districtName: '天河区',
        detailAddress: '体育东路1号',
      },
    },
    order: {
      id: 'PSDD0000000000001',
      unitId: 'unit_1',
      pickupMode: 'MULTI_BATCH',
      plannedPickupCount: 2,
      pickupStatus: 'NOT_STARTED',
      prepaidPickupShippingFeeCents: 600,
      actualCarrierCostCents: 0,
      shippingCostDiffCents: 0,
      unitSnapshot: {
        id: 'unit_1',
        name: '青禾食堂',
      },
      addressSnapshot: {
        recipientName: '张三',
        phone: '13800000002',
        provinceName: '广东省',
        cityName: '广州市',
        cityCode: '440100',
        districtName: '海珠区',
        detailAddress: '新港中路2号',
      },
    },
    subOrder: {
      id: 'PSZDD000000000001',
      orderId: 'PSDD0000000000001',
      merchantId: 'merchant_1',
      pickupStatus: 'NOT_STARTED',
      status: 'PENDING_SHIPMENT',
    },
    items: [
      {
        id: 'batch_item_1',
        batchId: 'PSTH0000000000001',
        subOrderId: 'PSZDD000000000001',
        orderItemId: 'order_item_1',
        skuId: 'sku_1',
        productSnapshot: {
          productTitle: '西红柿',
          skuTitle: '5kg/箱',
          unitName: '箱',
          weightGram: 5000,
        },
        quantity: 2,
        pickedQuantity: 0,
        createdAt: new Date('2026-06-30T10:00:00.000Z'),
      },
    ],
    carrierOrders,
    ...overrides,
  };
}

function buildCarrierOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'PSCY0000000000001',
    batchId: 'PSTH0000000000001',
    provider: DeliveryCarrierProvider.HUOLALA,
    outsideOrderId: 'PSTH0000000000001',
    carrierOrderNo: null,
    priceCalculateId: null,
    cityId: '440100',
    vehicleId: 'small-van',
    payType: 'PLATFORM_MONTHLY',
    status: 'CALLING_CARRIER',
    driverSnapshot: null,
    vehicleSnapshot: null,
    estimatePayload: null,
    orderPayload: null,
    detailPayload: null,
    cancelPayload: null,
    estimatedFeeCents: null,
    actualFeeCents: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-06-30T10:00:00.000Z'),
    updatedAt: new Date('2026-06-30T10:00:00.000Z'),
    ...overrides,
  };
}
