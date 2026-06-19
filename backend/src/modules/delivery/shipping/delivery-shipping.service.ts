import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { SfExpressService } from '../../shipment/sf-express.service';
import { UploadService } from '../../upload/upload.service';
import { fetchBinaryWithLimit } from '../../../common/utils/remote-binary-fetch.util';
import { createHash, randomUUID } from 'crypto';

type WaybillGenerationMarker = {
  waybillGeneration: {
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    token: string;
    startedAt: string;
    attempt: number;
    sfCustomerOrderId: string;
    completedAt?: string;
    failedAt?: string;
    failureReason?: string;
    remoteWaybillNo?: string | null;
    remoteSfOrderId?: string | null;
    error?: string;
  };
};

type DeliveryShipmentResult = {
  ok: true;
  idempotent: boolean;
  orderId: string;
  subOrderId: string;
  shipmentId: string;
  carrierCode: 'SF';
  carrierName: '顺丰速运';
  status: 'SHIPPED';
  waybillNo: string;
  waybillUrl: string | null;
  sfOrderId?: string | null;
};

type SellerShipmentContext = {
  orderId: string;
  subOrderId: string;
  shipmentId: string;
  merchantId: string;
  checkoutSessionId: string | null;
  estimatedUserShippingFeeCents: number;
  sender: CarrierParty;
  receiver: CarrierParty;
  cargo: string;
  totalWeightKg: number;
  marker: WaybillGenerationMarker;
  sfCustomerOrderId: string;
};

type CarrierParty = {
  name: string;
  tel: string;
  province: string;
  city: string;
  district: string;
  detail: string;
};

type DeliveryShippingListQuery = {
  page?: number;
  pageSize?: number;
};

type DeliveryShippingRecord = {
  id: string;
  orderId: string;
  subOrderId: string;
  merchantId: string;
  carrierCode: string;
  carrierName: string;
  status: string;
  trackingNo: string | null;
  waybillNo: string | null;
  waybillUrl: string | null;
  sfOrderId: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  estimatedUserShippingFeeCents: number | null;
  actualCarrierCostCents: number | null;
  carrierRecordNo: string | null;
};

const LOCK_NAMESPACE = 'delivery-waybill-suborder';
const WAYBILL_MARKER_TTL_MS = 15 * 60 * 1000;
const WAYBILL_PERSIST_CONFLICT_MESSAGE = '该配送子订单面单状态已变更，请刷新后重试';

class DeliveryWaybillPersistConflictError extends Error {
  constructor() {
    super(WAYBILL_PERSIST_CONFLICT_MESSAGE);
  }
}

