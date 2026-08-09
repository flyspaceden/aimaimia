import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  DeliveryAuditActorType,
  DeliveryCarrierProvider,
  DeliveryPickupMode,
  DeliveryShippingCostLedgerType,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryIdService } from '../common/delivery-id.service';
import {
  CheckoutCartItemForPickup,
  DeliveryPickupPlanItemInput,
  DeliveryPickupPlanSnapshot,
  DeliveryPickupSnapshotResult,
} from './delivery-pickup.types';
import {
  DeliveryShippingRuleForEstimate,
  resolveDeliveryShippingFee,
} from '../checkout/delivery-shipping-fee.util';

type MerchantGroupInput = {
  merchantId: string;
  merchantName?: string;
  goodsAmountCents: number;
};

type CreateBatchesParams = {
  orderId: string;
  checkout: {
    id: string;
    pickupMode?: DeliveryPickupMode | null;
    plannedPickupCount?: number | null;
    pickupPlanSnapshot?: Prisma.JsonValue | null;
    prepaidPickupShippingFeeCents?: number | null;
    shippingFeeCents?: number | null;
    itemsSnapshot: Prisma.JsonValue;
    pricingSnapshot?: Prisma.JsonValue | null;
  };
  subOrderIdsByMerchantId: Map<string, string>;
  createdByProviderTxnId: string;
};

type OrderItemForPickup = {
  id: string;
  subOrderId: string;
  skuId: string;
  quantity: number;
  reservedPickupQuantity: number;
  productSnapshot: Prisma.JsonValue;
};

@Injectable()
export class DeliveryPickupPlanService {
  constructor(private readonly deliveryIdService: DeliveryIdService) {}

