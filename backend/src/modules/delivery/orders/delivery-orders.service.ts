import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';

type PaidCheckoutParams = {
  merchantOrderNo: string;
  providerTxnId: string;
  paidAt: Date;
  rawPayload?: Prisma.JsonValue;
};

type DeliveryCheckoutItemSnapshot = {
  cartItemId?: string;
  skuId: string;
  productId: string;
  merchantId: string;
  merchantName?: string;
  productTitle?: string;
  skuTitle?: string;
  imageUrl?: string | null;
  unitName?: string | null;
  quantity: number;
  basePriceCents: number;
  finalPriceCents: number;
  lineAmountCents: number;
};

type DeliveryMerchantPricingGroup = {
  merchantId: string;
  merchantName?: string;
  goodsAmountCents: number;
  shippingFeeCents: number;
  totalAmountCents?: number;
};

export class DeliveryProviderTxnConflictException extends ConflictException {
  constructor() {
    super('配送结算会话已绑定其他支付流水');
  }
}

@Injectable()
export class DeliveryOrdersService {
  private readonly logger = new Logger(DeliveryOrdersService.name);

  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryIdService: DeliveryIdService,
  ) {}

  async createOrderFromPaidCheckout(params: PaidCheckoutParams) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.deliveryPrisma.$transaction(
          async (tx) => {
            const checkout = await tx.deliveryCheckoutSession.findUnique({
              where: { merchantOrderNo: params.merchantOrderNo },
              include: {
                orders: {
                  include: {
                    subOrders: {
                      select: { id: true },
                    },
                  },
                },
              },
            });

            if (!checkout) {
              throw new NotFoundException('配送结算会话不存在');
            }

            this.assertProviderTxnIdConsistency(checkout.providerTxnId, params.providerTxnId);

            const existingOrder = checkout.orders[0] ?? null;
            if (
              existingOrder &&
              (checkout.status === 'PAID' || checkout.status === 'COMPLETED')
            ) {
              return {
                orderId: existingOrder.id,
                subOrderIds: existingOrder.subOrders.map((subOrder) => subOrder.id),
                idempotent: true,
                manifest: {
                  status: 'PENDING' as const,
                  trigger: 'skipped-existing-order' as const,
                },
              };
            }

            if (checkout.status !== 'ACTIVE') {
              throw new BadRequestException(`配送结算会话状态不可支付: ${checkout.status}`);
            }
            if (!checkout.paymentChannel) {
              throw new BadRequestException('配送结算会话缺少支付渠道');
            }

            const itemsSnapshot = this.parseItemsSnapshot(checkout.itemsSnapshot);
            const pricingGroups = this.parsePricingGroups(checkout.pricingSnapshot);
            const aggregatedQuantityBySkuId = itemsSnapshot.reduce((map, item) => {
              map.set(item.skuId, (map.get(item.skuId) ?? 0) + item.quantity);
              return map;
            }, new Map<string, number>());

            const skuRecords = await tx.deliveryProductSku.findMany({
              where: {
                id: {
                  in: Array.from(aggregatedQuantityBySkuId.keys()),
                },
              },
              select: {
                id: true,
                title: true,
                stock: true,
                isActive: true,
                supplyPriceCents: true,
                basePriceCents: true,
                product: {
                  select: {
                    id: true,
                    title: true,
                    status: true,
                    auditStatus: true,
                    merchantId: true,
                    merchant: {
                      select: {
                        status: true,
                      },
                    },
                  },
                },
              },
            });

            if (skuRecords.length !== aggregatedQuantityBySkuId.size) {
              throw new BadRequestException('配送 SKU 不存在或已下架');
            }

            const skuById = new Map(skuRecords.map((sku) => [sku.id, sku]));
            for (const item of itemsSnapshot) {
              const sku = skuById.get(item.skuId);
              if (!sku || !sku.isActive) {
                throw new BadRequestException('配送 SKU 已下架');
              }
              if (sku.product.status !== 'ACTIVE' || sku.product.auditStatus !== 'APPROVED') {
                throw new BadRequestException('配送商品不存在或未上架');
              }
              if (sku.product.merchantId !== item.merchantId || sku.product.merchant.status !== 'ACTIVE') {
                throw new BadRequestException('配送商家当前不可下单');
              }
              if (sku.stock < (aggregatedQuantityBySkuId.get(item.skuId) ?? item.quantity)) {
                throw new BadRequestException('库存不足');
              }
            }

            const paidAt = params.paidAt;
            const checkoutClaim = await tx.deliveryCheckoutSession.updateMany({
              where: { id: checkout.id, status: 'ACTIVE' },
              data: {
                status: 'PAID',
                providerTxnId: params.providerTxnId,
                paidAt,
              },
            });

            if (checkoutClaim.count !== 1) {
              const latest = await tx.deliveryCheckoutSession.findUnique({
                where: { id: checkout.id },
                include: {
                  orders: {
                    include: {
                      subOrders: {
                        select: { id: true },
                      },
                    },
                  },
                },
              });
              const latestOrder = latest?.orders[0] ?? null;
              this.assertProviderTxnIdConsistency(latest?.providerTxnId, params.providerTxnId);
              if (latestOrder) {
                return {
                  orderId: latestOrder.id,
                  subOrderIds: latestOrder.subOrders.map((subOrder) => subOrder.id),
                  idempotent: true,
                  manifest: {
                    status: 'PENDING' as const,
                    trigger: 'skipped-existing-order' as const,
                  },
                };
              }
              throw new ConflictException('配送结算会话已被其他回调处理');
            }

            const orderId = await this.deliveryIdService.nextInTransaction(tx, 'PSDD');

            for (const [skuId, quantity] of aggregatedQuantityBySkuId.entries()) {
              const sku = skuById.get(skuId)!;
              const updated = await tx.deliveryProductSku.updateMany({
                where: { id: skuId, stock: { gte: quantity } },
                data: { stock: { decrement: quantity } },
              });

              if (updated.count !== 1) {
                throw new ConflictException('配送 SKU 库存已变化，请刷新后重试');
              }

              await tx.deliveryInventoryLedger.create({
                data: {
                  skuId,
                  type: 'OUT',
                  quantity: -quantity,
                  beforeStock: sku.stock,
                  afterStock: sku.stock - quantity,
                  refType: 'DELIVERY_ORDER',
                  refId: orderId,
                  remark: '配送支付成功扣减库存',
                  createdByType: 'SYSTEM',
                  createdById: params.providerTxnId,
                },
              });
            }

            await tx.deliveryOrder.create({
              data: {
                id: orderId,
                userId: checkout.userId,
                unitId: checkout.unitId,
                checkoutSessionId: checkout.id,
                status: 'PENDING_SHIPMENT',
                unitSnapshot: checkout.unitSnapshot as Prisma.InputJsonValue,
                addressSnapshot: checkout.addressSnapshot as Prisma.InputJsonValue,
                itemsSnapshot: checkout.itemsSnapshot as Prisma.InputJsonValue,
                pricingSnapshot:
                  checkout.pricingSnapshot === null
                    ? Prisma.JsonNull
                    : (checkout.pricingSnapshot as Prisma.InputJsonValue),
                note: checkout.note,
                goodsAmountCents: checkout.goodsAmountCents,
                shippingFeeCents: checkout.shippingFeeCents,
                totalAmountCents: checkout.totalAmountCents,
                paidAt,
              },
            });

            const subOrderIds: string[] = [];
            const itemSnapshotsByMerchant = itemsSnapshot.reduce((map, item) => {
              const existing = map.get(item.merchantId) ?? [];
              existing.push(item);
              map.set(item.merchantId, existing);
              return map;
            }, new Map<string, DeliveryCheckoutItemSnapshot[]>());

            for (const pricingGroup of pricingGroups) {
              const subOrderId = await this.deliveryIdService.nextInTransaction(tx, 'PSZDD');
              subOrderIds.push(subOrderId);
              const merchantItems = itemSnapshotsByMerchant.get(pricingGroup.merchantId) ?? [];
              const supplyAmountCents = merchantItems.reduce((sum, item) => {
                const sku = skuById.get(item.skuId)!;
                return sum + sku.supplyPriceCents * item.quantity;
              }, 0);

              await tx.deliverySubOrder.create({
                data: {
                  id: subOrderId,
                  orderId,
                  merchantId: pricingGroup.merchantId,
                  status: 'PENDING_SHIPMENT',
                  supplyAmountCents,
                  shippingFeeShareCents: pricingGroup.shippingFeeCents,
                  totalAmountCents:
                    pricingGroup.totalAmountCents ??
                    pricingGroup.goodsAmountCents + pricingGroup.shippingFeeCents,
                  note: checkout.note,
                },
              });

              for (const item of merchantItems) {
                const sku = skuById.get(item.skuId)!;
                await tx.deliveryOrderItem.create({
                  data: {
                    orderId,
                    subOrderId,
                    productId: item.productId,
                    skuId: item.skuId,
                    productSnapshot: item as unknown as Prisma.InputJsonValue,
                    unitPriceCents: item.finalPriceCents,
                    supplyUnitPriceCents: sku.supplyPriceCents,
                    baseUnitPriceCents: sku.basePriceCents,
                    quantity: item.quantity,
                    lineAmountCents: item.lineAmountCents,
                    supplyAmountCents: sku.supplyPriceCents * item.quantity,
                    shippingFeeShareCents: 0,
                  },
                });
              }
            }

            await tx.deliveryPayment.upsert({
              where: { merchantOrderNo: params.merchantOrderNo },
              create: {
                id: params.merchantOrderNo,
                orderId,
                checkoutSessionId: checkout.id,
                channel: checkout.paymentChannel,
                scene: 'APP',
                amountCents: checkout.totalAmountCents,
                currency: 'CNY',
                status: 'PAID',
                merchantOrderNo: params.merchantOrderNo,
                providerTxnId: params.providerTxnId,
                requestPayload: Prisma.JsonNull,
                rawNotifyPayload: params.rawPayload ?? Prisma.JsonNull,
                exceptionSummary: null,
                paidAt,
              },
              update: {
                orderId,
                checkoutSessionId: checkout.id,
                channel: checkout.paymentChannel,
                amountCents: checkout.totalAmountCents,
                status: 'PAID',
                providerTxnId: params.providerTxnId,
                rawNotifyPayload: params.rawPayload ?? Prisma.JsonNull,
                exceptionSummary: null,
                paidAt,
              },
            });

            return {
              orderId,
              subOrderIds,
              idempotent: false,
              manifest: {
                status: 'PENDING' as const,
                trigger: 'queued' as const,
              },
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    this.logger.warn(`配送订单创建重试耗尽: merchantOrderNo=${params.merchantOrderNo}`);
    throw new ConflictException('配送订单创建冲突，请重试');
  }

  private assertProviderTxnIdConsistency(
    existingProviderTxnId: string | null | undefined,
    incomingProviderTxnId: string,
  ) {
    if (existingProviderTxnId && existingProviderTxnId !== incomingProviderTxnId) {
      throw new DeliveryProviderTxnConflictException();
    }
  }

  private parseItemsSnapshot(raw: Prisma.JsonValue): DeliveryCheckoutItemSnapshot[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException('配送结算快照缺失商品明细');
    }

    return raw as unknown as DeliveryCheckoutItemSnapshot[];
  }

  private parsePricingGroups(raw: Prisma.JsonValue | null): DeliveryMerchantPricingGroup[] {
    const merchantGroups = (raw as { merchantGroups?: DeliveryMerchantPricingGroup[] } | null)
      ?.merchantGroups;
    if (!Array.isArray(merchantGroups) || merchantGroups.length === 0) {
      throw new BadRequestException('配送结算快照缺失商家金额拆分');
    }

    return merchantGroups;
  }
}
