import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeliveryShipmentStatus, Prisma } from '../../generated/delivery-client';
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

    if (!shipment) {
      throw new NotFoundException('配送物流单号未找到');
    }

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