  async buildCheckoutPickupSnapshot(params: {
    pickupMode: DeliveryPickupMode;
    plannedPickupCount: number;
    cartItems: CheckoutCartItemForPickup[];
    merchantGroups: MerchantGroupInput[];
    pickupPlanItems?: DeliveryPickupPlanItemInput[];
    fallbackShippingFeeCents: number;
    shippingRules?: DeliveryShippingRuleForEstimate[];
  }): Promise<DeliveryPickupSnapshotResult> {
    if (!params.cartItems.length) {
      throw new BadRequestException('配送结算快照缺少商品明细');
    }

    const pickupMode = params.pickupMode ?? DeliveryPickupMode.SINGLE;
    const plannedPickupCount =
      pickupMode === DeliveryPickupMode.MULTI_BATCH
        ? Math.max(1, Math.trunc(params.plannedPickupCount || 0))
        : 1;

    if (
      pickupMode === DeliveryPickupMode.MULTI_BATCH &&
      plannedPickupCount < 2
    ) {
      throw new BadRequestException('MULTI_BATCH 至少需要 2 个配送批次');
    }

    const totalQuantity = params.cartItems.reduce(
      (sum, item) => sum + Math.max(0, Math.trunc(item.quantity)),
      0,
    );
    if (
      pickupMode === DeliveryPickupMode.MULTI_BATCH &&
      plannedPickupCount > totalQuantity
    ) {
      throw new BadRequestException('配送批次不能超过所选商品总数量');
    }

    const cartItemById = new Map(
      params.cartItems.map((item) => [item.cartItemId, item]),
    );
    const planAssignments =
      pickupMode === DeliveryPickupMode.SINGLE
        ? params.cartItems.map((item) => ({
            cartItemId: item.cartItemId,
            batchNo: 1,
            quantity: item.quantity,
          }))
        : params.pickupPlanItems?.length
          ? this.normalizeExplicitPlanItems(
              params.pickupPlanItems,
              cartItemById,
              plannedPickupCount,
            )
          : this.buildDefaultPlanItems(params.cartItems, plannedPickupCount);
    const batchLineAmountByItemAndBatch = this.buildBatchLineAmountAllocationMap(
      params.cartItems,
      planAssignments,
    );

    const plannedQuantityByCartItemId = planAssignments.reduce((map, item) => {
      map.set(item.cartItemId, (map.get(item.cartItemId) ?? 0) + item.quantity);
      return map;
    }, new Map<string, number>());

    for (const cartItem of params.cartItems) {
      if ((plannedQuantityByCartItemId.get(cartItem.cartItemId) ?? 0) !== cartItem.quantity) {
        throw new BadRequestException('配送计划数量与购物车数量不一致');
      }
    }

    if (pickupMode === DeliveryPickupMode.MULTI_BATCH) {
      const usedBatchNos = new Set(planAssignments.map((item) => item.batchNo));
      for (let batchNo = 1; batchNo <= plannedPickupCount; batchNo += 1) {
        if (!usedBatchNos.has(batchNo)) {
          throw new BadRequestException('配送计划必须覆盖每个计划批次');
        }
      }
    }

    const batchesByMerchantId = new Map<
      string,
      Map<number, Array<{ cartItemId: string; quantity: number }>>
    >();
    for (const planItem of planAssignments) {
      const cartItem = cartItemById.get(planItem.cartItemId);
      if (!cartItem) {
        throw new BadRequestException('配送计划包含未知购物车商品');
      }

      const merchantBatches =
        batchesByMerchantId.get(cartItem.merchantId) ?? new Map<number, Array<{ cartItemId: string; quantity: number }>>();
      const batchItems = merchantBatches.get(planItem.batchNo) ?? [];
      batchItems.push({
        cartItemId: planItem.cartItemId,
        quantity: planItem.quantity,
      });
      merchantBatches.set(planItem.batchNo, batchItems);
      batchesByMerchantId.set(cartItem.merchantId, merchantBatches);
    }

    const merchantShippingById = this.buildMerchantShippingFallbackMap(
      params.merchantGroups,
      params.fallbackShippingFeeCents,
    );
    const perBatchEstimates: DeliveryPickupSnapshotResult['perBatchEstimates'] = [];
    let prepaidPickupShippingFeeCents = 0;
    const merchantGroupsSnapshot = params.merchantGroups.map((group) => {
      const merchantBatches =
        batchesByMerchantId.get(group.merchantId) ??
        new Map<number, Array<{ cartItemId: string; quantity: number }>>();
      const sortedBatchEntries = Array.from(merchantBatches.entries()).sort(
        ([left], [right]) => left - right,
      );
      const fallbackBatchFees = this.allocateByGoodsAmount(
        sortedBatchEntries.map(([batchNo, items]) =>
          items.reduce((sum, item) => {
            return (
              sum +
              this.resolveAllocatedBatchLineAmountCents(
                batchLineAmountByItemAndBatch,
                item.cartItemId,
                batchNo,
              )
            );
          }, 0),
        ),
        merchantShippingById.get(group.merchantId) ?? 0,
      );
      const batches = sortedBatchEntries.map(([batchNo, items], batchIndex) => {
        const estimatedShippingFeeCents =
          pickupMode === DeliveryPickupMode.MULTI_BATCH && params.shippingRules?.length
          ? resolveDeliveryShippingFee(
              group.merchantId,
              items.map((item) => {
                const cartItem = cartItemById.get(item.cartItemId)!;
                return {
                  quantity: item.quantity,
                  weightGram: Math.max(0, Math.trunc(cartItem.weightGram ?? 0)),
                  lineAmountCents: this.resolveAllocatedBatchLineAmountCents(
                    batchLineAmountByItemAndBatch,
                    item.cartItemId,
                    batchNo,
                  ),
                };
              }),
              items.reduce((sum, item) => {
                return (
                  sum +
                  this.resolveAllocatedBatchLineAmountCents(
                    batchLineAmountByItemAndBatch,
                    item.cartItemId,
                    batchNo,
                  )
                );
              }, 0),
              params.shippingRules,
            ).shippingFeeCents
          : fallbackBatchFees[batchIndex] ?? 0;
        perBatchEstimates.push({
          merchantId: group.merchantId,
          batchNo,
          estimatedShippingFeeCents,
        });
        prepaidPickupShippingFeeCents += estimatedShippingFeeCents;

        return {
          batchNo,
          estimatedShippingFeeCents,
          items,
        };
      });

      return {
        merchantId: group.merchantId,
        merchantName: group.merchantName,
        goodsAmountCents: group.goodsAmountCents,
        batches,
      };
    });

    const pickupPlanSnapshot: DeliveryPickupPlanSnapshot = {
      pickupMode,
      plannedPickupCount,
      fallbackShippingFeeCents: Math.max(0, Math.trunc(params.fallbackShippingFeeCents)),
      prepaidPickupShippingFeeCents,
      merchantGroups: merchantGroupsSnapshot,
      perBatchEstimates,
    };

    return {
      pickupMode,
      plannedPickupCount,
      pickupPlanSnapshot: pickupPlanSnapshot as unknown as Prisma.InputJsonValue,
      prepaidPickupShippingFeeCents,
      perBatchEstimates,
    };
  }

