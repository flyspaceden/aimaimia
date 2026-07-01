import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  DeliveryAuditActorType,
  DeliveryCarrierPaymentMode,
  DeliveryCarrierProvider,
  DeliveryPickupBatchStatus,
  DeliveryPickupStatus,
  DeliveryShippingCostLedgerType,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { HuolalaCarrierService } from '../carriers/huolala-carrier.service';
import {
  DeliveryCarrierQuoteRequest,
  DeliveryCarrierQuoteResult,
} from '../carriers/delivery-carrier.types';

export type DeliveryPickupAdminQuery = {
  page?: number | string;
  pageSize?: number | string;
  from?: string | Date;
  to?: string | Date;
  merchantId?: string;
  unitId?: string;
  status?: string;
};

export type DeliveryFreightDashboard = {
  prepaidPickupShippingFeeCents: number;
  actualCarrierCostCents: number;
  shippingCostDiffCents: number;
  exceptionBatchCount: number;
};

export type DeliveryPickupBatchView = {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  merchantName: string;
  unitId: string | null;
  batchNo: number;
  status: DeliveryPickupBatchStatus;
  provider: DeliveryCarrierProvider;
  plannedPickupAt: Date | null;
  readyAt: Date | null;
  calledAt: Date | null;
  loadedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  prepaidPickupShippingFeeCents: number;
  estimatedShippingFeeCents: number;
  actualCarrierCostCents: number;
  shippingCostDiffCents: number;
  pickupMode: string | null;
  plannedPickupCount: number | null;
  pickupStatus: string | null;
  items: Array<{
    id: string;
    orderItemId: string;
    skuId: string;
    productTitle: string;
    skuTitle: string;
    unitName: string;
    quantity: number;
    pickedQuantity: number;
  }>;
  latestCarrierOrder: {
    id: string;
    provider: DeliveryCarrierProvider;
    outsideOrderId: string;
    carrierOrderNo: string | null;
    priceCalculateId: string | null;
    cityId: string | null;
    vehicleId: string | null;
    status: string;
    driverSnapshot: unknown;
    vehicleSnapshot: unknown;
    estimatedFeeCents: number | null;
    actualFeeCents: number | null;
    lastSyncedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

type DeliveryPrismaTransaction = Prisma.TransactionClient;

const HUOLALA_QUOTE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_HUOLALA_VEHICLE_ID = 'small-van';
const DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE = {
  merchant: {
    select: {
      id: true,
      name: true,
      contactName: true,
      contactPhone: true,
      servicePhone: true,
      addressJson: true,
    },
  },
  order: {
    select: {
      id: true,
      unitId: true,
      pickupMode: true,
      plannedPickupCount: true,
      pickupStatus: true,
      prepaidPickupShippingFeeCents: true,
      actualCarrierCostCents: true,
      shippingCostDiffCents: true,
      unitSnapshot: true,
      addressSnapshot: true,
    },
  },
  subOrder: {
    select: {
      id: true,
      orderId: true,
      merchantId: true,
      status: true,
      pickupStatus: true,
    },
  },
  items: {
    orderBy: [{ createdAt: 'asc' as const }],
  },
  carrierOrders: {
    orderBy: [{ updatedAt: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 1,
  },
} satisfies Prisma.DeliveryPickupBatchInclude;

type PickupBatchWithAdminInclude = Prisma.DeliveryPickupBatchGetPayload<{
  include: typeof DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE;
}>;

@Injectable()
export class DeliveryPickupService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryIdService: DeliveryIdService,
    private readonly huolalaCarrier: HuolalaCarrierService,
  ) {}

  async getFreightDashboard(query: DeliveryPickupAdminQuery): Promise<DeliveryFreightDashboard> {
    const where = this.buildBatchWhere(query);
    const [aggregate, exceptionBatchCount] = await Promise.all([
      this.deliveryPrisma.deliveryPickupBatch.aggregate({
        where,
        _sum: {
          estimatedShippingFeeCents: true,
          actualCarrierCostCents: true,
          shippingCostDiffCents: true,
        },
      }),
      this.countExceptionBatches(where),
    ]);

    return {
      prepaidPickupShippingFeeCents: this.cents(aggregate._sum.estimatedShippingFeeCents),
      actualCarrierCostCents: this.cents(aggregate._sum.actualCarrierCostCents),
      shippingCostDiffCents: this.cents(aggregate._sum.shippingCostDiffCents),
      exceptionBatchCount,
    };
  }

  async listAdminPickupBatches(query: DeliveryPickupAdminQuery) {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = Math.min(this.parsePositiveInt(query.pageSize, 20), 100);
    const skip = (page - 1) * pageSize;
    const where = this.buildBatchWhere(query);

    const [total, batches] = await Promise.all([
      this.deliveryPrisma.deliveryPickupBatch.count({ where }),
      this.deliveryPrisma.deliveryPickupBatch.findMany({
        where,
        include: this.getAdminBatchInclude(),
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
    ]);

    return {
      items: batches.map((batch) => this.mapBatchView(batch)),
      total,
      page,
      pageSize,
    };
  }

  async callHuolala(batchId: string, adminId: string): Promise<DeliveryPickupBatchView> {
    this.assertAdminActor(adminId);
    const reservation = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const batch = await this.loadBatch(tx, batchId);
        this.assertCallableBatch(batch);

        const quoteRequest = this.buildQuoteRequest(batch);
        const existingCarrierOrder = this.latestCarrierOrder(batch);
        const carrierOrder =
          existingCarrierOrder ??
          (await tx.deliveryCarrierOrder.create({
            data: {
              id: await this.deliveryIdService.nextInTransaction(tx, 'PSCY'),
              batchId: batch.id,
              provider: DeliveryCarrierProvider.HUOLALA,
              outsideOrderId: batch.id,
              cityId: quoteRequest.cityId,
              vehicleId: quoteRequest.vehicleId,
              payType: DeliveryCarrierPaymentMode.PLATFORM_MONTHLY,
              status: DeliveryPickupBatchStatus.CALLING_CARRIER,
            },
          }));

        await tx.deliveryPickupBatch.update({
          where: { id: batch.id },
          data: {
            status: DeliveryPickupBatchStatus.CALLING_CARRIER,
            calledAt: batch.calledAt ?? new Date(),
            lastOperatorType: DeliveryAuditActorType.ADMIN,
            lastOperatorId: adminId,
          },
        });

        return {
          batch,
          carrierOrder,
          quoteRequest,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const quote = this.shouldRefreshQuote(reservation.carrierOrder)
      ? await this.huolalaCarrier.quote(reservation.quoteRequest)
      : null;
    const priceCalculateId = quote?.priceCalculateId ?? reservation.carrierOrder.priceCalculateId;
    if (!priceCalculateId) {
      throw new BadRequestException('货拉拉报价缺失，无法叫车');
    }

    const carrierResult = await this.huolalaCarrier.requestOrder({
      ...reservation.quoteRequest,
      priceCalculateId,
    });
    const mappedStatus = this.huolalaCarrier.mapHuolalaStatus(carrierResult.status);

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        const latestBatch = await this.loadBatch(tx, batchId);
        const latestCarrierOrder = this.latestCarrierOrder(latestBatch);
        if (!latestCarrierOrder) {
          throw new BadRequestException('货拉拉运力单不存在，请刷新后重试');
        }
        if (
          latestCarrierOrder.carrierOrderNo &&
          latestCarrierOrder.carrierOrderNo !== carrierResult.carrierOrderNo
        ) {
          throw new BadRequestException('该提货批次已叫车，请刷新后查看');
        }

        await tx.deliveryCarrierOrder.update({
          where: { id: latestCarrierOrder.id },
          data: {
            priceCalculateId,
            carrierOrderNo: carrierResult.carrierOrderNo,
            status: carrierResult.status,
            estimatedFeeCents: quote?.estimatedFeeCents ?? latestCarrierOrder.estimatedFeeCents,
            estimatePayload: quote ? this.toJson(quote.rawPayload) : undefined,
            orderPayload: this.toJson(carrierResult.rawPayload),
          },
        });

        await tx.deliveryPickupBatch.update({
          where: { id: latestBatch.id },
          data: {
            status: mappedStatus,
            calledAt: latestBatch.calledAt ?? new Date(),
            lastOperatorType: DeliveryAuditActorType.ADMIN,
            lastOperatorId: adminId,
          },
        });

        if (quote) {
          await this.writeEstimateLedgerIfNeeded(tx, latestBatch, quote, adminId);
        }
        await this.refreshPickupStatuses(tx, latestBatch.orderId, latestBatch.subOrderId);
        await this.writeAuditLog(tx, adminId, {
          action: 'CALL_HUOLALA',
          targetId: latestBatch.id,
          summary: '配送提货批次叫货拉拉',
          before: this.toAuditPayload(latestBatch),
          after: {
            carrierOrderNo: carrierResult.carrierOrderNo,
            status: mappedStatus,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getBatchViewById(batchId);
  }

  async syncCarrier(batchId: string, adminId: string): Promise<DeliveryPickupBatchView> {
    this.assertAdminActor(adminId);
    const batch = await this.loadBatch(this.deliveryPrisma, batchId);
    const carrierOrder = this.latestCarrierOrder(batch);
    if (!carrierOrder) {
      throw new BadRequestException('该提货批次尚未创建货拉拉运力单');
    }

    const detail = await this.huolalaCarrier.getOrderDetail({
      carrierOrderNo: carrierOrder.carrierOrderNo ?? undefined,
      outsideOrderId: carrierOrder.outsideOrderId || batch.id,
    });

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        const latestBatch = await this.loadBatch(tx, batchId);
        const latestCarrierOrder = this.latestCarrierOrder(latestBatch);
        if (!latestCarrierOrder) {
          throw new BadRequestException('该提货批次尚未创建货拉拉运力单');
        }

        await tx.deliveryCarrierOrder.update({
          where: { id: latestCarrierOrder.id },
          data: {
            carrierOrderNo: detail.carrierOrderNo,
            status: detail.status,
            estimatedFeeCents: detail.estimatedFeeCents ?? latestCarrierOrder.estimatedFeeCents,
            actualFeeCents: detail.actualFeeCents ?? latestCarrierOrder.actualFeeCents,
            driverSnapshot: this.toNullableJson(detail.driverSnapshot),
            vehicleSnapshot: this.toNullableJson(detail.vehicleSnapshot),
            detailPayload: this.toJson(detail.rawPayload),
            lastSyncedAt: new Date(),
          },
        });

        const manualAdjustmentCents = await this.sumManualAdjustments(tx, latestBatch.id);
        const actualCarrierCostCents =
          typeof detail.actualFeeCents === 'number'
            ? Math.max(0, Math.trunc(detail.actualFeeCents) + manualAdjustmentCents)
            : this.cents(latestBatch.actualCarrierCostCents);
        const prepaidPickupShippingFeeCents = this.cents(latestBatch.estimatedShippingFeeCents);
        await tx.deliveryPickupBatch.update({
          where: { id: latestBatch.id },
          data: {
            status: detail.mappedStatus,
            actualCarrierCostCents,
            shippingCostDiffCents: actualCarrierCostCents - prepaidPickupShippingFeeCents,
            lastOperatorType: DeliveryAuditActorType.ADMIN,
            lastOperatorId: adminId,
          },
        });

        if (typeof detail.actualFeeCents === 'number') {
          await this.writeActualLedgerIfNeeded(tx, latestBatch, detail, adminId);
        }
        await this.refreshOrderFreightAggregate(tx, latestBatch.orderId);
        await this.refreshPickupStatuses(tx, latestBatch.orderId, latestBatch.subOrderId);
        await this.writeAuditLog(tx, adminId, {
          action: 'SYNC_CARRIER',
          targetId: latestBatch.id,
          summary: '同步货拉拉提货批次',
          before: this.toAuditPayload(latestBatch),
          after: {
            carrierOrderNo: detail.carrierOrderNo,
            status: detail.mappedStatus,
            actualCarrierCostCents,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getBatchViewById(batchId);
  }

  async cancelCarrier(batchId: string, adminId: string, reason: string): Promise<DeliveryPickupBatchView> {
    this.assertAdminActor(adminId);
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new BadRequestException('取消原因不能为空');
    }

    const batch = await this.loadBatch(this.deliveryPrisma, batchId);
    const nonCancelableStatuses: DeliveryPickupBatchStatus[] = [
        DeliveryPickupBatchStatus.LOADED,
        DeliveryPickupBatchStatus.DELIVERING,
        DeliveryPickupBatchStatus.COMPLETED,
    ];
    if (nonCancelableStatuses.includes(batch.status)) {
      throw new BadRequestException(`该提货批次当前状态不可取消: ${batch.status}`);
    }
    const carrierOrder = this.latestCarrierOrder(batch);
    if (!carrierOrder?.carrierOrderNo) {
      throw new BadRequestException('该提货批次尚未叫车，无法取消货拉拉订单');
    }

    const cancelResult = await this.huolalaCarrier.cancelOrder({
      carrierOrderNo: carrierOrder.carrierOrderNo,
      reason: trimmedReason,
    });

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        const latestBatch = await this.loadBatch(tx, batchId);
        await tx.deliveryCarrierOrder.update({
          where: { id: carrierOrder.id },
          data: {
            status: cancelResult.status,
            cancelPayload: this.toJson(cancelResult.rawPayload),
          },
        });
        await tx.deliveryPickupBatch.update({
          where: { id: latestBatch.id },
          data: {
            status: DeliveryPickupBatchStatus.CANCELED,
            canceledAt: latestBatch.canceledAt ?? new Date(),
            remark: trimmedReason,
            lastOperatorType: DeliveryAuditActorType.ADMIN,
            lastOperatorId: adminId,
          },
        });
        await this.refreshPickupStatuses(tx, latestBatch.orderId, latestBatch.subOrderId);
        await this.writeAuditLog(tx, adminId, {
          action: 'CANCEL_CARRIER',
          targetId: latestBatch.id,
          summary: '取消货拉拉提货批次',
          before: this.toAuditPayload(latestBatch),
          after: {
            status: DeliveryPickupBatchStatus.CANCELED,
            reason: trimmedReason,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getBatchViewById(batchId);
  }

  async manualAdjustCost(
    batchId: string,
    adminId: string,
    amountCents: number,
    remark: string,
  ): Promise<DeliveryPickupBatchView> {
    this.assertAdminActor(adminId);
    const normalizedAmount = Number(amountCents);
    if (!Number.isFinite(normalizedAmount) || !Number.isInteger(normalizedAmount) || normalizedAmount === 0) {
      throw new BadRequestException('调整金额必须是非零整数分');
    }
    const trimmedRemark = remark?.trim();
    if (!trimmedRemark) {
      throw new BadRequestException('成本调整备注不能为空');
    }

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        const batch = await this.loadBatch(tx, batchId);
        const nextActualCarrierCostCents = Math.max(
          0,
          this.cents(batch.actualCarrierCostCents) + normalizedAmount,
        );
        const prepaidPickupShippingFeeCents = this.cents(batch.estimatedShippingFeeCents);

        await tx.deliveryShippingCostLedger.create({
          data: {
            orderId: batch.orderId,
            subOrderId: batch.subOrderId,
            batchId: batch.id,
            provider: DeliveryCarrierProvider.MANUAL,
            type: DeliveryShippingCostLedgerType.MANUAL_ADJUSTMENT,
            amountCents: normalizedAmount,
            source: 'ADMIN_MANUAL_ADJUSTMENT',
            sourceRefId: null,
            payloadSnapshot: this.toJson({ remark: trimmedRemark }),
            createdByType: DeliveryAuditActorType.ADMIN,
            createdById: adminId,
          },
        });
        await tx.deliveryPickupBatch.update({
          where: { id: batch.id },
          data: {
            actualCarrierCostCents: nextActualCarrierCostCents,
            shippingCostDiffCents: nextActualCarrierCostCents - prepaidPickupShippingFeeCents,
            lastOperatorType: DeliveryAuditActorType.ADMIN,
            lastOperatorId: adminId,
          },
        });
        await this.refreshOrderFreightAggregate(tx, batch.orderId);
        await this.writeAuditLog(tx, adminId, {
          action: 'MANUAL_ADJUST_COST',
          targetId: batch.id,
          summary: '手动调整提货运费成本',
          before: this.toAuditPayload(batch),
          after: {
            amountCents: normalizedAmount,
            remark: trimmedRemark,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getBatchViewById(batchId);
  }

  private async getBatchViewById(batchId: string) {
    const batch = await this.loadBatch(this.deliveryPrisma, batchId);
    return this.mapBatchView(batch);
  }

  private async loadBatch(client: Pick<DeliveryPrismaService, 'deliveryPickupBatch'>, batchId: string) {
    const batch = await client.deliveryPickupBatch.findUnique({
      where: { id: batchId },
      include: this.getAdminBatchInclude(),
    });
    if (!batch) {
      throw new NotFoundException('提货批次不存在');
    }
    return batch;
  }

  private getAdminBatchInclude() {
    return DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE;
  }

  private buildBatchWhere(query: DeliveryPickupAdminQuery): Prisma.DeliveryPickupBatchWhereInput {
    const where: Prisma.DeliveryPickupBatchWhereInput = {};
    if (query.merchantId?.trim()) {
      where.merchantId = query.merchantId.trim();
    }
    if (query.unitId?.trim()) {
      where.order = { unitId: query.unitId.trim() };
    }
    if (query.status?.trim()) {
      where.status = query.status.trim() as DeliveryPickupBatchStatus;
    }

    const createdAt: Prisma.DateTimeFilter = {};
    const from = this.parseDate(query.from);
    const to = this.parseDate(query.to);
    if (from) {
      createdAt.gte = from;
    }
    if (to) {
      createdAt.lte = to;
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }
    return where;
  }

  private async countExceptionBatches(where: Prisma.DeliveryPickupBatchWhereInput) {
    if (where.status && where.status !== DeliveryPickupBatchStatus.EXCEPTION) {
      return 0;
    }
    return this.deliveryPrisma.deliveryPickupBatch.count({
      where: {
        ...where,
        status: DeliveryPickupBatchStatus.EXCEPTION,
      },
    });
  }

  private assertAdminActor(adminId: string) {
    if (!adminId?.trim()) {
      throw new BadRequestException('缺少管理员操作人');
    }
  }

  private assertCallableBatch(batch: PickupBatchWithAdminInclude) {
    const terminalStatuses: DeliveryPickupBatchStatus[] = [
      DeliveryPickupBatchStatus.COMPLETED,
      DeliveryPickupBatchStatus.CANCELED,
    ];
    if (terminalStatuses.includes(batch.status)) {
      throw new BadRequestException(`该提货批次当前状态不可叫车: ${batch.status}`);
    }
    const latestCarrierOrder = this.latestCarrierOrder(batch);
    if (latestCarrierOrder?.carrierOrderNo) {
      throw new BadRequestException('该提货批次已叫车，请勿重复操作');
    }
    const alreadyCallingOrDispatchedStatuses: DeliveryPickupBatchStatus[] = [
      DeliveryPickupBatchStatus.CALLING_CARRIER,
      DeliveryPickupBatchStatus.WAITING_DRIVER,
      DeliveryPickupBatchStatus.DRIVER_ASSIGNED,
      DeliveryPickupBatchStatus.ARRIVED,
      DeliveryPickupBatchStatus.LOADED,
      DeliveryPickupBatchStatus.DELIVERING,
    ];
    if (alreadyCallingOrDispatchedStatuses.includes(batch.status)) {
      throw new BadRequestException(`该提货批次当前状态不可重复叫车: ${batch.status}`);
    }
  }

  private shouldRefreshQuote(carrierOrder: PickupBatchWithAdminInclude['carrierOrders'][number]) {
    if (!carrierOrder.priceCalculateId) {
      return true;
    }
    return Date.now() - carrierOrder.updatedAt.getTime() > HUOLALA_QUOTE_TTL_MS;
  }

  private latestCarrierOrder(batch: Pick<PickupBatchWithAdminInclude, 'carrierOrders'>) {
    return batch.carrierOrders[0] ?? null;
  }

  private buildQuoteRequest(
    batch: PickupBatchWithAdminInclude,
    carrierOrder?: PickupBatchWithAdminInclude['carrierOrders'][number],
  ): DeliveryCarrierQuoteRequest {
    const sender = this.buildSender(batch);
    const receiver = this.buildReceiver(batch);
    const cargo = this.buildCargo(batch);
    const address = this.asRecord(batch.order.addressSnapshot);
    const cargoSnapshot = this.asRecord(batch.cargoSnapshot);

    return {
      outsideOrderId: batch.id,
      cityId:
        carrierOrder?.cityId ||
        this.asString(cargoSnapshot.cityId) ||
        this.asString(address.cityId) ||
        this.asString(address.cityCode) ||
        receiver.city,
      vehicleId:
        carrierOrder?.vehicleId ||
        this.asString(cargoSnapshot.vehicleId) ||
        DEFAULT_HUOLALA_VEHICLE_ID,
      sender,
      receiver,
      cargo,
      plannedPickupAt: batch.plannedPickupAt ?? undefined,
    };
  }

  private buildSender(batch: PickupBatchWithAdminInclude): DeliveryCarrierQuoteRequest['sender'] {
    const senderSnapshot = this.asRecord(batch.senderSnapshot);
    const merchantAddress = this.asRecord(batch.merchant.addressJson);
    const source = Object.keys(senderSnapshot).length > 0 ? senderSnapshot : merchantAddress;
    const sender = {
      name:
        this.asString(senderSnapshot.name) ||
        this.asString(senderSnapshot.contactName) ||
        batch.merchant.contactName ||
        batch.merchant.name,
      phone:
        this.asString(senderSnapshot.phone) ||
        this.asString(senderSnapshot.tel) ||
        batch.merchant.contactPhone ||
        batch.merchant.servicePhone ||
        '',
      province: this.getAddressPart(source, ['provinceName', 'province']),
      city: this.getAddressPart(source, ['cityName', 'city']),
      district: this.getAddressPart(source, ['districtName', 'district']),
      detail: this.getAddressPart(source, ['detailAddress', 'detail']),
      lat: this.asOptionalNumber(source.lat),
      lng: this.asOptionalNumber(source.lng),
    };
    this.assertCarrierParty(sender, '配送商家发件地址');
    return sender;
  }

  private buildReceiver(batch: PickupBatchWithAdminInclude): DeliveryCarrierQuoteRequest['receiver'] {
    const receiverSnapshot = this.asRecord(batch.receiverSnapshot);
    const orderAddress = this.asRecord(batch.order.addressSnapshot);
    const source = Object.keys(receiverSnapshot).length > 0 ? receiverSnapshot : orderAddress;
    const receiver = {
      name: this.asString(source.name) || this.asString(source.recipientName),
      phone: this.asString(source.phone) || this.asString(source.tel),
      province: this.getAddressPart(source, ['provinceName', 'province']),
      city: this.getAddressPart(source, ['cityName', 'city']),
      district: this.getAddressPart(source, ['districtName', 'district']),
      detail: this.getAddressPart(source, ['detailAddress', 'detail']),
      lat: this.asOptionalNumber(source.lat),
      lng: this.asOptionalNumber(source.lng),
    };
    this.assertCarrierParty(receiver, '配送订单收件地址');
    return receiver;
  }

  private buildCargo(batch: PickupBatchWithAdminInclude): DeliveryCarrierQuoteRequest['cargo'] {
    const cargoSnapshot = this.asRecord(batch.cargoSnapshot);
    const firstItem = batch.items[0] ?? null;
    const firstItemSnapshot = this.asRecord(firstItem?.productSnapshot);
    const name =
      this.asString(cargoSnapshot.name) ||
      this.asString(firstItemSnapshot.productTitle) ||
      this.asString(firstItemSnapshot.title) ||
      '配送商品';
    const quantity =
      this.asOptionalNumber(cargoSnapshot.quantity) ??
      batch.items.reduce((sum, item) => sum + item.quantity, 0);
    const computedWeightKg = batch.items.reduce((sum, item) => {
      const snapshot = this.asRecord(item.productSnapshot);
      const weightGram = this.asOptionalNumber(snapshot.weightGram) ?? 0;
      return sum + (weightGram * item.quantity) / 1000;
    }, 0);

    return {
      name,
      quantity: Math.max(1, Math.trunc(quantity || 1)),
      weightKg: Math.max(0.1, this.asOptionalNumber(cargoSnapshot.weightKg) ?? (computedWeightKg || 1)),
      remark: this.asString(cargoSnapshot.remark) || undefined,
    };
  }

  private assertCarrierParty(party: DeliveryCarrierQuoteRequest['sender'], label: string) {
    if (!party.name || !party.phone || !party.province || !party.city || !party.detail) {
      throw new BadRequestException(`${label}缺少姓名/电话/省市详细地址，无法叫货拉拉`);
    }
  }

  private async writeEstimateLedgerIfNeeded(
    tx: DeliveryPrismaTransaction,
    batch: PickupBatchWithAdminInclude,
    quote: DeliveryCarrierQuoteResult,
    adminId: string,
  ) {
    const existing = await tx.deliveryShippingCostLedger.findFirst({
      where: {
        batchId: batch.id,
        type: DeliveryShippingCostLedgerType.CARRIER_ESTIMATE,
        source: 'HUOLALA_QUOTE',
        sourceRefId: quote.priceCalculateId,
      },
    });
    if (existing) {
      return;
    }

    await tx.deliveryShippingCostLedger.create({
      data: {
        orderId: batch.orderId,
        subOrderId: batch.subOrderId,
        batchId: batch.id,
        provider: DeliveryCarrierProvider.HUOLALA,
        type: DeliveryShippingCostLedgerType.CARRIER_ESTIMATE,
        amountCents: quote.estimatedFeeCents,
        source: 'HUOLALA_QUOTE',
        sourceRefId: quote.priceCalculateId,
        payloadSnapshot: this.toJson(quote.rawPayload),
        createdByType: DeliveryAuditActorType.ADMIN,
        createdById: adminId,
      },
    });
  }

  private async writeActualLedgerIfNeeded(
    tx: DeliveryPrismaTransaction,
    batch: PickupBatchWithAdminInclude,
    detail: {
      carrierOrderNo: string;
      actualFeeCents?: number;
      rawPayload: unknown;
    },
    adminId: string,
  ) {
    const sourceRefId = `${detail.carrierOrderNo}:${this.hashJson(detail.rawPayload)}`;
    const existing = await tx.deliveryShippingCostLedger.findFirst({
      where: {
        batchId: batch.id,
        type: DeliveryShippingCostLedgerType.CARRIER_ACTUAL,
        source: 'HUOLALA_DETAIL',
        sourceRefId,
      },
    });
    if (existing) {
      return;
    }

    await tx.deliveryShippingCostLedger.create({
      data: {
        orderId: batch.orderId,
        subOrderId: batch.subOrderId,
        batchId: batch.id,
        provider: DeliveryCarrierProvider.HUOLALA,
        type: DeliveryShippingCostLedgerType.CARRIER_ACTUAL,
        amountCents: Math.trunc(detail.actualFeeCents ?? 0),
        source: 'HUOLALA_DETAIL',
        sourceRefId,
        payloadSnapshot: this.toJson(detail.rawPayload),
        createdByType: DeliveryAuditActorType.ADMIN,
        createdById: adminId,
      },
    });
  }

  private async sumManualAdjustments(tx: DeliveryPrismaTransaction, batchId: string) {
    const result = await tx.deliveryShippingCostLedger.aggregate({
      where: {
        batchId,
        type: DeliveryShippingCostLedgerType.MANUAL_ADJUSTMENT,
      },
      _sum: {
        amountCents: true,
      },
    });
    return this.cents(result._sum.amountCents);
  }

  private async refreshOrderFreightAggregate(tx: DeliveryPrismaTransaction, orderId: string) {
    const [order, aggregate] = await Promise.all([
      tx.deliveryOrder.findUnique({
        where: { id: orderId },
        select: {
          prepaidPickupShippingFeeCents: true,
        },
      }),
      tx.deliveryPickupBatch.aggregate({
        where: { orderId },
        _sum: {
          actualCarrierCostCents: true,
        },
      }),
    ]);
    if (!order) {
      throw new NotFoundException('配送订单不存在');
    }
    const actualCarrierCostCents = this.cents(aggregate._sum.actualCarrierCostCents);
    await tx.deliveryOrder.update({
      where: { id: orderId },
      data: {
        actualCarrierCostCents,
        shippingCostDiffCents: actualCarrierCostCents - this.cents(order.prepaidPickupShippingFeeCents),
      },
    });
  }

  private async refreshPickupStatuses(
    tx: DeliveryPrismaTransaction,
    orderId: string,
    subOrderId: string,
  ) {
    const [orderBatches, subOrderBatches] = await Promise.all([
      tx.deliveryPickupBatch.findMany({
        where: { orderId },
        select: { status: true },
      }),
      tx.deliveryPickupBatch.findMany({
        where: { subOrderId },
        select: { status: true },
      }),
    ]);

    await Promise.all([
      tx.deliveryOrder.update({
        where: { id: orderId },
        data: { pickupStatus: this.resolvePickupStatus(orderBatches.map((batch) => batch.status)) },
      }),
      tx.deliverySubOrder.update({
        where: { id: subOrderId },
        data: { pickupStatus: this.resolvePickupStatus(subOrderBatches.map((batch) => batch.status)) },
      }),
    ]);
  }

  private resolvePickupStatus(statuses: DeliveryPickupBatchStatus[]): DeliveryPickupStatus {
    if (statuses.length === 0) {
      return DeliveryPickupStatus.NOT_STARTED;
    }
    if (statuses.every((status) => status === DeliveryPickupBatchStatus.CANCELED)) {
      return DeliveryPickupStatus.CANCELED;
    }
    if (statuses.every((status) => status === DeliveryPickupBatchStatus.COMPLETED)) {
      return DeliveryPickupStatus.ALL_PICKED;
    }
    if (
      statuses.some((status) => {
        const activeStatuses: DeliveryPickupBatchStatus[] = [
          DeliveryPickupBatchStatus.LOADED,
          DeliveryPickupBatchStatus.DELIVERING,
          DeliveryPickupBatchStatus.COMPLETED,
        ];
        return activeStatuses.includes(status);
      })
    ) {
      return DeliveryPickupStatus.PARTIAL_PICKED;
    }
    return DeliveryPickupStatus.NOT_STARTED;
  }

  private async writeAuditLog(
    tx: DeliveryPrismaTransaction,
    adminId: string,
    input: {
      action: string;
      targetId: string;
      summary: string;
      before: unknown;
      after: unknown;
    },
  ) {
    await tx.deliveryAuditLog.create({
      data: {
        actorType: DeliveryAuditActorType.ADMIN,
        actorId: adminId,
        module: 'delivery-pickup',
        action: input.action,
        targetType: 'DeliveryPickupBatch',
        targetId: input.targetId,
        summary: input.summary,
        before: this.toJson(input.before),
        after: this.toJson(input.after),
      },
    });
  }

  private mapBatchView(batch: PickupBatchWithAdminInclude): DeliveryPickupBatchView {
    const latestCarrierOrder = this.latestCarrierOrder(batch);
    const prepaidPickupShippingFeeCents = this.cents(batch.estimatedShippingFeeCents);
    const actualCarrierCostCents = this.cents(batch.actualCarrierCostCents);
    const shippingCostDiffCents =
      batch.shippingCostDiffCents ?? actualCarrierCostCents - prepaidPickupShippingFeeCents;

    return {
      id: batch.id,
      orderId: batch.orderId,
      subOrderId: batch.subOrderId,
      merchantId: batch.merchantId,
      merchantName: batch.merchant.name,
      unitId: batch.order.unitId ?? null,
      batchNo: batch.batchNo,
      status: batch.status,
      provider: batch.provider,
      plannedPickupAt: batch.plannedPickupAt,
      readyAt: batch.readyAt,
      calledAt: batch.calledAt,
      loadedAt: batch.loadedAt,
      completedAt: batch.completedAt,
      canceledAt: batch.canceledAt,
      prepaidPickupShippingFeeCents,
      estimatedShippingFeeCents: prepaidPickupShippingFeeCents,
      actualCarrierCostCents,
      shippingCostDiffCents,
      pickupMode: batch.order.pickupMode,
      plannedPickupCount: batch.order.plannedPickupCount,
      pickupStatus: batch.order.pickupStatus,
      items: batch.items.map((item) => {
        const snapshot = this.asRecord(item.productSnapshot);
        return {
          id: item.id,
          orderItemId: item.orderItemId,
          skuId: item.skuId,
          productTitle: this.asString(snapshot.productTitle) || this.asString(snapshot.title),
          skuTitle: this.asString(snapshot.skuTitle),
          unitName: this.asString(snapshot.unitName),
          quantity: item.quantity,
          pickedQuantity: item.pickedQuantity,
        };
      }),
      latestCarrierOrder: latestCarrierOrder
        ? {
            id: latestCarrierOrder.id,
            provider: latestCarrierOrder.provider,
            outsideOrderId: latestCarrierOrder.outsideOrderId,
            carrierOrderNo: latestCarrierOrder.carrierOrderNo,
            priceCalculateId: latestCarrierOrder.priceCalculateId,
            cityId: latestCarrierOrder.cityId,
            vehicleId: latestCarrierOrder.vehicleId,
            status: latestCarrierOrder.status,
            driverSnapshot: latestCarrierOrder.driverSnapshot,
            vehicleSnapshot: latestCarrierOrder.vehicleSnapshot,
            estimatedFeeCents: latestCarrierOrder.estimatedFeeCents,
            actualFeeCents: latestCarrierOrder.actualFeeCents,
            lastSyncedAt: latestCarrierOrder.lastSyncedAt,
            createdAt: latestCarrierOrder.createdAt,
            updatedAt: latestCarrierOrder.updatedAt,
          }
        : null,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }

  private parsePositiveInt(value: number | string | undefined, fallback: number) {
    const parsed = typeof value === 'number' ? value : value ? parseInt(value, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  }

  private parseDate(value: string | Date | undefined) {
    if (!value) {
      return undefined;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private cents(value: number | null | undefined) {
    return Number.isFinite(value) ? Math.trunc(value ?? 0) : 0;
  }

  private getAddressPart(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = this.asString(record[key]);
      if (value) {
        return value;
      }
    }
    return '';
  }

  private asRecord(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  }

  private asString(raw: unknown) {
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private asOptionalNumber(raw: unknown) {
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : undefined;
  }

  private toNullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) {
      return Prisma.JsonNull;
    }
    return this.toJson(value);
  }

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) {
      return Prisma.JsonNull;
    }
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toAuditPayload(value: unknown) {
    return JSON.parse(JSON.stringify(value));
  }

  private hashJson(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
  }
}