@Injectable()
export class DeliveryShippingService {
  private readonly logger = new Logger(DeliveryShippingService.name);

  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly sfExpress: SfExpressService,
    private readonly uploadService: UploadService,
  ) {}

  async shipSubOrder(
    merchantId: string,
    deliverySellerStaffId: string,
    subOrderId: string,
  ): Promise<DeliveryShipmentResult> {
    const reserved = await this.reserveShipment(merchantId, subOrderId);
    if ('idempotent' in reserved) {
      return reserved;
    }

    let waybillResult: {
      waybillNo: string;
      waybillUrl: string | null;
      sfOrderId: string | null;
    };

    try {
      waybillResult = await this.createSfWaybill(reserved);
    } catch (error) {
      await this.clearWaybillGenerationMarker(reserved);
      throw error;
    }

    await this.persistGeneratedShipment(reserved, waybillResult, deliverySellerStaffId);

    return {
      ok: true,
      idempotent: false,
      orderId: reserved.orderId,
      subOrderId: reserved.subOrderId,
      shipmentId: reserved.shipmentId,
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      status: 'SHIPPED',
      waybillNo: waybillResult.waybillNo,
      waybillUrl: waybillResult.waybillUrl,
      sfOrderId: waybillResult.sfOrderId,
    };
  }

  async listSellerShipments(merchantId: string, subOrderId: string) {
    const subOrder = await this.deliveryPrisma.deliverySubOrder.findFirst({
      where: {
        id: subOrderId,
        merchantId,
      },
      select: {
        id: true,
        merchantId: true,
      },
    });

    if (!subOrder) {
      throw new NotFoundException('配送子订单不存在');
    }

    return this.deliveryPrisma.deliveryShipment.findMany({
      where: { subOrderId },
      orderBy: [{ shippedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listBuyerShipments(deliveryUserId: string, orderId: string) {
    const order = await this.deliveryPrisma.deliveryOrder.findFirst({
      where: {
        id: orderId,
        userId: deliveryUserId,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('配送订单不存在');
    }

    return this.deliveryPrisma.deliveryShipment.findMany({
      where: { orderId },
      orderBy: [{ shippedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listAdminShippingRecords(query: DeliveryShippingListQuery) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const skip = (page - 1) * pageSize;
    const where = {};

    const [total, shipments] = await Promise.all([
      this.deliveryPrisma.deliveryShipment.count({ where }),
      this.deliveryPrisma.deliveryShipment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    const subOrderIds = Array.from(new Set(shipments.map((shipment) => shipment.subOrderId)));
    const shippingCosts = subOrderIds.length
      ? await this.deliveryPrisma.deliveryShippingCost.findMany({
          where: {
            subOrderId: {
              in: subOrderIds,
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const latestCostBySubOrderId = shippingCosts.reduce((map, cost) => {
      if (!cost.subOrderId || map.has(cost.subOrderId)) {
        return map;
      }
      map.set(cost.subOrderId, cost);
      return map;
    }, new Map<string, (typeof shippingCosts)[number]>());

    const items: DeliveryShippingRecord[] = shipments.map((shipment) => {
      const cost = latestCostBySubOrderId.get(shipment.subOrderId);
      return {
        id: shipment.id,
        orderId: shipment.orderId,
        subOrderId: shipment.subOrderId,
        merchantId: shipment.merchantId,
        carrierCode: shipment.carrierCode,
        carrierName: shipment.carrierName,
        status: shipment.status,
        trackingNo: shipment.trackingNo,
        waybillNo: shipment.waybillNo,
        waybillUrl: shipment.waybillUrl,
        sfOrderId: shipment.sfOrderId,
        shippedAt: shipment.shippedAt,
        deliveredAt: shipment.deliveredAt,
        estimatedUserShippingFeeCents: cost?.estimatedUserShippingFeeCents ?? null,
        actualCarrierCostCents: cost?.actualCarrierCostCents ?? null,
        carrierRecordNo: cost?.carrierRecordNo ?? null,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  private async reserveShipment(
    merchantId: string,
    subOrderId: string,
  ): Promise<SellerShipmentContext | DeliveryShipmentResult> {
    return this.deliveryPrisma.$transaction(
      async (tx) => {
        await this.acquireWaybillGenerationLock(tx, `${merchantId}:${subOrderId}`);

        const subOrder = await tx.deliverySubOrder.findUnique({
          where: { id: subOrderId },
          include: {
            order: {
              select: {
                id: true,
                userId: true,
                status: true,
                checkoutSessionId: true,
                addressSnapshot: true,
              },
            },
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
            items: {
              select: {
                id: true,
                skuId: true,
                quantity: true,
                productSnapshot: true,
                sku: {
                  select: {
                    id: true,
                    weightGram: true,
                  },
                },
              },
            },
            shipments: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (!subOrder) {
          throw new NotFoundException('配送子订单不存在');
        }
        if (subOrder.merchantId !== merchantId) {
          throw new ForbiddenException('无权操作该配送子订单');
        }

        const existingShipment = subOrder.shipments[0] ?? null;
        if (existingShipment?.waybillNo) {
          return this.buildIdempotentResult(subOrder, existingShipment);
        }

        if (subOrder.status !== 'PENDING_SHIPMENT') {
          throw new BadRequestException(`配送子订单当前状态不可发货: ${subOrder.status}`);
        }

        if (this.hasActiveWaybillGenerationMarker(existingShipment?.rawCarrierPayload)) {
          throw new BadRequestException('该配送子订单面单正在生成，请稍后重试');
        }

        const sender = this.buildSender(subOrder.merchant);
        const receiver = this.buildReceiver(subOrder.order.addressSnapshot);
        const cargo = this.buildCargoSummary(subOrder.items);
        const totalWeightKg = this.calculateTotalWeightKg(subOrder.items);
        const attempt = this.getNextWaybillGenerationAttempt(existingShipment?.rawCarrierPayload);
        const sfCustomerOrderId = this.buildSfCustomerOrderId(subOrderId, merchantId, attempt);
        const marker = this.createWaybillGenerationMarker(attempt, sfCustomerOrderId);

        let shipmentId = existingShipment?.id ?? '';
        if (existingShipment) {
          const cas = await tx.deliveryShipment.updateMany({
            where: {
              id: existingShipment.id,
              waybillNo: null,
            },
            data: {
              carrierCode: 'SF',
              carrierName: '顺丰速运',
              rawCarrierPayload: marker as Prisma.InputJsonValue,
            },
          });

          if (cas.count !== 1) {
            throw new BadRequestException('该配送子订单面单状态已变更，请刷新后重试');
          }
          shipmentId = existingShipment.id;
        } else {
          const shipment = await tx.deliveryShipment.create({
            data: {
              orderId: subOrder.orderId,
              subOrderId,
              merchantId,
              status: 'INIT',
              carrierCode: 'SF',
              carrierName: '顺丰速运',
              trackingNo: null,
              waybillNo: null,
              waybillUrl: null,
              rawCarrierPayload: marker as Prisma.InputJsonValue,
            },
          });
          shipmentId = shipment.id;
        }

        return {
          orderId: subOrder.orderId,
          subOrderId,
          shipmentId,
          merchantId,
          checkoutSessionId: subOrder.order.checkoutSessionId ?? null,
          estimatedUserShippingFeeCents: subOrder.shippingFeeShareCents ?? 0,
          sender,
          receiver,
          cargo,
          totalWeightKg,
          marker,
          sfCustomerOrderId,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async createSfWaybill(context: SellerShipmentContext) {
    const orderResult = await this.sfExpress.createOrder({
      orderId: context.sfCustomerOrderId,
      sender: context.sender,
      receiver: context.receiver,
      cargo: context.cargo,
      totalWeight: context.totalWeightKg,
      packageCount: 1,
    });

    let waybillUrl: string | null = null;
    try {
      const printResult = await this.sfExpress.printWaybill(orderResult.waybillNo);
      const fetched = await fetchBinaryWithLimit(printResult.pdfUrl, {
        maxBytes: 10 * 1024 * 1024,
        timeoutMs: 15000,
        allowedContentTypes: ['application/pdf', 'application/octet-stream'],
      });
      const uploaded = await this.uploadService.uploadBuffer(
        fetched.buffer,
        'waybills',
        '.pdf',
        'application/pdf',
      );
      waybillUrl = uploaded.url;
    } catch (error: any) {
      this.logger.warn(
        `delivery waybill pdf persist skipped: subOrderId=${context.subOrderId}, reason=${error?.message ?? 'unknown'}`,
      );
    }

    return {
      waybillNo: orderResult.waybillNo,
      waybillUrl,
      sfOrderId: orderResult.sfOrderId ?? null,
    };
  }

  private async persistGeneratedShipment(
    context: SellerShipmentContext,
    waybillResult: {
      waybillNo: string;
      waybillUrl: string | null;
      sfOrderId: string | null;
    },
    deliverySellerStaffId: string,
  ) {
    const shippedAt = new Date();

    let persisted = false;
    try {
      persisted = await this.deliveryPrisma.$transaction(
        async (tx) => {
          const shipmentPersist = await tx.deliveryShipment.updateMany({
            where: {
              id: context.shipmentId,
              waybillNo: null,
              rawCarrierPayload: {
                equals: context.marker as Prisma.InputJsonValue,
              },
            },
            data: {
              status: 'SHIPPED',
              trackingNo: waybillResult.waybillNo,
              waybillNo: waybillResult.waybillNo,
              waybillUrl: waybillResult.waybillUrl,
              sfOrderId: waybillResult.sfOrderId,
              senderInfoSnapshot: context.sender as Prisma.InputJsonValue,
              receiverInfoSnapshot: context.receiver as Prisma.InputJsonValue,
              rawCarrierPayload: this.createCompletedWaybillGenerationPayload(context),
              shippedAt,
            },
          });

          if (shipmentPersist.count !== 1) {
            return false;
          }

          const subOrderPersist = await tx.deliverySubOrder.updateMany({
            where: {
              id: context.subOrderId,
              status: 'PENDING_SHIPMENT',
            },
            data: {
              status: 'SHIPPED',
              shippedAt,
              lastOperatorStaffId: deliverySellerStaffId,
            },
          });

          if (subOrderPersist.count !== 1) {
            throw new DeliveryWaybillPersistConflictError();
          }

          const remainingPendingCount = await tx.deliverySubOrder.count({
            where: {
              orderId: context.orderId,
              status: 'PENDING_SHIPMENT',
            },
          });

          if (remainingPendingCount === 0) {
            await tx.deliveryOrder.updateMany({
              where: {
                id: context.orderId,
                status: 'PENDING_SHIPMENT',
              },
              data: {
                status: 'SHIPPED',
                shippedAt,
              },
            });
          }

          await tx.deliveryShippingCost.create({
            data: {
              checkoutSessionId: context.checkoutSessionId,
              orderId: context.orderId,
              subOrderId: context.subOrderId,
              merchantId: context.merchantId,
              skuId: null,
              estimatedUserShippingFeeCents: context.estimatedUserShippingFeeCents,
              actualCarrierCostCents: null,
              carrierCode: 'SF',
              carrierRecordNo: waybillResult.sfOrderId,
            },
          });

          return true;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      await this.compensateFailedWaybillPersist(context, waybillResult);
      if (error instanceof DeliveryWaybillPersistConflictError) {
        throw new BadRequestException(WAYBILL_PERSIST_CONFLICT_MESSAGE);
      }
      throw error;
    }

    if (persisted) {
      return;
    }

    const currentShipment = await this.deliveryPrisma.deliveryShipment.findUnique({
      where: { id: context.shipmentId },
      select: {
        waybillNo: true,
      },
    });
    if (currentShipment?.waybillNo === waybillResult.waybillNo) {
      return;
    }

    await this.compensateFailedWaybillPersist(context, waybillResult);
    throw new BadRequestException(WAYBILL_PERSIST_CONFLICT_MESSAGE);
  }

  private async compensateFailedWaybillPersist(
    context: SellerShipmentContext,
    waybillResult: {
      waybillNo: string;
      waybillUrl: string | null;
      sfOrderId: string | null;
    },
  ) {
    try {
      await this.sfExpress.cancelOrder(
        waybillResult.sfOrderId ?? '',
        waybillResult.waybillNo,
      );
      await this.clearWaybillGenerationMarker(context);
    } catch (error: any) {
      await this.markWaybillGenerationFailed(context, waybillResult, error);
    }
  }

  private buildIdempotentResult(
    subOrder: {
      orderId: string;
      id: string;
    },
    shipment: {
      id: string;
      waybillNo: string | null;
      waybillUrl: string | null;
      sfOrderId: string | null;
    },
  ): DeliveryShipmentResult {
    return {
      ok: true,
      idempotent: true,
      orderId: subOrder.orderId,
      subOrderId: subOrder.id,
      shipmentId: shipment.id,
      carrierCode: 'SF',
      carrierName: '顺丰速运',
      status: 'SHIPPED',
      waybillNo: shipment.waybillNo ?? '',
      waybillUrl: shipment.waybillUrl,
      sfOrderId: shipment.sfOrderId,
    };
  }

  private buildSender(merchant: {
    name: string;
    contactName: string;
    contactPhone: string;
    servicePhone: string | null;
    addressJson: Prisma.JsonValue | null;
  }): CarrierParty {
    const address = this.parseJsonObject(merchant.addressJson, '配送商家发件地址');
    const province = this.getStructuredAddressPart(address, ['provinceName', 'province']);
    const city = this.getStructuredAddressPart(address, ['cityName', 'city']);
    const district = this.getStructuredAddressPart(address, ['districtName', 'district']);
    const detail = this.getStructuredAddressPart(address, ['detailAddress', 'detail']);

    if (!province || !city || !detail) {
      throw new BadRequestException('配送商家发件地址缺少省/市/详细地址，无法生成顺丰面单');
    }

    return {
      name: String(merchant.contactName || merchant.name).trim(),
      tel: String(merchant.contactPhone || merchant.servicePhone || '').trim(),
      province,
      city,
      district,
      detail,
    };
  }

  private buildReceiver(addressSnapshot: Prisma.JsonValue): CarrierParty {
    const address = this.parseJsonObject(addressSnapshot, '配送订单收件地址');

    const name = String(address.recipientName ?? '').trim();
    const tel = String(address.phone ?? '').trim();
    const province = this.getStructuredAddressPart(address, ['provinceName', 'province']);
    const city = this.getStructuredAddressPart(address, ['cityName', 'city']);
    const district = this.getStructuredAddressPart(address, ['districtName', 'district']);
    const detail = this.getStructuredAddressPart(address, ['detailAddress', 'detail']);

    if (!name || !tel || !province || !city || !detail) {
      throw new BadRequestException('配送订单收件地址缺少姓名/电话/省市详细地址，无法生成顺丰面单');
    }

    return {
      name,
      tel,
      province,
      city,
      district,
      detail,
    };
  }

  private buildCargoSummary(
    items: Array<{
      productSnapshot: Prisma.JsonValue;
    }>,
  ) {
    const firstSnapshot = this.parseJsonObject(items[0]?.productSnapshot ?? null, '配送订单商品快照');
    const firstTitle = String(firstSnapshot.productTitle ?? firstSnapshot.title ?? '商品').trim() || '商品';
    return items.length > 1 ? `${firstTitle} 等${items.length}件` : firstTitle;
  }

  private calculateTotalWeightKg(
    items: Array<{
      quantity: number;
      productSnapshot: Prisma.JsonValue;
      sku: { weightGram: number } | null;
    }>,
  ) {
    const totalWeightGram = items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException('配送订单商品数量异常，无法生成顺丰面单');
      }

      const snapshot = this.parseJsonObject(item.productSnapshot, '配送订单商品快照');
      const rawWeight = snapshot.weightGram ?? item.sku?.weightGram ?? null;
      const weightGram = Number(rawWeight);
      if (!Number.isFinite(weightGram) || weightGram <= 0) {
        throw new BadRequestException('配送订单商品缺少有效 weightGram，无法生成顺丰面单');
      }

      return sum + Math.ceil(weightGram) * quantity;
    }, 0);

    return Number((totalWeightGram / 1000).toFixed(3));
  }

  private parseJsonObject(value: Prisma.JsonValue | null, label: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${label}格式错误`);
    }

    return value as Record<string, any>;
  }

  private getStructuredAddressPart(
    address: Record<string, any>,
    keys: string[],
  ): string {
    for (const key of keys) {
      const value = String(address[key] ?? '').trim();
      if (value) {
        return value;
      }
    }
    return '';
  }

  private createWaybillGenerationMarker(
    attempt: number,
    sfCustomerOrderId: string,
  ): WaybillGenerationMarker {
    return {
      waybillGeneration: {
        status: 'IN_PROGRESS',
        token: randomUUID(),
        startedAt: new Date().toISOString(),
        attempt,
        sfCustomerOrderId,
      },
    };
  }

  private createCompletedWaybillGenerationPayload(context: SellerShipmentContext): Prisma.InputJsonValue {
    return {
      waybillGeneration: {
        ...context.marker.waybillGeneration,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
      },
    };
  }

  private async clearWaybillGenerationMarker(context: SellerShipmentContext) {
    await this.deliveryPrisma.$transaction(
      (tx) =>
        tx.deliveryShipment.updateMany({
          where: {
            id: context.shipmentId,
            waybillNo: null,
            rawCarrierPayload: {
              equals: context.marker as Prisma.InputJsonValue,
            },
          },
          data: {
            rawCarrierPayload: Prisma.JsonNull,
          },
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async markWaybillGenerationFailed(
    context: SellerShipmentContext,
    waybillResult: {
      waybillNo: string;
      waybillUrl: string | null;
      sfOrderId: string | null;
    },
    error: Error,
  ) {
    await this.deliveryPrisma.$transaction(
      (tx) =>
        tx.deliveryShipment.updateMany({
          where: {
            id: context.shipmentId,
            waybillNo: null,
            rawCarrierPayload: {
              equals: context.marker as Prisma.InputJsonValue,
            },
          },
          data: {
            rawCarrierPayload: {
              waybillGeneration: {
                ...context.marker.waybillGeneration,
                status: 'FAILED',
                failedAt: new Date().toISOString(),
                failureReason: 'FINAL_PERSIST_CANCEL_FAILED',
                remoteWaybillNo: waybillResult.waybillNo,
                remoteSfOrderId: waybillResult.sfOrderId,
                error: error.message,
              },
            } as Prisma.InputJsonValue,
          },
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private getNextWaybillGenerationAttempt(rawCarrierPayload: Prisma.JsonValue | null): number {
    const marker = this.getWaybillGenerationMarker(rawCarrierPayload);
    const attempt = Number(marker?.attempt ?? 0);
    const completedAttempt =
      marker?.status === 'COMPLETED' && Number.isInteger(attempt) && attempt > 0
        ? attempt
        : 0;
    return completedAttempt + 1;
  }

  private hasActiveWaybillGenerationMarker(rawCarrierPayload: Prisma.JsonValue | null) {
    const marker = this.getWaybillGenerationMarker(rawCarrierPayload);
    if (!marker || marker.status !== 'IN_PROGRESS') {
      return false;
    }

    const startedAt = Date.parse(String(marker.startedAt ?? ''));
    if (Number.isNaN(startedAt)) {
      return true;
    }

    return Date.now() - startedAt < WAYBILL_MARKER_TTL_MS;
  }

  private getWaybillGenerationMarker(rawCarrierPayload: Prisma.JsonValue | null) {
    if (!rawCarrierPayload || typeof rawCarrierPayload !== 'object' || Array.isArray(rawCarrierPayload)) {
      return null;
    }

    const marker = (rawCarrierPayload as Record<string, any>).waybillGeneration;
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
      return null;
    }

    return marker as {
      status?: string;
      token?: string;
      startedAt?: string;
      attempt?: number;
      sfCustomerOrderId?: string;
    };
  }

  private buildSfCustomerOrderId(
    subOrderId: string,
    merchantId: string,
    attempt: number,
  ) {
    const digest = createHash('sha1')
      .update(`${subOrderId}:${merchantId}:${attempt}`)
      .digest('hex')
      .slice(0, 32);

    return `AIMM-DELIVERY-WB-${digest}`;
  }

  private async acquireWaybillGenerationLock(
    tx: Prisma.TransactionClient,
    resourceKey: string,
  ) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${LOCK_NAMESPACE}),
        hashtext(${resourceKey})
      )
    `;
  }
}