  private buildMerchantShippingFallbackMap(
    merchantGroups: MerchantGroupInput[],
    fallbackShippingFeeCents: number,
  ) {
    const merchantShippingAllocations = this.allocateByGoodsAmount(
      merchantGroups.map((group) => group.goodsAmountCents),
      fallbackShippingFeeCents,
    );
    return new Map(
      merchantGroups.map((group, index) => [
        group.merchantId,
        merchantShippingAllocations[index] ?? 0,
      ]),
    );
  }

  async createBatchesForPaidOrder(
    tx: Prisma.TransactionClient,
    params: CreateBatchesParams,
  ) {
    const planSnapshot = await this.resolvePlanSnapshot(params.checkout);
    const orderItems = await tx.deliveryOrderItem.findMany({
      where: { orderId: params.orderId },
      select: {
        id: true,
        subOrderId: true,
        skuId: true,
        quantity: true,
        reservedPickupQuantity: true,
        productSnapshot: true,
      },
    });

    const orderItemByCartItemId = new Map<string, OrderItemForPickup>();
    for (const orderItem of orderItems) {
      const cartItemId = this.extractCartItemId(orderItem.productSnapshot);
      if (cartItemId) {
        orderItemByCartItemId.set(cartItemId, orderItem);
      }
    }

    const reservedQuantityByOrderItemId = new Map<string, number>();
    for (const merchantGroup of planSnapshot.merchantGroups) {
      const subOrderId = params.subOrderIdsByMerchantId.get(merchantGroup.merchantId);
      if (!subOrderId) {
        throw new BadRequestException('配送批次缺少商家子订单映射');
      }

      for (const batch of merchantGroup.batches) {
        const batchId = await this.deliveryIdService.nextInTransaction(tx, 'PSTH');
        await tx.deliveryPickupBatch.create({
          data: {
            id: batchId,
            orderId: params.orderId,
            subOrderId,
            merchantId: merchantGroup.merchantId,
            batchNo: batch.batchNo,
            provider: DeliveryCarrierProvider.SF,
            estimatedShippingFeeCents: batch.estimatedShippingFeeCents,
            cargoSnapshot: batch.items as unknown as Prisma.InputJsonValue,
            lastOperatorType: DeliveryAuditActorType.SYSTEM,
            lastOperatorId: params.createdByProviderTxnId,
          },
        });

        for (const batchItem of batch.items) {
          const orderItem = orderItemByCartItemId.get(batchItem.cartItemId);
          if (!orderItem) {
            throw new BadRequestException('配送批次找不到对应的订单商品');
          }
          if (orderItem.subOrderId !== subOrderId) {
            throw new BadRequestException('配送批次不能跨商家子订单');
          }

          const currentReserved =
            reservedQuantityByOrderItemId.get(orderItem.id) ??
            orderItem.reservedPickupQuantity;
          if (currentReserved + batchItem.quantity > orderItem.quantity) {
            throw new BadRequestException('配送批次预占数量超过订单商品数量');
          }

          const updated = await tx.deliveryOrderItem.updateMany({
            where: {
              id: orderItem.id,
              subOrderId,
              reservedPickupQuantity: currentReserved,
            },
            data: {
              reservedPickupQuantity: {
                increment: batchItem.quantity,
              },
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException('配送批次预占失败，请重试');
          }

          reservedQuantityByOrderItemId.set(
            orderItem.id,
            currentReserved + batchItem.quantity,
          );

          await tx.deliveryPickupBatchItem.create({
            data: {
              batchId,
              subOrderId,
              orderItemId: orderItem.id,
              skuId: orderItem.skuId,
              productSnapshot: orderItem.productSnapshot as Prisma.InputJsonValue,
              quantity: batchItem.quantity,
            },
          });
        }
      }
    }

    const prepaidAmountCents = Math.max(
      0,
      Math.trunc(
        params.checkout.prepaidPickupShippingFeeCents ?? params.checkout.shippingFeeCents ?? 0,
      ),
    );
    if (prepaidAmountCents > 0) {
      await tx.deliveryShippingCostLedger.create({
        data: {
          orderId: params.orderId,
          subOrderId: null,
          batchId: null,
          provider: DeliveryCarrierProvider.SF,
          type: DeliveryShippingCostLedgerType.PREPAID_BY_USER,
          amountCents: prepaidAmountCents,
          source: 'DELIVERY_CHECKOUT',
          sourceRefId: params.checkout.id,
          payloadSnapshot: planSnapshot as unknown as Prisma.InputJsonValue,
          createdByType: DeliveryAuditActorType.SYSTEM,
          createdById: params.createdByProviderTxnId,
        },
      });
    }
  }

  private normalizeExplicitPlanItems(
    pickupPlanItems: DeliveryPickupPlanItemInput[],
    cartItemById: Map<string, CheckoutCartItemForPickup>,
    plannedPickupCount: number,
  ) {
    const merged = pickupPlanItems.reduce((map, item) => {
      if (!cartItemById.has(item.cartItemId)) {
        throw new BadRequestException('配送计划包含未知购物车商品');
      }
      if (item.batchNo < 1 || item.batchNo > plannedPickupCount) {
        throw new BadRequestException('配送批次编号超出计划范围');
      }

      const key = `${item.cartItemId}:${item.batchNo}`;
      const existing = map.get(key) ?? {
        cartItemId: item.cartItemId,
        batchNo: item.batchNo,
        quantity: 0,
      };
      existing.quantity += item.quantity;
      map.set(key, existing);
      return map;
    }, new Map<string, DeliveryPickupPlanItemInput>());

    return Array.from(merged.values()).sort((left, right) => {
      if (left.cartItemId === right.cartItemId) {
        return left.batchNo - right.batchNo;
      }
      return left.cartItemId.localeCompare(right.cartItemId);
    });
  }

  private buildDefaultPlanItems(
    cartItems: CheckoutCartItemForPickup[],
    plannedPickupCount: number,
  ) {
    const planItems: DeliveryPickupPlanItemInput[] = [];
    for (const cartItem of cartItems) {
      const baseQuantity = Math.floor(cartItem.quantity / plannedPickupCount);
      const remainder = cartItem.quantity % plannedPickupCount;
      for (let batchNo = 1; batchNo <= plannedPickupCount; batchNo += 1) {
        const quantity = baseQuantity + (batchNo <= remainder ? 1 : 0);
        if (quantity <= 0) {
          continue;
        }
        planItems.push({
          cartItemId: cartItem.cartItemId,
          batchNo,
          quantity,
        });
      }
    }
    return planItems;
  }

  private buildBatchLineAmountAllocationMap(
    cartItems: CheckoutCartItemForPickup[],
    planAssignments: DeliveryPickupPlanItemInput[],
  ) {
    const cartItemById = new Map(
      cartItems.map((item) => [item.cartItemId, item]),
    );
    const assignmentsByCartItemId = planAssignments.reduce((map, item) => {
      const existing = map.get(item.cartItemId) ?? [];
      existing.push(item);
      map.set(item.cartItemId, existing);
      return map;
    }, new Map<string, DeliveryPickupPlanItemInput[]>());

    const allocated = new Map<string, number>();
    for (const [cartItemId, assignments] of assignmentsByCartItemId.entries()) {
      const cartItem = cartItemById.get(cartItemId);
      if (!cartItem || cartItem.quantity <= 0) {
        continue;
      }

      const baseUnitAmountCents = Math.floor(cartItem.lineAmountCents / cartItem.quantity);
      let remainingRemainderCents =
        cartItem.lineAmountCents - baseUnitAmountCents * cartItem.quantity;
      for (const assignment of assignments.sort((left, right) => left.batchNo - right.batchNo)) {
        const remainderForBatch = Math.min(
          assignment.quantity,
          remainingRemainderCents,
        );
        allocated.set(
          `${cartItemId}:${assignment.batchNo}`,
          baseUnitAmountCents * assignment.quantity + remainderForBatch,
        );
        remainingRemainderCents -= remainderForBatch;
      }
    }

    return allocated;
  }

  private resolveAllocatedBatchLineAmountCents(
    allocatedByItemAndBatch: Map<string, number>,
    cartItemId: string,
    batchNo: number,
  ) {
    return allocatedByItemAndBatch.get(`${cartItemId}:${batchNo}`) ?? 0;
  }

  private allocateByGoodsAmount(
    goodsAmountCentsList: number[],
    totalShippingFeeCents: number,
  ) {
    if (goodsAmountCentsList.length === 0) {
      return [];
    }
    if (totalShippingFeeCents <= 0) {
      return goodsAmountCentsList.map(() => 0);
    }

    const weights = goodsAmountCentsList.map((value) => Math.max(0, Math.trunc(value)));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight === 0) {
      const allocations = goodsAmountCentsList.map(() => 0);
      allocations[allocations.length - 1] = totalShippingFeeCents;
      return allocations;
    }

    const allocations = goodsAmountCentsList.map(() => 0);
    let allocatedCents = 0;
    for (let index = 0; index < weights.length; index += 1) {
      const remainingCents = totalShippingFeeCents - allocatedCents;
      if (index === weights.length - 1) {
        allocations[index] = remainingCents;
        break;
      }

      const cents = Math.min(
        remainingCents,
        Math.round((weights[index] / totalWeight) * totalShippingFeeCents),
      );
      allocations[index] = cents;
      allocatedCents += cents;
    }

    return allocations;
  }

  private async resolvePlanSnapshot(
    checkout: CreateBatchesParams['checkout'],
  ): Promise<DeliveryPickupPlanSnapshot> {
    if (checkout.pickupPlanSnapshot) {
      return checkout.pickupPlanSnapshot as unknown as DeliveryPickupPlanSnapshot;
    }

    const cartItems = this.parseCheckoutCartItems(checkout.itemsSnapshot);
    const merchantGroups = this.parseMerchantGroups(checkout.pricingSnapshot);
    const fallback = await this.buildCheckoutPickupSnapshot({
      pickupMode: checkout.pickupMode ?? DeliveryPickupMode.SINGLE,
      plannedPickupCount:
        checkout.pickupMode === DeliveryPickupMode.MULTI_BATCH
          ? checkout.plannedPickupCount ?? 2
          : 1,
      cartItems,
      merchantGroups,
      fallbackShippingFeeCents:
        checkout.prepaidPickupShippingFeeCents ?? checkout.shippingFeeCents ?? 0,
    });

    return fallback.pickupPlanSnapshot as unknown as DeliveryPickupPlanSnapshot;
  }

  private parseCheckoutCartItems(raw: Prisma.JsonValue): CheckoutCartItemForPickup[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException('配送结算快照缺失商品明细');
    }

    return (raw as any[]).map((item) => ({
      cartItemId: String(item.cartItemId ?? ''),
      merchantId: String(item.merchantId ?? ''),
      merchantName: typeof item.merchantName === 'string' ? item.merchantName : undefined,
      quantity: Math.max(0, Math.trunc(Number(item.quantity ?? 0))),
      lineAmountCents: Math.max(0, Math.trunc(Number(item.lineAmountCents ?? 0))),
    }));
  }

  private parseMerchantGroups(raw: Prisma.JsonValue | null | undefined): MerchantGroupInput[] {
    const merchantGroups = (raw as { merchantGroups?: MerchantGroupInput[] } | null)
      ?.merchantGroups;
    if (!Array.isArray(merchantGroups) || merchantGroups.length === 0) {
      throw new BadRequestException('配送结算快照缺失商家金额拆分');
    }

    return merchantGroups.map((group) => ({
      merchantId: group.merchantId,
      merchantName: group.merchantName,
      goodsAmountCents: Math.max(0, Math.trunc(group.goodsAmountCents ?? 0)),
    }));
  }

  private extractCartItemId(raw: Prisma.JsonValue) {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
      return null;
    }
    const cartItemId = (raw as Record<string, unknown>).cartItemId;
    return typeof cartItemId === 'string' && cartItemId.trim() ? cartItemId : null;
  }
}
