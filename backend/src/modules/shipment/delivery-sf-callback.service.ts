import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DeliveryOrderStatus,
  DeliveryPickupBatchStatus,
  DeliveryPickupStatus,
  DeliveryShipmentStatus,
  Prisma,
} from '../../generated/delivery-client';
import { DeliveryPrismaService } from '../../delivery-prisma/delivery-prisma.service';
import { sanitizeStringForLog } from '../../common/logging/log-sanitizer';
import { maskTrackingNo } from '../../common/security/privacy-mask';
import type { SfTrackingEvent } from './sf-express.service';

@Injectable()
export class DeliverySfCallbackService {
  private readonly logger = new Logger(DeliverySfCallbackService.name);

  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async handleSfCallback(
    trackingNo: string,
    status: string,
    events: SfTrackingEvent[] | undefined,
    rawPayload: any,
  ) {
    const shipment = await this.deliveryPrisma.deliveryShipment.findFirst({
      where: { OR: [{ waybillNo: trackingNo }, { trackingNo }] },
      orderBy: { createdAt: 'desc' },
    });

    if (!shipment) return this.handlePickupWaybillCallback(trackingNo, status, events, rawPayload);

    const freshEvents = this.filterFreshEvents(events, shipment);
    if ((events?.length ?? 0) > 0 && freshEvents.length === 0) {
      this.logger.warn(
        `跳过配送 SF 旧路由回调: shipmentId=${shipment.id}, trackingNo=${maskTrackingNo(trackingNo) ?? 'N/A'}, rawStatus=${sanitizeStringForLog(status, { maxStringLength: 64 })}`,
      );
      return { ok: true, handledBy: 'delivery' as const };
    }

    const nextStatus = this.resolveDeliveryShipmentStatus(status, shipment.status, freshEvents);
    const now = new Date();
    const shouldUpdateStatus =
      shipment.status !== DeliveryShipmentStatus.DELIVERED ||
      nextStatus === DeliveryShipmentStatus.DELIVERED;
    const nextPayload = this.appendCallbackPayload(
      shipment.rawCarrierPayload,
      trackingNo,
      nextStatus,
      freshEvents,
      rawPayload,
      now,
    );

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await tx.deliveryShipment.update({
          where: { id: shipment.id },
          data: {
            ...(shouldUpdateStatus ? { status: nextStatus } : {}),
            ...(nextStatus === DeliveryShipmentStatus.DELIVERED && !shipment.deliveredAt
              ? { deliveredAt: now }
              : {}),
            rawCarrierPayload: nextPayload as Prisma.InputJsonValue,
          },
        });

        if (nextStatus !== DeliveryShipmentStatus.DELIVERED) {
          return;
        }

        await tx.deliverySubOrder.updateMany({
          where: { id: shipment.subOrderId, status: 'SHIPPED' },
          data: {
            status: 'DELIVERED',
            deliveredAt: now,
          },
        });

        const undeliveredSubOrderCount = await tx.deliverySubOrder.count({
          where: {
            orderId: shipment.orderId,
            status: {
              notIn: ['DELIVERED', 'COMPLETED', 'CANCELED'],
            },
          },
        });

        if (undeliveredSubOrderCount === 0) {
          await tx.deliveryOrder.updateMany({
            where: { id: shipment.orderId, status: 'SHIPPED' },
            data: {
              status: 'DELIVERED',
              deliveredAt: now,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.logger.log(
      `配送物流回调处理完成: ${maskTrackingNo(trackingNo) ?? 'N/A'} → ${sanitizeStringForLog(nextStatus, { maxStringLength: 64 })}`,
    );
    return { ok: true, handledBy: 'delivery' as const };
  }

  private async handlePickupWaybillCallback(
    trackingNo: string,
    status: string,
    events: SfTrackingEvent[] | undefined,
    rawPayload: any,
  ) {
    const waybill = await this.deliveryPrisma.deliveryCarrierWaybill.findUnique({
      where: { trackingNo },
      include: {
        carrierOrder: {
          include: {
            batch: {
              include: { items: true },
            },
          },
        },
      },
    });
    if (!waybill) throw new NotFoundException('配送物流单号未找到');

    const freshEvents = this.filterFreshEvents(events, waybill);
    if ((events?.length ?? 0) > 0 && freshEvents.length === 0) {
      this.logger.warn(
        `跳过配送批次 SF 旧路由回调: waybillId=${waybill.id}, trackingNo=${maskTrackingNo(trackingNo) ?? 'N/A'}`,
      );
      return { ok: true, handledBy: 'delivery' as const };
    }

    const currentStatus = this.normalizeWaybillStatus(waybill.status);
    const nextStatus = this.resolveDeliveryShipmentStatus(status, currentStatus, freshEvents);
    const now = new Date();

    await this.deliveryPrisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${'delivery-pickup-sf-waybill'}),
            hashtext(${waybill.carrierOrder.batchId})
          )
        `;
        const latestWaybill = await tx.deliveryCarrierWaybill.findUnique({
          where: { id: waybill.id },
          include: {
            carrierOrder: {
              include: {
                waybills: true,
                batch: { include: { items: true } },
              },
            },
          },
        });
        if (!latestWaybill) throw new NotFoundException('配送批次顺丰运单不存在');

        const latestCurrentStatus = this.normalizeWaybillStatus(latestWaybill.status);
        const resolvedStatus = this.resolveDeliveryShipmentStatus(
          status,
          latestCurrentStatus,
          freshEvents,
        );
        const payload = this.appendCallbackPayload(
          latestWaybill.rawPayload,
          trackingNo,
          resolvedStatus,
          freshEvents,
          rawPayload,
          now,
        );
        await tx.deliveryCarrierWaybill.update({
          where: { id: latestWaybill.id },
          data: {
            status: resolvedStatus,
            deliveredAt:
              resolvedStatus === DeliveryShipmentStatus.DELIVERED
                ? latestWaybill.deliveredAt ?? now
                : undefined,
            lastSyncedAt: now,
            rawPayload: payload as Prisma.InputJsonValue,
          },
        });

        const waybillStatuses = latestWaybill.carrierOrder.waybills.map((item) =>
          item.id === latestWaybill.id ? resolvedStatus : this.normalizeWaybillStatus(item.status),
        );
        const batchStatus = this.resolveBatchStatus(waybillStatuses);
        await tx.deliveryCarrierOrder.update({
          where: { id: latestWaybill.carrierOrderId },
          data: {
            status: batchStatus,
            lastSyncedAt: now,
            detailPayload: this.toJson({ source: 'SF_CALLBACK', trackingNo, status: resolvedStatus }),
          },
        });

        const batch = latestWaybill.carrierOrder.batch;
        const batchData: Prisma.DeliveryPickupBatchUpdateInput = {
          status: batchStatus,
          lastOperatorType: 'SYSTEM',
          lastOperatorId: 'SF_CALLBACK',
        };
        if (batchStatus === DeliveryPickupBatchStatus.LOADED) {
          batchData.loadedAt = batch.loadedAt ?? now;
        }
        if (batchStatus === DeliveryPickupBatchStatus.COMPLETED) {
          batchData.loadedAt = batch.loadedAt ?? now;
          batchData.completedAt = batch.completedAt ?? now;
          await this.completeBatchItems(tx, batch);
        }
        await tx.deliveryPickupBatch.update({ where: { id: batch.id }, data: batchData });
        await this.refreshPickupStatuses(tx, batch.orderId, batch.subOrderId, now);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.logger.log(
      `配送批次物流回调处理完成: ${maskTrackingNo(trackingNo) ?? 'N/A'} → ${sanitizeStringForLog(nextStatus, { maxStringLength: 64 })}`,
    );
    return { ok: true, handledBy: 'delivery' as const };
  }

  private normalizeWaybillStatus(status: string): DeliveryShipmentStatus {
    return Object.values(DeliveryShipmentStatus).includes(status as DeliveryShipmentStatus)
      ? (status as DeliveryShipmentStatus)
      : DeliveryShipmentStatus.INIT;
  }

  private resolveBatchStatus(statuses: DeliveryShipmentStatus[]) {
    if (statuses.length > 0 && statuses.every((item) => item === DeliveryShipmentStatus.DELIVERED)) {
      return DeliveryPickupBatchStatus.COMPLETED;
    }
    if (statuses.some((item) => item === DeliveryShipmentStatus.EXCEPTION)) {
      return DeliveryPickupBatchStatus.EXCEPTION;
    }
    if (statuses.some((item) => item === DeliveryShipmentStatus.IN_TRANSIT)) {
      return DeliveryPickupBatchStatus.DELIVERING;
    }
    if (statuses.some((item) => item === DeliveryShipmentStatus.SHIPPED)) {
      return DeliveryPickupBatchStatus.LOADED;
    }
    return DeliveryPickupBatchStatus.WAITING_DRIVER;
  }

  private async completeBatchItems(
    tx: Prisma.TransactionClient,
    batch: {
      id: string;
      items: Array<{
        id: string;
        orderItemId: string;
        subOrderId: string;
        quantity: number;
        pickedQuantity: number;
      }>;
    },
  ) {
    for (const item of batch.items) {
      const delta = Math.max(0, item.quantity - item.pickedQuantity);
      if (delta === 0) continue;
      const batchUpdate = await tx.deliveryPickupBatchItem.updateMany({
        where: { id: item.id, batchId: batch.id, pickedQuantity: item.pickedQuantity },
        data: { pickedQuantity: item.quantity },
      });
      if (batchUpdate.count !== 1) {
        throw new ConflictException('配送批次明细已变化');
      }
      const itemUpdate = await tx.deliveryOrderItem.updateMany({
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
      if (itemUpdate.count !== 1) {
        throw new ConflictException('订单商品配送数量或预留数量不一致');
      }
    }
  }

  private async refreshPickupStatuses(
    tx: Prisma.TransactionClient,
    orderId: string,
    subOrderId: string,
    now: Date,
  ) {
    const [orderBatches, subOrderBatches] = await Promise.all([
      tx.deliveryPickupBatch.findMany({ where: { orderId }, select: { status: true } }),
      tx.deliveryPickupBatch.findMany({ where: { subOrderId }, select: { status: true } }),
    ]);
    const resolvePickupStatus = (statuses: DeliveryPickupBatchStatus[]) => {
      if (statuses.length > 0 && statuses.every((item) => item === DeliveryPickupBatchStatus.COMPLETED)) {
        return DeliveryPickupStatus.ALL_PICKED;
      }
      const activeStatuses: DeliveryPickupBatchStatus[] = [
        DeliveryPickupBatchStatus.LOADED,
        DeliveryPickupBatchStatus.DELIVERING,
        DeliveryPickupBatchStatus.COMPLETED,
      ];
      if (statuses.some((item) => activeStatuses.includes(item))) {
        return DeliveryPickupStatus.PARTIAL_PICKED;
      }
      return DeliveryPickupStatus.NOT_STARTED;
    };
    const subPickup = resolvePickupStatus(subOrderBatches.map((item) => item.status));
    const orderPickup = resolvePickupStatus(orderBatches.map((item) => item.status));
    const currentSubOrder = await tx.deliverySubOrder.findUnique({
      where: { id: subOrderId },
      select: { status: true, shippedAt: true, deliveredAt: true },
    });
    const terminalStatuses: DeliveryOrderStatus[] = [
      DeliveryOrderStatus.DELIVERED,
      DeliveryOrderStatus.COMPLETED,
      DeliveryOrderStatus.CANCELED,
    ];
    const subData: Prisma.DeliverySubOrderUpdateInput = { pickupStatus: subPickup };
    if (currentSubOrder && !terminalStatuses.includes(currentSubOrder.status)) {
      if (subPickup === DeliveryPickupStatus.ALL_PICKED) {
        subData.status = DeliveryOrderStatus.DELIVERED;
        subData.shippedAt = currentSubOrder.shippedAt ?? now;
        subData.deliveredAt = currentSubOrder.deliveredAt ?? now;
      } else if (subPickup === DeliveryPickupStatus.PARTIAL_PICKED) {
        subData.status = DeliveryOrderStatus.SHIPPED;
        subData.shippedAt = currentSubOrder.shippedAt ?? now;
      }
    }
    await tx.deliverySubOrder.update({ where: { id: subOrderId }, data: subData });
    const subOrders = await tx.deliverySubOrder.findMany({
      where: { orderId },
      select: { status: true },
    });
    const deliveredStatuses: DeliveryOrderStatus[] = [
      DeliveryOrderStatus.DELIVERED,
      DeliveryOrderStatus.COMPLETED,
      DeliveryOrderStatus.CANCELED,
    ];
    const allDelivered =
      subOrders.length > 0 &&
      subOrders.every((item) => deliveredStatuses.includes(item.status));
    const currentOrder = await tx.deliveryOrder.findUnique({
      where: { id: orderId },
      select: { status: true, shippedAt: true, deliveredAt: true },
    });
    const orderData: Prisma.DeliveryOrderUpdateInput = { pickupStatus: orderPickup };
    if (currentOrder && !terminalStatuses.includes(currentOrder.status)) {
      if (allDelivered) {
        orderData.status = DeliveryOrderStatus.DELIVERED;
        orderData.shippedAt = currentOrder.shippedAt ?? now;
        orderData.deliveredAt = currentOrder.deliveredAt ?? now;
      } else if (orderPickup === DeliveryPickupStatus.PARTIAL_PICKED) {
        orderData.status = DeliveryOrderStatus.SHIPPED;
        orderData.shippedAt = currentOrder.shippedAt ?? now;
      }
    }
    await tx.deliveryOrder.update({ where: { id: orderId }, data: orderData });
  }

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private parseEventTime(raw: string | undefined | null): { date: Date; valid: boolean } {
    if (!raw || typeof raw !== 'string') return { date: new Date(), valid: false };
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      return { date: new Date(), valid: false };
    }
    return { date, valid: true };
  }

  private filterFreshEvents<T extends SfTrackingEvent>(
    events: T[] | undefined,
    shipment: { createdAt?: Date | null; shippedAt?: Date | null },
  ): T[] {
    if (!events?.length) return [];
    const reference = shipment.shippedAt ?? shipment.createdAt;
    if (!reference) return events;

    const earliestAllowed = reference.getTime() - 60 * 60 * 1000;
    return events.filter((event) => {
      const parsed = this.parseEventTime(event.time);
      return !parsed.valid || parsed.date.getTime() >= earliestAllowed;
    });
  }

  private resolveDeliveryShipmentStatus(
    incomingStatus: string,
    currentStatus: DeliveryShipmentStatus,
    freshEvents: SfTrackingEvent[],
  ): DeliveryShipmentStatus {
    if (currentStatus === DeliveryShipmentStatus.DELIVERED && incomingStatus !== DeliveryShipmentStatus.DELIVERED) {
      return DeliveryShipmentStatus.DELIVERED;
    }

    if (Object.values(DeliveryShipmentStatus).includes(incomingStatus as DeliveryShipmentStatus)) {
      return incomingStatus as DeliveryShipmentStatus;
    }

    if (freshEvents.some((event) => event.opCode === '80' || event.opCode === '44')) {
      return DeliveryShipmentStatus.DELIVERED;
    }
    return DeliveryShipmentStatus.IN_TRANSIT;
  }

  private appendCallbackPayload(
    rawCarrierPayload: Prisma.JsonValue | null,
    trackingNo: string,
    status: DeliveryShipmentStatus,
    events: SfTrackingEvent[],
    rawPayload: any,
    receivedAt: Date,
  ) {
    const base =
      rawCarrierPayload && typeof rawCarrierPayload === 'object' && !Array.isArray(rawCarrierPayload)
        ? { ...(rawCarrierPayload as Record<string, unknown>) }
        : {};
    const existingCallbacks = Array.isArray(base.sfCallbacks) ? base.sfCallbacks : [];

    return {
      ...base,
      sfCallbacks: [
        ...existingCallbacks.slice(-49),
        {
          receivedAt: receivedAt.toISOString(),
          trackingNo,
          status,
          events,
          rawPayload,
        },
      ],
    };
  }
}
