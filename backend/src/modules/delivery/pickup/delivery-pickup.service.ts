import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  DeliveryAuditActorType,
  DeliveryCarrierPaymentMode,
  DeliveryCarrierProvider,
  DeliveryOrderStatus,
  DeliveryPickupBatchStatus,
  DeliveryPickupStatus,
  DeliveryShippingCostLedgerType,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { SfPickupCarrierService } from '../carriers/sf-pickup-carrier.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryConfigService } from '../config/delivery-config.service';
import { CreateDeliveryPickupSfShipmentDto } from './dto/delivery-pickup.dto';

export type DeliveryPickupAdminQuery = {
  page?: number | string;
  pageSize?: number | string;
  from?: string | Date;
  to?: string | Date;
  merchantId?: string;
  unitId?: string;
  status?: string;
  keyword?: string;
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
  suggestedWeightKg: number;
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
    attempt: number;
    outsideOrderId: string;
    carrierOrderNo: string | null;
    expressTypeId: number | null;
    expressTypeName: string | null;
    packageCount: number | null;
    totalWeightKg: number | null;
    waybillUrl: string | null;
    status: string;
    waybills: Array<{
      id: string;
      trackingNo: string;
      status: string;
      deliveredAt: Date | null;
      lastSyncedAt: Date | null;
    }>;
    estimatedFeeCents: number | null;
    actualFeeCents: number | null;
    lastSyncedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

type DeliverySellerCarrierOrderView = Omit<
  NonNullable<DeliveryPickupBatchView['latestCarrierOrder']>,
  'estimatedFeeCents' | 'actualFeeCents'
>;

export type DeliverySellerPickupBatchView = Omit<
  DeliveryPickupBatchView,
  | 'prepaidPickupShippingFeeCents'
  | 'estimatedShippingFeeCents'
  | 'actualCarrierCostCents'
  | 'shippingCostDiffCents'
  | 'latestCarrierOrder'
> & {
  latestCarrierOrder: DeliverySellerCarrierOrderView | null;
};

type DeliveryPrismaTransaction = Prisma.TransactionClient;

const LOCK_NAMESPACE = 'delivery-pickup-sf-waybill';
const CARRIER_RESERVATION_TTL_MS = 15 * 60 * 1000;
const ACTIVE_BATCH_STATUSES = [
  DeliveryPickupBatchStatus.LOADED,
  DeliveryPickupBatchStatus.DELIVERING,
  DeliveryPickupBatchStatus.COMPLETED,
] as const;

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
      status: true,
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
    include: {
      waybills: {
        orderBy: [{ createdAt: 'asc' as const }],
      },
    },
    orderBy: [{ attempt: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 1,
  },
} satisfies Prisma.DeliveryPickupBatchInclude;

type PickupBatchWithAdminInclude = Prisma.DeliveryPickupBatchGetPayload<{
  include: typeof DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE;
}>;

@Injectable()
export class DeliveryPickupService {
  private readonly logger = new Logger(DeliveryPickupService.name);

  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryIdService: DeliveryIdService,
    private readonly sfCarrier: SfPickupCarrierService,
    private readonly deliveryConfig: DeliveryConfigService,
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
    const where = this.buildBatchWhere(query);
    const [total, batches] = await Promise.all([
      this.deliveryPrisma.deliveryPickupBatch.count({ where }),
      this.deliveryPrisma.deliveryPickupBatch.findMany({
        where,
        include: DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: batches.map((batch) => this.mapBatchView(batch)), total, page, pageSize };
  }

  async listSellerPickupBatches(merchantId: string, query: DeliveryPickupAdminQuery) {
    this.assertSellerMerchant(merchantId);
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = Math.min(this.parsePositiveInt(query.pageSize, 20), 100);
    const where = this.buildBatchWhere({ ...query, merchantId: merchantId.trim() });
    const [total, batches] = await Promise.all([
      this.deliveryPrisma.deliveryPickupBatch.count({ where }),
      this.deliveryPrisma.deliveryPickupBatch.findMany({
        where,
        include: DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: batches.map((batch) => this.mapSellerBatchView(batch)),
      total,
      page,
      pageSize,
    };
  }

  async getSellerPickupBatch(merchantId: string, batchId: string) {
    this.assertSellerMerchant(merchantId);
    return this.mapSellerBatchView(
      await this.loadSellerBatch(this.deliveryPrisma, merchantId, batchId),
    );
  }

  async markReady(merchantId: string, staffId: string, batchId: string) {
    this.assertSellerActor(merchantId, staffId);
    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const batch = await this.loadSellerBatch(tx, merchantId, batchId);
        const readyStatuses: DeliveryPickupBatchStatus[] = [
          DeliveryPickupBatchStatus.PLANNED,
          DeliveryPickupBatchStatus.EXCEPTION,
        ];
        if (!readyStatuses.includes(batch.status)) {
          throw new BadRequestException(`该配送批次当前状态不可标记备货: ${batch.status}`);
        }
        const carrierOrder = this.latestCarrierOrder(batch);
        if (carrierOrder?.carrierOrderNo && !this.isCanceledCarrierOrder(carrierOrder.status)) {
          throw new BadRequestException('该配送批次已有生效中的顺丰运单');
        }
        await tx.deliveryPickupBatch.update({
          where: { id: batch.id },
          data: {
            status: DeliveryPickupBatchStatus.READY_TO_CALL,
            readyAt: batch.readyAt ?? new Date(),
            lastOperatorType: DeliveryAuditActorType.SELLER,
            lastOperatorId: staffId,
          },
        });
        await this.refreshPickupStatuses(tx, batch.orderId, batch.subOrderId);
        await this.writeAuditLog(tx, DeliveryAuditActorType.SELLER, staffId, {
          action: 'SELLER_MARK_READY',
          targetId: batch.id,
          summary: '配送中心标记配送批次已备货',
          before: this.toAuditPayload(batch),
          after: { status: DeliveryPickupBatchStatus.READY_TO_CALL },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getSellerPickupBatch(merchantId, batchId);
  }

  async createSfShipment(
    merchantId: string,
    staffId: string,
    batchId: string,
    input: CreateDeliveryPickupSfShipmentDto,
  ) {
    this.assertSellerActor(merchantId, staffId);
    const products = await this.deliveryConfig.getSfExpressProducts(true);
    const product = products.find((item) => item.expressTypeId === input.expressTypeId);
    if (!product) {
      throw new BadRequestException('该顺丰产品未在平台启用，请刷新配置后重试');
    }

    const reservation = await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const batch = await this.loadSellerBatch(tx, merchantId, batchId);
        const latest = this.latestCarrierOrder(batch);
        if (latest?.carrierOrderNo && !this.isCanceledCarrierOrder(latest.status)) {
          return { idempotent: true as const, batch };
        }
        this.assertCallableBatch(batch, latest);

        const attempt = latest && this.isCanceledCarrierOrder(latest.status) ? latest.attempt + 1 : latest?.attempt ?? 1;
        const outsideOrderId =
          latest && !this.isCanceledCarrierOrder(latest.status)
            ? latest.outsideOrderId
            : this.buildSfCustomerOrderId(batch.id, attempt);
        let carrierOrder = latest;
        if (!carrierOrder || this.isCanceledCarrierOrder(carrierOrder.status)) {
          carrierOrder = await tx.deliveryCarrierOrder.create({
            data: {
              id: await this.deliveryIdService.nextInTransaction(tx, 'PSCY'),
              batchId: batch.id,
              provider: DeliveryCarrierProvider.SF,
              attempt,
              outsideOrderId,
              expressTypeId: product.expressTypeId,
              expressTypeName: product.name,
              packageCount: input.packageCount,
              totalWeightKg: input.totalWeightKg,
              payType: DeliveryCarrierPaymentMode.PLATFORM_MONTHLY,
              status: 'CREATING_SF_ORDER',
            },
            include: { waybills: true },
          });
        } else {
          carrierOrder = await tx.deliveryCarrierOrder.update({
            where: { id: carrierOrder.id },
            data: {
              expressTypeId: product.expressTypeId,
              expressTypeName: product.name,
              packageCount: input.packageCount,
              totalWeightKg: input.totalWeightKg,
              status: 'CREATING_SF_ORDER',
            },
            include: { waybills: true },
          });
        }

        await tx.deliveryPickupBatch.update({
          where: { id: batch.id },
          data: {
            status: DeliveryPickupBatchStatus.CALLING_CARRIER,
            calledAt: batch.calledAt ?? new Date(),
            lastOperatorType: DeliveryAuditActorType.SELLER,
            lastOperatorId: staffId,
          },
        });
        return {
          idempotent: false as const,
          batch,
          carrierOrder,
          request: {
            outsideOrderId,
            sender: this.buildSender(batch),
            receiver: this.buildReceiver(batch),
            cargo: this.buildCargo(batch),
            expressTypeId: product.expressTypeId,
            expressTypeName: product.name,
            packageCount: input.packageCount,
            totalWeightKg: input.totalWeightKg,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (reservation.idempotent) {
      return this.getSellerPickupBatch(merchantId, batchId);
    }

    let remoteResult: Awaited<ReturnType<SfPickupCarrierService['createShipment']>>;
    try {
      remoteResult = await this.sfCarrier.createShipment(reservation.request);
    } catch (error) {
      await this.markCreateFailed(batchId, reservation.carrierOrder.id, staffId, error);
      throw error;
    }

    try {
      await this.persistCreatedShipment(
        batchId,
        reservation.carrierOrder.id,
        staffId,
        remoteResult,
      );
    } catch (error) {
      await this.compensatePersistFailure(
        batchId,
        reservation.carrierOrder.id,
        staffId,
        remoteResult,
        error,
      );
      throw error;
    }

    return this.getSellerPickupBatch(merchantId, batchId);
  }

  async reportException(merchantId: string, staffId: string, batchId: string, message: string) {
    this.assertSellerActor(merchantId, staffId);
    const trimmedMessage = message?.trim();
    if (!trimmedMessage) throw new BadRequestException('异常说明不能为空');
    if (trimmedMessage.length > 500) throw new BadRequestException('异常说明不能超过 500 个字符');

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const batch = await this.loadSellerBatch(tx, merchantId, batchId);
        const terminalStatuses: DeliveryPickupBatchStatus[] = [
          DeliveryPickupBatchStatus.COMPLETED,
          DeliveryPickupBatchStatus.CANCELED,
        ];
        if (terminalStatuses.includes(batch.status)) {
          throw new BadRequestException(`该配送批次当前状态不可上报异常: ${batch.status}`);
        }
        await tx.deliveryPickupBatch.update({
          where: { id: batch.id },
          data: {
            status: DeliveryPickupBatchStatus.EXCEPTION,
            remark: trimmedMessage,
            lastOperatorType: DeliveryAuditActorType.SELLER,
            lastOperatorId: staffId,
          },
        });
        await this.refreshPickupStatuses(tx, batch.orderId, batch.subOrderId);
        await this.writeAuditLog(tx, DeliveryAuditActorType.SELLER, staffId, {
          action: 'SELLER_REPORT_EXCEPTION',
          targetId: batch.id,
          summary: '配送中心上报配送异常',
          before: this.toAuditPayload(batch),
          after: { status: DeliveryPickupBatchStatus.EXCEPTION, message: trimmedMessage },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getSellerPickupBatch(merchantId, batchId);
  }

  async syncCarrier(batchId: string, adminId: string) {
    this.assertAdminActor(adminId);
    const batch = await this.loadBatch(this.deliveryPrisma, batchId);
    const carrierOrder = this.latestCarrierOrder(batch);
    const waybillNos = carrierOrder?.waybills.map((item) => item.trackingNo) ?? [];
    if (!carrierOrder?.carrierOrderNo || waybillNos.length === 0) {
      throw new BadRequestException('该配送批次尚未创建顺丰运单');
    }
    const detail = await this.sfCarrier.syncWaybills(waybillNos);

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const latestBatch = await this.loadBatch(tx, batchId);
        const latestCarrierOrder = this.latestCarrierOrder(latestBatch);
        if (!latestCarrierOrder || latestCarrierOrder.id !== carrierOrder.id) {
          throw new ConflictException('配送批次运单已变化，请刷新后重试');
        }

        const now = new Date();
        const mappedStatuses: DeliveryPickupBatchStatus[] = [];
        for (const waybill of detail.waybills) {
          const currentWaybill = latestCarrierOrder.waybills.find(
            (item) => item.trackingNo === waybill.trackingNo,
          );
          if (!currentWaybill) {
            throw new ConflictException('顺丰运单明细已变化，请刷新后重试');
          }
          const effective = this.resolveSynchronizedWaybillStatus(
            currentWaybill.status,
            waybill.status,
            waybill.mappedStatus,
          );
          mappedStatuses.push(effective.mappedStatus);
          const updated = await tx.deliveryCarrierWaybill.updateMany({
            where: {
              carrierOrderId: latestCarrierOrder.id,
              trackingNo: waybill.trackingNo,
            },
            data: {
              status: effective.status,
              deliveredAt:
                effective.mappedStatus === DeliveryPickupBatchStatus.COMPLETED
                  ? currentWaybill.deliveredAt ?? now
                  : undefined,
              lastSyncedAt: now,
              rawPayload: this.toJson({ events: waybill.events }),
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException('顺丰运单明细已变化，请刷新后重试');
          }
        }
        const aggregateStatus =
          latestBatch.status === DeliveryPickupBatchStatus.COMPLETED
            ? DeliveryPickupBatchStatus.COMPLETED
            : this.resolveAggregateCarrierStatus(mappedStatuses);
        await tx.deliveryCarrierOrder.update({
          where: { id: latestCarrierOrder.id },
          data: {
            status: aggregateStatus,
            detailPayload: this.toJson(detail.rawPayload),
            lastSyncedAt: now,
          },
        });
        await this.applyBatchCarrierStatus(tx, latestBatch, aggregateStatus, {
          actorType: DeliveryAuditActorType.ADMIN,
          actorId: adminId,
          now,
        });
        await this.writeAuditLog(tx, DeliveryAuditActorType.ADMIN, adminId, {
          action: 'SYNC_SF_CARRIER',
          targetId: latestBatch.id,
          summary: '同步顺丰配送批次',
          before: this.toAuditPayload(latestBatch),
          after: { status: aggregateStatus, waybillNos },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getBatchViewById(batchId);
  }

  async cancelCarrier(batchId: string, adminId: string, reason: string) {
    this.assertAdminActor(adminId);
    const trimmedReason = reason?.trim();
    if (!trimmedReason) throw new BadRequestException('取消原因不能为空');
    if (trimmedReason.length > 500) throw new BadRequestException('取消原因不能超过 500 个字符');
    const batch = await this.loadBatch(this.deliveryPrisma, batchId);
    this.assertCancelableBatch(batch);
    const carrierOrder = this.latestCarrierOrder(batch);
    if (!carrierOrder?.carrierOrderNo) {
      throw new BadRequestException('该配送批次尚未创建顺丰运单');
    }
    const result = await this.sfCarrier.cancelShipment({
      outsideOrderId: carrierOrder.outsideOrderId,
      primaryWaybillNo: carrierOrder.carrierOrderNo,
    });

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const latestBatch = await this.loadBatch(tx, batchId);
        this.assertCancelableBatch(latestBatch);
        const latestCarrierOrder = this.latestCarrierOrder(latestBatch);
        if (!latestCarrierOrder || latestCarrierOrder.id !== carrierOrder.id) {
          throw new ConflictException('配送批次运单已变化，请刷新后重试');
        }
        await tx.deliveryCarrierOrder.update({
          where: { id: latestCarrierOrder.id },
          data: { status: 'CANCELED', cancelPayload: this.toJson(result.rawPayload) },
        });
        await tx.deliveryCarrierWaybill.updateMany({
          where: { carrierOrderId: latestCarrierOrder.id },
          data: { status: 'CANCELED', lastSyncedAt: new Date() },
        });
        await tx.deliveryPickupBatch.update({
          where: { id: latestBatch.id },
          data: {
            status: DeliveryPickupBatchStatus.READY_TO_CALL,
            canceledAt: null,
            remark: trimmedReason,
            lastOperatorType: DeliveryAuditActorType.ADMIN,
            lastOperatorId: adminId,
          },
        });
        await this.refreshPickupStatuses(tx, latestBatch.orderId, latestBatch.subOrderId);
        await this.writeAuditLog(tx, DeliveryAuditActorType.ADMIN, adminId, {
          action: 'CANCEL_SF_WAYBILL',
          targetId: latestBatch.id,
          summary: '取消顺丰运单并恢复批次待发货',
          before: this.toAuditPayload(latestBatch),
          after: { status: DeliveryPickupBatchStatus.READY_TO_CALL, reason: trimmedReason },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getBatchViewById(batchId);
  }

  async reprintAdminWaybill(batchId: string, adminId: string) {
    this.assertAdminActor(adminId);
    await this.reprintWaybill(batchId, DeliveryAuditActorType.ADMIN, adminId);
    return this.getBatchViewById(batchId);
  }

  async getAdminWaybillStorageKey(batchId: string) {
    const batch = await this.loadBatch(this.deliveryPrisma, batchId);
    const carrierOrder = this.latestCarrierOrder(batch);
    const url = carrierOrder?.waybillUrl?.trim();
    if (!url || !carrierOrder.carrierOrderNo || this.isCanceledCarrierOrder(carrierOrder.status)) {
      throw new BadRequestException('该配送批次没有可下载的顺丰面单');
    }
    let pathname = url;
    try {
      pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    } catch {
      pathname = decodeURIComponent(url.split('?')[0]);
    }
    const prefix = 'delivery/pickup-waybills/';
    const index = pathname.indexOf(prefix);
    if (index < 0) {
      throw new BadRequestException('顺丰面单存储地址无效，请重打后再试');
    }
    return pathname.slice(index).replace(/^\/+/, '');
  }

  async reprintSellerWaybill(merchantId: string, staffId: string, batchId: string) {
    this.assertSellerActor(merchantId, staffId);
    await this.loadSellerBatch(this.deliveryPrisma, merchantId, batchId);
    await this.reprintWaybill(batchId, DeliveryAuditActorType.SELLER, staffId);
    return this.getSellerPickupBatch(merchantId, batchId);
  }

  async manualAdjustCost(
    batchId: string,
    adminId: string,
    amountCents: number | string | undefined,
    remark: string,
  ) {
    this.assertAdminActor(adminId);
    const amount = this.parseManualAdjustmentAmount(amountCents);
    const trimmedRemark = remark?.trim();
    if (!trimmedRemark) throw new BadRequestException('成本调整备注不能为空');
    if (trimmedRemark.length > 500) throw new BadRequestException('成本调整备注不能超过 500 个字符');

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const batch = await this.loadBatch(tx, batchId);
        const nextCost = this.cents(batch.actualCarrierCostCents) + amount;
        if (nextCost < 0) throw new BadRequestException('调整后实际成本不能小于 0');
        if (nextCost > 2_147_483_647) throw new BadRequestException('调整后实际成本超出系统允许范围');
        await tx.deliveryShippingCostLedger.create({
          data: {
            orderId: batch.orderId,
            subOrderId: batch.subOrderId,
            batchId: batch.id,
            provider: DeliveryCarrierProvider.SF,
            type: DeliveryShippingCostLedgerType.MANUAL_ADJUSTMENT,
            amountCents: amount,
            source: 'ADMIN_MANUAL_ADJUSTMENT',
            payloadSnapshot: this.toJson({ remark: trimmedRemark }),
            createdByType: DeliveryAuditActorType.ADMIN,
            createdById: adminId,
          },
        });
        await tx.deliveryPickupBatch.update({
          where: { id: batch.id },
          data: {
            actualCarrierCostCents: nextCost,
            shippingCostDiffCents:
              this.cents(batch.estimatedShippingFeeCents) - nextCost,
            lastOperatorType: DeliveryAuditActorType.ADMIN,
            lastOperatorId: adminId,
          },
        });
        await this.refreshOrderFreightAggregate(tx, batch.orderId);
        await this.writeAuditLog(tx, DeliveryAuditActorType.ADMIN, adminId, {
          action: 'MANUAL_ADJUST_COST',
          targetId: batch.id,
          summary: '手动调整顺丰配送成本',
          before: this.toAuditPayload(batch),
          after: { amountCents: amount, remark: trimmedRemark },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.getBatchViewById(batchId);
  }

  private async persistCreatedShipment(
    batchId: string,
    carrierOrderId: string,
    staffId: string,
    result: Awaited<ReturnType<SfPickupCarrierService['createShipment']>>,
  ) {
    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const batch = await this.loadBatch(tx, batchId);
        const carrierOrder = this.latestCarrierOrder(batch);
        if (!carrierOrder || carrierOrder.id !== carrierOrderId) {
          throw new ConflictException('配送批次顺丰下单状态已变化，请刷新后重试');
        }
        if (carrierOrder.carrierOrderNo) {
          if (carrierOrder.carrierOrderNo === result.primaryWaybillNo) return;
          throw new ConflictException('配送批次已存在其他顺丰运单，请联系管理员');
        }
        if (batch.status !== DeliveryPickupBatchStatus.CALLING_CARRIER) {
          throw new ConflictException('配送批次状态已变化，顺丰运单未能落库');
        }

        await tx.deliveryCarrierOrder.update({
          where: { id: carrierOrder.id },
          data: {
            carrierOrderNo: result.primaryWaybillNo,
            waybillUrl: result.waybillUrl,
            status: result.status,
            orderPayload: this.toJson(result.rawPayload),
            waybills: {
              create: result.waybillNos.map((trackingNo) => ({
                trackingNo,
                status: 'WAITING_PICKUP',
              })),
            },
          },
        });
        await this.applyBatchCarrierStatus(tx, batch, result.status, {
          actorType: DeliveryAuditActorType.SELLER,
          actorId: staffId,
          now: new Date(),
        });
        await this.writeAuditLog(tx, DeliveryAuditActorType.SELLER, staffId, {
          action: 'SELLER_CREATE_SF_SHIPMENT',
          targetId: batch.id,
          summary: '配送中心创建顺丰运单',
          before: this.toAuditPayload(batch),
          after: {
            carrierOrderNo: result.primaryWaybillNo,
            waybillNos: result.waybillNos,
            status: result.status,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async markCreateFailed(
    batchId: string,
    carrierOrderId: string,
    staffId: string,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : '顺丰下单失败';
    try {
      await this.deliveryPrisma.$transaction(
        async (tx) => {
          await this.acquireBatchLock(tx, batchId);
          const batch = await this.loadBatch(tx, batchId);
          await tx.deliveryCarrierOrder.updateMany({
            where: { id: carrierOrderId, batchId, carrierOrderNo: null },
            data: {
              status: 'CREATE_FAILED',
              detailPayload: this.toJson({ error: message.slice(0, 500) }),
            },
          });
          await tx.deliveryPickupBatch.updateMany({
            where: { id: batchId, status: DeliveryPickupBatchStatus.CALLING_CARRIER },
            data: {
              status: DeliveryPickupBatchStatus.EXCEPTION,
              remark: '顺丰下单失败，请检查信息后重试',
              lastOperatorType: DeliveryAuditActorType.SELLER,
              lastOperatorId: staffId,
            },
          });
          await this.refreshPickupStatuses(tx, batch.orderId, batch.subOrderId);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (persistError) {
      this.logger.error(`顺丰配送批次失败状态落库异常: ${String(persistError)}`);
    }
  }

  private async compensatePersistFailure(
    batchId: string,
    carrierOrderId: string,
    staffId: string,
    result: Awaited<ReturnType<SfPickupCarrierService['createShipment']>>,
    originalError: unknown,
  ) {
    let canceled = false;
    let cancelPayload: unknown = null;
    try {
      const cancellation = await this.sfCarrier.cancelShipment({
        outsideOrderId: result.outsideOrderId,
        primaryWaybillNo: result.primaryWaybillNo,
      });
      canceled = cancellation.success;
      cancelPayload = cancellation.rawPayload;
    } catch (error) {
      cancelPayload = { error: error instanceof Error ? error.message : String(error) };
    }

    try {
      await this.deliveryPrisma.$transaction(
        async (tx) => {
          await this.acquireBatchLock(tx, batchId);
          const batch = await this.loadBatch(tx, batchId);
          await tx.deliveryCarrierOrder.updateMany({
            where: { id: carrierOrderId, batchId },
            data: {
              carrierOrderNo: result.primaryWaybillNo,
              waybillUrl: result.waybillUrl,
              status: canceled ? 'CANCELED_AFTER_PERSIST_FAILURE' : 'MANUAL_INTERVENTION_REQUIRED',
              orderPayload: this.toJson(result.rawPayload),
              cancelPayload: this.toJson(cancelPayload),
              detailPayload: this.toJson({
                persistError:
                  originalError instanceof Error ? originalError.message.slice(0, 500) : String(originalError),
              }),
            },
          });
          await tx.deliveryCarrierWaybill.createMany({
            data: result.waybillNos.map((trackingNo) => ({
              carrierOrderId,
              trackingNo,
              status: canceled ? 'CANCELED' : 'UNKNOWN_REMOTE_ACTIVE',
            })),
            skipDuplicates: true,
          });
          await tx.deliveryPickupBatch.update({
            where: { id: batchId },
            data: {
              status: canceled
                ? DeliveryPickupBatchStatus.READY_TO_CALL
                : DeliveryPickupBatchStatus.EXCEPTION,
              remark: canceled
                ? '顺丰运单落库失败，远端已撤销，可重新发货'
                : '顺丰运单落库失败且撤销未确认，请管理员人工处理',
              lastOperatorType: DeliveryAuditActorType.SELLER,
              lastOperatorId: staffId,
            },
          });
          await this.refreshPickupStatuses(tx, batch.orderId, batch.subOrderId);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (persistError) {
      this.logger.error(`顺丰配送批次补偿状态落库异常: ${String(persistError)}`);
    }
  }

  private async reprintWaybill(
    batchId: string,
    actorType: DeliveryAuditActorType,
    actorId: string,
  ) {
    const batch = await this.loadBatch(this.deliveryPrisma, batchId);
    const carrierOrder = this.latestCarrierOrder(batch);
    if (!carrierOrder?.carrierOrderNo || this.isCanceledCarrierOrder(carrierOrder.status)) {
      throw new BadRequestException('该配送批次没有可重打的顺丰面单');
    }
    const waybillUrl = await this.sfCarrier.reprintWaybill(
      carrierOrder.waybills.map((item) => item.trackingNo),
    );
    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireBatchLock(tx, batchId);
        const latest = await this.loadBatch(tx, batchId);
        const latestCarrierOrder = this.latestCarrierOrder(latest);
        if (!latestCarrierOrder || latestCarrierOrder.id !== carrierOrder.id) {
          throw new ConflictException('配送批次运单已变化，请刷新后重试');
        }
        await tx.deliveryCarrierOrder.update({
          where: { id: carrierOrder.id },
          data: { waybillUrl },
        });
        await this.writeAuditLog(tx, actorType, actorId, {
          action: 'REPRINT_SF_WAYBILL',
          targetId: batch.id,
          summary: '重打顺丰配送面单',
          before: { waybillUrl: carrierOrder.waybillUrl },
          after: { waybillUrl },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async applyBatchCarrierStatus(
    tx: DeliveryPrismaTransaction,
    batch: PickupBatchWithAdminInclude,
    status: DeliveryPickupBatchStatus,
    actor: { actorType: DeliveryAuditActorType; actorId: string; now: Date },
  ) {
    const effectiveStatus =
      batch.status === DeliveryPickupBatchStatus.COMPLETED
        ? DeliveryPickupBatchStatus.COMPLETED
        : status;
    const data: Prisma.DeliveryPickupBatchUpdateInput = {
      status: effectiveStatus,
      lastOperatorType: actor.actorType,
      lastOperatorId: actor.actorId,
    };
    if (effectiveStatus === DeliveryPickupBatchStatus.LOADED) data.loadedAt = batch.loadedAt ?? actor.now;
    if (effectiveStatus === DeliveryPickupBatchStatus.COMPLETED) {
      data.loadedAt = batch.loadedAt ?? actor.now;
      data.completedAt = batch.completedAt ?? actor.now;
      await this.completeBatchItems(tx, batch);
    }
    await tx.deliveryPickupBatch.update({ where: { id: batch.id }, data });
    await this.refreshPickupStatuses(tx, batch.orderId, batch.subOrderId);
  }

  private async completeBatchItems(tx: DeliveryPrismaTransaction, batch: PickupBatchWithAdminInclude) {
    for (const item of batch.items) {
      const delta = Math.max(0, item.quantity - item.pickedQuantity);
      if (delta === 0) continue;
      const batchItemUpdated = await tx.deliveryPickupBatchItem.updateMany({
        where: { id: item.id, batchId: batch.id, pickedQuantity: item.pickedQuantity },
        data: { pickedQuantity: item.quantity },
      });
      if (batchItemUpdated.count !== 1) {
        throw new ConflictException('配送批次明细已变化，请刷新后重试');
      }
      const orderItemUpdated = await tx.deliveryOrderItem.updateMany({
        where: {
          id: item.orderItemId,
          subOrderId: item.subOrderId,
          reservedPickupQuantity: { gte: delta },
        },
        data: {
          pickedQuantity: { increment: delta },
          reservedPickupQuantity: { decrement: delta },
        },
      });
      if (orderItemUpdated.count !== 1) {
        throw new ConflictException('订单商品配送数量或预留数量不一致，请管理员核查');
      }
    }
  }

  private async refreshPickupStatuses(
    tx: DeliveryPrismaTransaction,
    orderId: string,
    subOrderId: string,
  ) {
    const [orderBatches, subOrderBatches] = await Promise.all([
      tx.deliveryPickupBatch.findMany({ where: { orderId }, select: { status: true } }),
      tx.deliveryPickupBatch.findMany({ where: { subOrderId }, select: { status: true } }),
    ]);
    const subPickupStatus = this.resolvePickupStatus(subOrderBatches.map((item) => item.status));
    const orderPickupStatus = this.resolvePickupStatus(orderBatches.map((item) => item.status));
    const now = new Date();
    const subStatus = await tx.deliverySubOrder.findUnique({
      where: { id: subOrderId },
      select: { status: true, shippedAt: true, deliveredAt: true },
    });
    const subData: Prisma.DeliverySubOrderUpdateInput = { pickupStatus: subPickupStatus };
    const terminalOrderStatuses: DeliveryOrderStatus[] = [
      DeliveryOrderStatus.DELIVERED,
      DeliveryOrderStatus.COMPLETED,
      DeliveryOrderStatus.CANCELED,
    ];
    if (subStatus && !terminalOrderStatuses.includes(subStatus.status)) {
      if (subPickupStatus === DeliveryPickupStatus.ALL_PICKED) {
        subData.status = DeliveryOrderStatus.DELIVERED;
        subData.shippedAt = subStatus.shippedAt ?? now;
        subData.deliveredAt = subStatus.deliveredAt ?? now;
      } else if (subOrderBatches.some((item) => ACTIVE_BATCH_STATUSES.includes(item.status as never))) {
        subData.status = DeliveryOrderStatus.SHIPPED;
        subData.shippedAt = subStatus.shippedAt ?? now;
      }
    }
    await tx.deliverySubOrder.update({ where: { id: subOrderId }, data: subData });

    const subOrders = await tx.deliverySubOrder.findMany({
      where: { orderId },
      select: { status: true },
    });
    const order = await tx.deliveryOrder.findUnique({
      where: { id: orderId },
      select: { status: true, shippedAt: true, deliveredAt: true },
    });
    const orderData: Prisma.DeliveryOrderUpdateInput = { pickupStatus: orderPickupStatus };
    if (order && !terminalOrderStatuses.includes(order.status)) {
      const deliveredStatuses: DeliveryOrderStatus[] = [
        DeliveryOrderStatus.DELIVERED,
        DeliveryOrderStatus.COMPLETED,
        DeliveryOrderStatus.CANCELED,
      ];
      const allDelivered =
        subOrders.length > 0 &&
        subOrders.every((item) => deliveredStatuses.includes(item.status));
      if (allDelivered) {
        orderData.status = DeliveryOrderStatus.DELIVERED;
        orderData.shippedAt = order.shippedAt ?? now;
        orderData.deliveredAt = order.deliveredAt ?? now;
      } else if (
        subOrders.some((item) => {
          const shippedStatuses: DeliveryOrderStatus[] = [
            DeliveryOrderStatus.SHIPPED,
            DeliveryOrderStatus.DELIVERED,
            DeliveryOrderStatus.COMPLETED,
          ];
          return shippedStatuses.includes(item.status);
        })
      ) {
        orderData.status = DeliveryOrderStatus.SHIPPED;
        orderData.shippedAt = order.shippedAt ?? now;
      }
    }
    await tx.deliveryOrder.update({ where: { id: orderId }, data: orderData });
  }

  private resolvePickupStatus(statuses: DeliveryPickupBatchStatus[]) {
    if (statuses.length === 0) return DeliveryPickupStatus.NOT_STARTED;
    if (statuses.every((status) => status === DeliveryPickupBatchStatus.CANCELED)) {
      return DeliveryPickupStatus.CANCELED;
    }
    if (statuses.every((status) => status === DeliveryPickupBatchStatus.COMPLETED)) {
      return DeliveryPickupStatus.ALL_PICKED;
    }
    if (statuses.some((status) => ACTIVE_BATCH_STATUSES.includes(status as never))) {
      return DeliveryPickupStatus.PARTIAL_PICKED;
    }
    return DeliveryPickupStatus.NOT_STARTED;
  }

  private resolveSynchronizedWaybillStatus(
    currentStatus: string,
    incomingStatus: string,
    incomingMappedStatus: DeliveryPickupBatchStatus,
  ) {
    const mappedByRawStatus: Record<string, DeliveryPickupBatchStatus> = {
      DELIVERED: DeliveryPickupBatchStatus.COMPLETED,
      IN_TRANSIT: DeliveryPickupBatchStatus.DELIVERING,
      SHIPPED: DeliveryPickupBatchStatus.LOADED,
      EXCEPTION: DeliveryPickupBatchStatus.EXCEPTION,
    };
    if (currentStatus === 'DELIVERED') {
      return { status: 'DELIVERED', mappedStatus: DeliveryPickupBatchStatus.COMPLETED };
    }
    if (incomingStatus === 'EXCEPTION') {
      return { status: incomingStatus, mappedStatus: DeliveryPickupBatchStatus.EXCEPTION };
    }
    const progressRank: Record<string, number> = {
      INIT: 0,
      WAITING_PICKUP: 0,
      SHIPPED: 1,
      IN_TRANSIT: 2,
      DELIVERED: 3,
    };
    if ((progressRank[currentStatus] ?? -1) > (progressRank[incomingStatus] ?? -1)) {
      return {
        status: currentStatus,
        mappedStatus: mappedByRawStatus[currentStatus] ?? DeliveryPickupBatchStatus.WAITING_DRIVER,
      };
    }
    return { status: incomingStatus, mappedStatus: incomingMappedStatus };
  }

  private resolveAggregateCarrierStatus(statuses: DeliveryPickupBatchStatus[]) {
    if (statuses.length > 0 && statuses.every((item) => item === DeliveryPickupBatchStatus.COMPLETED)) {
      return DeliveryPickupBatchStatus.COMPLETED;
    }
    if (statuses.some((item) => item === DeliveryPickupBatchStatus.EXCEPTION)) {
      return DeliveryPickupBatchStatus.EXCEPTION;
    }
    if (statuses.some((item) => item === DeliveryPickupBatchStatus.DELIVERING)) {
      return DeliveryPickupBatchStatus.DELIVERING;
    }
    if (statuses.some((item) => item === DeliveryPickupBatchStatus.LOADED)) {
      return DeliveryPickupBatchStatus.LOADED;
    }
    return DeliveryPickupBatchStatus.WAITING_DRIVER;
  }

  private assertCallableBatch(
    batch: PickupBatchWithAdminInclude,
    carrierOrder: PickupBatchWithAdminInclude['carrierOrders'][number] | null,
  ) {
    const callableStatuses: DeliveryPickupBatchStatus[] = [
      DeliveryPickupBatchStatus.READY_TO_CALL,
      DeliveryPickupBatchStatus.EXCEPTION,
    ];
    const staleReservation =
      batch.status === DeliveryPickupBatchStatus.CALLING_CARRIER &&
      carrierOrder?.status === 'CREATING_SF_ORDER' &&
      Date.now() - carrierOrder.updatedAt.getTime() >= CARRIER_RESERVATION_TTL_MS;
    if (!callableStatuses.includes(batch.status) && !staleReservation) {
      throw new BadRequestException(`该配送批次当前状态不可顺丰发货: ${batch.status}`);
    }
    if (carrierOrder?.carrierOrderNo && !this.isCanceledCarrierOrder(carrierOrder.status)) {
      throw new BadRequestException('该配送批次已有生效中的顺丰运单');
    }
    if (
      carrierOrder?.status === 'CREATING_SF_ORDER' &&
      Date.now() - carrierOrder.updatedAt.getTime() < CARRIER_RESERVATION_TTL_MS
    ) {
      throw new BadRequestException('该配送批次正在创建顺丰运单，请稍后刷新');
    }
  }

  private assertCancelableBatch(batch: PickupBatchWithAdminInclude) {
    const nonCancelableStatuses: DeliveryPickupBatchStatus[] = [
      DeliveryPickupBatchStatus.LOADED,
      DeliveryPickupBatchStatus.DELIVERING,
      DeliveryPickupBatchStatus.COMPLETED,
      DeliveryPickupBatchStatus.CANCELED,
    ];
    if (nonCancelableStatuses.includes(batch.status)) {
      throw new BadRequestException(`该配送批次当前状态不可取消顺丰运单: ${batch.status}`);
    }
  }

  private isCanceledCarrierOrder(status: string) {
    return status === 'CANCELED' || status === 'CANCELED_AFTER_PERSIST_FAILURE';
  }

  private buildSender(batch: PickupBatchWithAdminInclude) {
    const snapshot = this.asRecord(batch.senderSnapshot);
    const merchantAddress = this.asRecord(batch.merchant.addressJson);
    const source = Object.keys(snapshot).length ? snapshot : merchantAddress;
    const party = {
      name:
        this.asString(snapshot.name) ||
        this.asString(snapshot.contactName) ||
        batch.merchant.contactName ||
        batch.merchant.name,
      phone:
        this.asString(snapshot.phone) ||
        this.asString(snapshot.tel) ||
        batch.merchant.contactPhone ||
        batch.merchant.servicePhone ||
        '',
      province: this.getAddressPart(source, ['provinceName', 'province']),
      city: this.getAddressPart(source, ['cityName', 'city']),
      district: this.getAddressPart(source, ['districtName', 'district']),
      detail: this.getAddressPart(source, ['detailAddress', 'detail']),
    };
    this.assertCarrierParty(party, '配送商家发件地址');
    return party;
  }

  private buildReceiver(batch: PickupBatchWithAdminInclude) {
    const snapshot = this.asRecord(batch.receiverSnapshot);
    const orderAddress = this.asRecord(batch.order.addressSnapshot);
    const source = Object.keys(snapshot).length ? snapshot : orderAddress;
    const party = {
      name: this.asString(source.name) || this.asString(source.recipientName),
      phone: this.asString(source.phone) || this.asString(source.tel),
      province: this.getAddressPart(source, ['provinceName', 'province']),
      city: this.getAddressPart(source, ['cityName', 'city']),
      district: this.getAddressPart(source, ['districtName', 'district']),
      detail: this.getAddressPart(source, ['detailAddress', 'detail']),
    };
    this.assertCarrierParty(party, '配送订单收件地址');
    return party;
  }

  private buildCargo(batch: PickupBatchWithAdminInclude) {
    const snapshot = this.asRecord(batch.cargoSnapshot);
    const firstItemSnapshot = this.asRecord(batch.items[0]?.productSnapshot);
    const computedWeightKg = batch.items.reduce((sum, item) => {
      const itemSnapshot = this.asRecord(item.productSnapshot);
      return sum + ((this.asOptionalNumber(itemSnapshot.weightGram) ?? 0) * item.quantity) / 1000;
    }, 0);
    return {
      name:
        this.asString(snapshot.name) ||
        this.asString(firstItemSnapshot.productTitle) ||
        this.asString(firstItemSnapshot.title) ||
        '配送商品',
      quantity: Math.max(
        1,
        Math.trunc(
          this.asOptionalNumber(snapshot.quantity) ??
            batch.items.reduce((sum, item) => sum + item.quantity, 0),
        ),
      ),
      weightKg: Math.max(
        0.1,
        this.asOptionalNumber(snapshot.weightKg) ?? (computedWeightKg || 1),
      ),
      remark: this.asString(snapshot.remark) || undefined,
    };
  }

  private assertCarrierParty(
    party: { name: string; phone: string; province: string; city: string; detail: string },
    label: string,
  ) {
    if (!party.name || !party.phone || !party.province || !party.city || !party.detail) {
      throw new BadRequestException(`${label}缺少姓名、电话、省市或详细地址，无法顺丰发货`);
    }
  }

  private async refreshOrderFreightAggregate(tx: DeliveryPrismaTransaction, orderId: string) {
    const [order, aggregate] = await Promise.all([
      tx.deliveryOrder.findUnique({
        where: { id: orderId },
        select: { prepaidPickupShippingFeeCents: true },
      }),
      tx.deliveryPickupBatch.aggregate({
        where: { orderId },
        _sum: { actualCarrierCostCents: true },
      }),
    ]);
    if (!order) throw new NotFoundException('配送订单不存在');
    const actual = this.cents(aggregate._sum.actualCarrierCostCents);
    await tx.deliveryOrder.update({
      where: { id: orderId },
      data: {
        actualCarrierCostCents: actual,
        shippingCostDiffCents: this.cents(order.prepaidPickupShippingFeeCents) - actual,
      },
    });
  }

  private async getBatchViewById(batchId: string) {
    return this.mapBatchView(await this.loadBatch(this.deliveryPrisma, batchId));
  }

  private async loadBatch(
    client: Pick<DeliveryPrismaService, 'deliveryPickupBatch'>,
    batchId: string,
  ) {
    const batch = await client.deliveryPickupBatch.findUnique({
      where: { id: batchId },
      include: DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE,
    });
    if (!batch) throw new NotFoundException('配送批次不存在');
    return batch;
  }

  private async loadSellerBatch(
    client: Pick<DeliveryPrismaService, 'deliveryPickupBatch'>,
    merchantId: string,
    batchId: string,
  ) {
    const batch = await client.deliveryPickupBatch.findFirst({
      where: { id: batchId, merchantId: merchantId.trim() },
      include: DELIVERY_PICKUP_ADMIN_BATCH_INCLUDE,
    });
    if (!batch) throw new NotFoundException('配送批次不存在');
    return batch;
  }

  private latestCarrierOrder(batch: Pick<PickupBatchWithAdminInclude, 'carrierOrders'>) {
    return batch.carrierOrders[0] ?? null;
  }

  private buildBatchWhere(query: DeliveryPickupAdminQuery): Prisma.DeliveryPickupBatchWhereInput {
    const where: Prisma.DeliveryPickupBatchWhereInput = {};
    if (query.merchantId?.trim()) where.merchantId = query.merchantId.trim();
    if (query.unitId?.trim()) where.order = { unitId: query.unitId.trim() };
    if (query.status?.trim()) {
      if (!Object.values(DeliveryPickupBatchStatus).includes(query.status.trim() as DeliveryPickupBatchStatus)) {
        throw new BadRequestException('配送批次状态筛选值无效');
      }
      where.status = query.status.trim() as DeliveryPickupBatchStatus;
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      if (keyword.length > 100) throw new BadRequestException('搜索关键词不能超过 100 个字符');
      where.OR = [
        { id: { contains: keyword, mode: 'insensitive' } },
        { orderId: { contains: keyword, mode: 'insensitive' } },
        { subOrderId: { contains: keyword, mode: 'insensitive' } },
        { merchant: { name: { contains: keyword, mode: 'insensitive' } } },
        {
          carrierOrders: {
            some: {
              OR: [
                { carrierOrderNo: { contains: keyword, mode: 'insensitive' } },
                { waybills: { some: { trackingNo: { contains: keyword, mode: 'insensitive' } } } },
              ],
            },
          },
        },
      ];
    }
    const createdAt: Prisma.DateTimeFilter = {};
    const from = this.parseDate(query.from);
    const to = this.parseDate(query.to);
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;
    if (from && to && from > to) throw new BadRequestException('开始时间不能晚于结束时间');
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
    return where;
  }

  private async countExceptionBatches(where: Prisma.DeliveryPickupBatchWhereInput) {
    if (where.status && where.status !== DeliveryPickupBatchStatus.EXCEPTION) return 0;
    return this.deliveryPrisma.deliveryPickupBatch.count({
      where: { ...where, status: DeliveryPickupBatchStatus.EXCEPTION },
    });
  }

  private async writeAuditLog(
    tx: DeliveryPrismaTransaction,
    actorType: DeliveryAuditActorType,
    actorId: string,
    input: { action: string; targetId: string; summary: string; before: unknown; after: unknown },
  ) {
    await tx.deliveryAuditLog.create({
      data: {
        actorType,
        actorId,
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

  private mapSellerBatchView(batch: PickupBatchWithAdminInclude): DeliverySellerPickupBatchView {
    const view = this.mapBatchView(batch);
    const {
      prepaidPickupShippingFeeCents: _prepaid,
      estimatedShippingFeeCents: _estimated,
      actualCarrierCostCents: _actual,
      shippingCostDiffCents: _diff,
      latestCarrierOrder,
      ...safe
    } = view;
    if (!latestCarrierOrder) return { ...safe, latestCarrierOrder: null };
    const { estimatedFeeCents: _carrierEstimated, actualFeeCents: _carrierActual, ...safeCarrier } = latestCarrierOrder;
    return { ...safe, latestCarrierOrder: safeCarrier };
  }

  private mapBatchView(batch: PickupBatchWithAdminInclude): DeliveryPickupBatchView {
    const carrier = this.latestCarrierOrder(batch);
    const prepaid = this.cents(batch.estimatedShippingFeeCents);
    const actual = this.cents(batch.actualCarrierCostCents);
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
      prepaidPickupShippingFeeCents: prepaid,
      estimatedShippingFeeCents: prepaid,
      actualCarrierCostCents: actual,
      shippingCostDiffCents: batch.shippingCostDiffCents ?? prepaid - actual,
      pickupMode: batch.order.pickupMode,
      plannedPickupCount: batch.order.plannedPickupCount,
      pickupStatus: batch.order.pickupStatus,
      suggestedWeightKg: this.buildCargo(batch).weightKg,
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
      latestCarrierOrder: carrier
        ? {
            id: carrier.id,
            provider: carrier.provider,
            attempt: carrier.attempt,
            outsideOrderId: carrier.outsideOrderId,
            carrierOrderNo: carrier.carrierOrderNo,
            expressTypeId: carrier.expressTypeId,
            expressTypeName: carrier.expressTypeName,
            packageCount: carrier.packageCount,
            totalWeightKg: carrier.totalWeightKg,
            waybillUrl: carrier.waybillUrl,
            status: carrier.status,
            waybills: carrier.waybills.map((waybill) => ({
              id: waybill.id,
              trackingNo: waybill.trackingNo,
              status: waybill.status,
              deliveredAt: waybill.deliveredAt,
              lastSyncedAt: waybill.lastSyncedAt,
            })),
            estimatedFeeCents: carrier.estimatedFeeCents,
            actualFeeCents: carrier.actualFeeCents,
            lastSyncedAt: carrier.lastSyncedAt,
            createdAt: carrier.createdAt,
            updatedAt: carrier.updatedAt,
          }
        : null,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }

  private assertAdminActor(adminId: string) {
    if (!adminId?.trim()) throw new BadRequestException('缺少管理员操作人');
  }

  private assertSellerMerchant(merchantId: string) {
    if (!merchantId?.trim()) throw new BadRequestException('缺少配送商家');
  }

  private assertSellerActor(merchantId: string, staffId: string) {
    this.assertSellerMerchant(merchantId);
    if (!staffId?.trim()) throw new BadRequestException('缺少配送中心操作人');
  }

  private buildSfCustomerOrderId(batchId: string, attempt: number) {
    const digest = createHash('sha1').update(`${batchId}:${attempt}`).digest('hex').slice(0, 32);
    return `AIMM-DELIVERY-BATCH-${digest}`;
  }

  private async acquireBatchLock(tx: DeliveryPrismaTransaction, batchId: string) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${LOCK_NAMESPACE}),
        hashtext(${batchId})
      )
    `;
  }

  private parsePositiveInt(value: number | string | undefined, fallback: number) {
    const parsed = typeof value === 'number' ? value : value ? Number(value) : NaN;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parseDate(value: string | Date | undefined) {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('日期筛选值无效');
    return date;
  }

  private parseManualAdjustmentAmount(value: number | string | undefined) {
    const normalized = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN;
    if (!Number.isSafeInteger(normalized) || normalized === 0 || Math.abs(normalized) > 2_147_483_647) {
      throw new BadRequestException('调整金额必须是非零整数分');
    }
    return normalized;
  }

  private cents(value: number | null | undefined) {
    return Number.isFinite(value) ? Math.trunc(value ?? 0) : 0;
  }

  private getAddressPart(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = this.asString(record[key]);
      if (value) return value;
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

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toAuditPayload(value: unknown) {
    return JSON.parse(JSON.stringify(value));
  }
}
