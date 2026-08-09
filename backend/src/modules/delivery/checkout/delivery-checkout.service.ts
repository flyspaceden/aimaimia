import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  DeliveryPickupMode,
  DeliveryPriceRuleScope,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { AlipayService } from '../../payment/alipay.service';
import { WechatPayService } from '../../payment/wechat-pay.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryPaymentsService } from '../payments/delivery-payments.service';
import { parseDeliveryYuanAmountToCents } from '../payments/delivery-payment-routing.util';
import { DeliveryPricingService } from '../pricing/delivery-pricing.service';
import { DeliveryPickupPlanService } from '../pickup/delivery-pickup-plan.service';
import { resolveDeliveryCheckoutShippingFee } from './delivery-shipping-fee.util';
import { CreateDeliveryCheckoutDto } from './dto/create-delivery-checkout.dto';

const checkoutCartItemInclude = {
  sku: {
    include: {
      priceRules: {
        where: {
          isActive: true,
          scope: DeliveryPriceRuleScope.SKU,
        },
      },
      product: {
        include: {
          merchant: {
            select: {
              id: true,
              name: true,
              defaultMarkupBps: true,
              status: true,
            },
          },
          priceRules: {
            where: {
              isActive: true,
              scope: DeliveryPriceRuleScope.PRODUCT,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DeliveryCartItemInclude;

type CheckoutCartItem = Prisma.DeliveryCartItemGetPayload<{
  include: typeof checkoutCartItemInclude;
}>;

type CurrentUnit = {
  id: string;
  userId: string;
  status: string;
  name: string;
  contactName: string;
  contactPhone: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
  detailAddress: string;
  extraFields: Prisma.JsonValue | null;
};

type CheckoutPreparation = {
  currentUnit: CurrentUnit;
  address: any | null;
  itemSnapshots: Array<{
    cartItemId: string;
    skuId: string;
    productId: string;
    merchantId: string;
    merchantName: string;
    productTitle: string;
    skuTitle: string;
    imageUrl: string | null;
    unitName: string | null;
    quantity: number;
    weightGram: number;
    minOrderQuantity: number;
    orderStepQuantity: number;
    supplyPriceCents: number;
    basePriceCents: number;
    finalPriceCents: number;
    lineAmountCents: number;
    pricingSource: string | null;
    matchedRuleId: string | null;
  }>;
  merchantGroups: Array<{
    merchantId: string;
    merchantName: string;
    goodsAmountCents: number;
    items: Array<{
      cartItemId: string;
      skuId: string;
      productId: string;
      merchantId: string;
      merchantName: string;
      productTitle: string;
      skuTitle: string;
      imageUrl: string | null;
      unitName: string | null;
      quantity: number;
      weightGram: number;
      minOrderQuantity: number;
      orderStepQuantity: number;
      supplyPriceCents: number;
      basePriceCents: number;
      finalPriceCents: number;
      lineAmountCents: number;
      pricingSource: string | null;
      matchedRuleId: string | null;
    }>;
  }>;
  pickupMode: DeliveryPickupMode;
  plannedPickupCount: number;
  pickupSnapshot: Awaited<
    ReturnType<DeliveryPickupPlanService['buildCheckoutPickupSnapshot']>
  >;
  goodsAmountCents: number;
  shippingFeeCents: number;
  totalAmountCents: number;
  unitSnapshot: Record<string, unknown>;
  addressSnapshot: Record<string, unknown>;
  pricingSnapshot: Record<string, unknown>;
};

@Injectable()
export class DeliveryCheckoutService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryPricingService: DeliveryPricingService,
    private readonly deliveryIdService: DeliveryIdService,
    private readonly deliveryPickupPlanService: DeliveryPickupPlanService,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly deliveryPaymentsService?: DeliveryPaymentsService,
  ) {}

  async createCheckout(deliveryUserId: string, dto: CreateDeliveryCheckoutDto) {
    const session = await this.deliveryPrisma.$transaction(
      async (tx) => {
        if (!dto.paymentChannel) {
          throw new BadRequestException('paymentChannel 必填');
        }

        const preparation = await this.prepareCheckout(tx, deliveryUserId, dto);
        const note = dto.note?.trim() || null;
        const merchantOrderNo = await this.deliveryIdService.nextInTransaction(tx, 'PSZF');

        return tx.deliveryCheckoutSession.create({
          data: {
            userId: deliveryUserId,
            unitId: preparation.currentUnit.id,
            addressId: preparation.address?.id ?? null,
            itemsSnapshot: preparation.itemSnapshots as Prisma.InputJsonValue,
            unitSnapshot: preparation.unitSnapshot as Prisma.InputJsonValue,
            addressSnapshot: preparation.addressSnapshot as Prisma.InputJsonValue,
            pricingSnapshot: preparation.pricingSnapshot as Prisma.InputJsonValue,
            pickupMode: preparation.pickupMode,
            plannedPickupCount: preparation.plannedPickupCount,
            pickupPlanSnapshot: preparation.pickupSnapshot.pickupPlanSnapshot,
            prepaidPickupShippingFeeCents:
              preparation.pickupSnapshot.prepaidPickupShippingFeeCents,
            note,
            goodsAmountCents: preparation.goodsAmountCents,
            shippingFeeCents: preparation.shippingFeeCents,
            totalAmountCents: preparation.totalAmountCents,
            paymentChannel: dto.paymentChannel,
            merchantOrderNo,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return this.mapBuyerCheckoutSession(session);
  }

  async estimatePickups(deliveryUserId: string, dto: CreateDeliveryCheckoutDto) {
    const estimate = await this.deliveryPrisma.$transaction(async (tx) => {
      const preparation = await this.prepareCheckout(tx, deliveryUserId, dto);
      return {
        goodsAmountCents: preparation.goodsAmountCents,
        prepaidPickupShippingFeeCents:
          preparation.pickupSnapshot.prepaidPickupShippingFeeCents,
        totalAmountCents: preparation.totalAmountCents,
        plannedPickupCount: preparation.plannedPickupCount,
        perBatchEstimates: preparation.pickupSnapshot.perBatchEstimates,
      };
    });

    return estimate;
  }

  async getCheckout(deliveryUserId: string, checkoutSessionId: string) {
    const currentUnit = await this.requireCurrentUnit(this.deliveryPrisma, deliveryUserId);
    const session = await this.deliveryPrisma.deliveryCheckoutSession.findFirst({
      where: {
        id: checkoutSessionId,
        userId: deliveryUserId,
        unitId: currentUnit.id,
      },
    });

    if (!session) {
      throw new NotFoundException('配送结算会话不存在');
    }

    return this.mapBuyerCheckoutSession(session);
  }

  private mapBuyerCheckoutSession(session: {
    id: string;
    merchantOrderNo: string | null;
    status: string;
    goodsAmountCents: number;
    shippingFeeCents: number;
    totalAmountCents: number;
    paymentChannel: string | null;
    note: string | null;
    expiresAt: Date;
    createdAt: Date;
    addressId: string | null;
    unitId: string;
  }) {
    return {
      id: session.id,
      merchantOrderNo: session.merchantOrderNo,
      status: session.status,
      goodsAmountCents: session.goodsAmountCents,
      shippingFeeCents: session.shippingFeeCents,
      totalAmountCents: session.totalAmountCents,
      paymentChannel: session.paymentChannel,
      note: session.note,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      addressId: session.addressId,
      unitId: session.unitId,
    };
  }

  async createPaymentParams(deliveryUserId: string, checkoutSessionId: string) {
    const currentUnit = await this.requireCurrentUnit(this.deliveryPrisma, deliveryUserId);
    const session = await this.deliveryPrisma.deliveryCheckoutSession.findFirst({
      where: {
        id: checkoutSessionId,
        userId: deliveryUserId,
        unitId: currentUnit.id,
      },
      select: {
        id: true,
        merchantOrderNo: true,
        paymentChannel: true,
        totalAmountCents: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('配送结算会话不存在');
    }
    if (session.status !== 'ACTIVE') {
      throw new BadRequestException(`配送结算会话状态不可支付: ${session.status}`);
    }
    if (session.expiresAt <= new Date()) {
      throw new BadRequestException('配送结算会话已过期');
    }
    if (!session.merchantOrderNo) {
      throw new BadRequestException('配送结算会话缺少支付单号');
    }
    if (!session.paymentChannel) {
      throw new BadRequestException('配送结算会话缺少支付渠道');
    }

    const totalAmount = Number((session.totalAmountCents / 100).toFixed(2));
    if (session.paymentChannel === 'ALIPAY') {
      const alipayService = this.getAlipayService();
      if (!alipayService?.isAvailable()) {
        throw new ServiceUnavailableException('支付服务暂不可用，请稍后重试');
      }

      const orderStr = await alipayService.createAppPayOrder({
        merchantOrderNo: session.merchantOrderNo,
        totalAmount,
        subject: `爱买买配送订单-${session.merchantOrderNo}`,
      });

      return {
        checkoutId: session.id,
        merchantOrderNo: session.merchantOrderNo,
        totalAmount,
        paymentParams: {
          channel: 'alipay',
          orderStr,
        },
      };
    }

    if (session.paymentChannel === 'WECHAT_PAY') {
      const wechatPayService = this.getWechatPayService();
      if (!wechatPayService?.isAvailable()) {
        throw new ServiceUnavailableException('支付服务暂不可用，请稍后重试');
      }

      const wechatParams = await wechatPayService.createAppOrder({
        outTradeNo: session.merchantOrderNo,
        amount: totalAmount,
        description: `爱买买配送订单-${session.merchantOrderNo}`,
      });

      return {
        checkoutId: session.id,
        merchantOrderNo: session.merchantOrderNo,
        totalAmount,
        paymentParams: {
          channel: 'wechat',
          ...wechatParams,
        },
      };
    }

    throw new BadRequestException('配送支付渠道不支持');
  }

  async activeQueryPayment(deliveryUserId: string, checkoutSessionId: string) {
    const currentUnit = await this.requireCurrentUnit(this.deliveryPrisma, deliveryUserId);
    const session = await this.deliveryPrisma.deliveryCheckoutSession.findFirst({
      where: {
        id: checkoutSessionId,
        userId: deliveryUserId,
        unitId: currentUnit.id,
      },
      include: {
        orders: {
          select: { id: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('配送结算会话不存在');
    }
    if (session.paymentChannel !== 'ALIPAY' && session.paymentChannel !== 'WECHAT_PAY') {
      throw new BadRequestException('当前配送支付渠道不支持主动查询');
    }

    const toResult = (
      confirmedBy:
        | 'already-completed'
        | 'terminal-state'
        | 'no-merchant-order-no'
        | 'query-error'
        | 'not-found'
        | `alipay-${string}`
        | `wechat-${string}`,
      row = session,
    ) => ({
      status: row.status,
      orderIds: row.orders?.map((order) => order.id) ?? [],
      expectedTotal: Number((row.totalAmountCents / 100).toFixed(2)),
      confirmedBy,
    });

    if (session.status === 'COMPLETED') {
      return toResult('already-completed');
    }
    if (session.status === 'EXPIRED' || session.status === 'FAILED') {
      return toResult('terminal-state');
    }
    if (!session.merchantOrderNo) {
      return toResult('no-merchant-order-no');
    }

    if (session.paymentChannel === 'ALIPAY') {
      const alipayService = this.getAlipayService();
      if (!alipayService?.isAvailable()) {
        return toResult('query-error');
      }

      let queryResult: { tradeStatus: string; tradeNo: string; totalAmount: string } | null = null;
      try {
        queryResult = await alipayService.queryOrder(session.merchantOrderNo);
      } catch {
        return toResult('query-error');
      }

      if (!queryResult) {
        return toResult('not-found');
      }
      if (
        queryResult.tradeStatus !== 'TRADE_SUCCESS' &&
        queryResult.tradeStatus !== 'TRADE_FINISHED'
      ) {
        return toResult(`alipay-${queryResult.tradeStatus.toLowerCase()}`);
      }

      const claimedAmountCents = parseDeliveryYuanAmountToCents(queryResult.totalAmount);
      if (!Number.isInteger(claimedAmountCents) || claimedAmountCents !== session.totalAmountCents) {
        throw new BadRequestException('配送支付金额校验失败，请联系客服');
      }
      if (!this.deliveryPaymentsService) {
        throw new BadRequestException('配送支付服务未启用');
      }

      await this.deliveryPaymentsService.handlePaymentCallback({
        merchantOrderNo: session.merchantOrderNo,
        providerTxnId: queryResult.tradeNo,
        status: 'SUCCESS',
        paidAt: new Date().toISOString(),
        rawPayload: { source: 'active-query', ...queryResult },
        paymentChannel: 'ALIPAY',
        claimedAmountCents,
        skipSignatureVerification: true,
      });
    } else {
      const wechatPayService = this.getWechatPayService();
      if (!wechatPayService?.isAvailable()) {
        return toResult('query-error');
      }

      let queryResult: any;
      try {
        queryResult = await wechatPayService.queryOrder(session.merchantOrderNo);
      } catch {
        return toResult('query-error');
      }

      if (!queryResult || queryResult.outcome === 'UNKNOWN') {
        return toResult('query-error');
      }
      if (queryResult.outcome === 'DEFINITIVE_NOT_FOUND') {
        return toResult('not-found');
      }
      // 配送中心当前只支持 App 支付；查单响应也必须来自 APP AppID/trade_type。
      if (!wechatPayService.matchesPaymentScene(queryResult, 'APP')) {
        return toResult('query-error');
      }
      if (queryResult.tradeState !== 'SUCCESS') {
        return toResult(`wechat-${queryResult.tradeState.toLowerCase()}`);
      }
      if (!queryResult.transactionId) {
        throw new BadRequestException('微信支付成功但缺少交易流水号');
      }
      if (!Number.isInteger(queryResult.totalAmountFen) || queryResult.totalAmountFen !== session.totalAmountCents) {
        throw new BadRequestException('配送支付金额校验失败，请联系客服');
      }
      if (!this.deliveryPaymentsService) {
        throw new BadRequestException('配送支付服务未启用');
      }

      await this.deliveryPaymentsService.handlePaymentCallback({
        merchantOrderNo: session.merchantOrderNo,
        providerTxnId: queryResult.transactionId,
        status: 'SUCCESS',
        paidAt: queryResult.paidAt?.toISOString() ?? new Date().toISOString(),
        rawPayload: { source: 'active-query', ...queryResult },
        paymentChannel: 'WECHAT_PAY',
        claimedAmountCents: queryResult.totalAmountFen,
        skipSignatureVerification: true,
      });
    }

    const refreshed = await this.deliveryPrisma.deliveryCheckoutSession.findFirst({
      where: {
        id: checkoutSessionId,
        userId: deliveryUserId,
        unitId: currentUnit.id,
      },
      include: {
        orders: {
          select: { id: true },
        },
      },
    });

    return {
      status: refreshed?.status ?? 'COMPLETED',
      orderIds: refreshed?.orders.map((order) => order.id) ?? [],
      expectedTotal: Number((session.totalAmountCents / 100).toFixed(2)),
      confirmedBy: 'active-query-success' as const,
    };
  }

  private async requireCurrentUnit(
    prisma: Pick<DeliveryPrismaService, 'deliveryUser' | 'deliveryUnit'> | Prisma.TransactionClient,
    deliveryUserId: string,
  ): Promise<CurrentUnit> {
    const user = await prisma.deliveryUser.findUnique({
      where: { id: deliveryUserId },
      select: { currentUnitId: true },
    });

    if (!user) {
      throw new NotFoundException('配送用户不存在');
    }
    if (!user.currentUnitId) {
      throw new BadRequestException('请先选择配送单位');
    }

    const unit = await prisma.deliveryUnit.findFirst({
      where: {
        id: user.currentUnitId,
        userId: deliveryUserId,
      },
      select: {
        id: true,
        userId: true,
        status: true,
        name: true,
        contactName: true,
        contactPhone: true,
        provinceCode: true,
        provinceName: true,
        cityCode: true,
        cityName: true,
        districtCode: true,
        districtName: true,
        detailAddress: true,
        extraFields: true,
      },
    });

    if (!unit || unit.status !== 'ACTIVE') {
      throw new BadRequestException('当前配送单位不可用，请重新选择');
    }

    return unit as CurrentUnit;
  }

  private assertCartItemOrderable(item: CheckoutCartItem) {
    if (!item.sku.isActive) {
      throw new BadRequestException('配送 SKU 已下架');
    }
    if (item.sku.product.status !== 'ACTIVE' || item.sku.product.auditStatus !== 'APPROVED') {
      throw new BadRequestException('配送商品不存在或未上架');
    }
    if (item.sku.product.merchant.status !== 'ACTIVE') {
      throw new BadRequestException('配送商家当前不可下单');
    }
  }

  private assertQuantityValid(quantity: number, item: CheckoutCartItem) {
    const minOrderQuantity = item.sku.minOrderQuantity ?? item.sku.product.minOrderQuantity ?? 1;
    const orderStepQuantity =
      item.sku.orderStepQuantity ?? item.sku.product.orderStepQuantity ?? 1;

    if (quantity < minOrderQuantity) {
      throw new BadRequestException(`购买数量不能低于起订量 ${minOrderQuantity}`);
    }
    if ((quantity - minOrderQuantity) % orderStepQuantity !== 0) {
      throw new BadRequestException(`购买数量必须按 ${orderStepQuantity} 的步长递增`);
    }
  }

  private assertStockEnough(quantity: number, stock: number) {
    if (stock < quantity) {
      throw new BadRequestException('库存不足');
    }
  }

  private getAlipayService(): AlipayService | null {
    return this.moduleRef?.get(AlipayService, { strict: false }) ?? null;
  }

  private getWechatPayService(): WechatPayService | null {
    return this.moduleRef?.get(WechatPayService, { strict: false }) ?? null;
  }

  private async loadMerchantRulesByMerchantId(tx: Prisma.TransactionClient, merchantIds: string[]) {
    const uniqueMerchantIds = Array.from(new Set(merchantIds.filter(Boolean)));
    if (!uniqueMerchantIds.length) {
      return new Map<string, any[]>();
    }

    const merchantRules = await tx.deliveryPriceRule.findMany({
      where: {
        scope: DeliveryPriceRuleScope.MERCHANT,
        merchantId: {
          in: uniqueMerchantIds,
        },
        isActive: true,
      },
      orderBy: [{ priority: 'desc' }, { minQuantity: 'asc' }, { createdAt: 'desc' }],
    });

    return merchantRules.reduce((map, rule) => {
      if (!rule.merchantId) {
        return map;
      }

      const existingRules = map.get(rule.merchantId) ?? [];
      existingRules.push(rule);
      map.set(rule.merchantId, existingRules);
      return map;
    }, new Map<string, typeof merchantRules>());
  }

  private async prepareCheckout(
    tx: Prisma.TransactionClient,
    deliveryUserId: string,
    dto: CreateDeliveryCheckoutDto,
  ): Promise<CheckoutPreparation> {
    const currentUnit = await this.requireCurrentUnit(tx, deliveryUserId);
    const cartItemIds = Array.from(
      new Set(dto.cartItemIds.map((itemId) => itemId.trim()).filter(Boolean)),
    );

    if (!cartItemIds.length) {
      throw new BadRequestException('至少选择一个购物车商品');
    }

    const [platformRules, cartItems, shippingRules] = await Promise.all([
      tx.deliveryPriceRule.findMany({
        where: {
          scope: DeliveryPriceRuleScope.PLATFORM,
          isActive: true,
        },
        orderBy: [{ priority: 'desc' }, { minQuantity: 'asc' }, { createdAt: 'desc' }],
      }),
      tx.deliveryCartItem.findMany({
        where: {
          id: {
            in: cartItemIds,
          },
          userId: deliveryUserId,
          unitId: currentUnit.id,
          isSelected: true,
        },
        include: checkoutCartItemInclude,
        orderBy: [{ createdAt: 'asc' }],
      }),
      tx.deliveryShippingRule.findMany({
        where: {
          status: 'ACTIVE',
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    if (cartItems.length !== cartItemIds.length) {
      throw new BadRequestException('所选购物车商品无效、未勾选或不属于当前配送单位');
    }

    const merchantRulesByMerchantId = await this.loadMerchantRulesByMerchantId(
      tx,
      cartItems.map((item) => item.sku.product.merchant.id),
    );
    const address = dto.addressId
      ? await tx.deliveryAddress.findFirst({
          where: {
            id: dto.addressId,
            userId: deliveryUserId,
            unitId: currentUnit.id,
          },
        })
      : null;

    if (dto.addressId && !address) {
      throw new BadRequestException('配送地址不存在或不属于当前配送单位');
    }

    const itemSnapshots = cartItems.map((item) => {
      this.assertCartItemOrderable(item);
      this.assertQuantityValid(item.quantity, item);
      this.assertStockEnough(item.quantity, item.sku.stock);

      const pricing = this.deliveryPricingService.resolvePrice({
        basePriceCents: item.sku.basePriceCents,
        fixedFinalPriceCents: item.sku.fixedFinalPriceCents,
        quantity: item.quantity,
        merchantDefaultMarkupBps: item.sku.product.merchant.defaultMarkupBps ?? null,
        rules: [
          ...platformRules,
          ...(merchantRulesByMerchantId.get(item.sku.product.merchant.id) ?? []),
          ...item.sku.product.priceRules,
          ...item.sku.priceRules,
        ],
      });
      const lineAmountCents = pricing.finalPriceCents * item.quantity;

      return {
        cartItemId: item.id,
        skuId: item.skuId,
        productId: item.sku.product.id,
        merchantId: item.sku.product.merchant.id,
        merchantName: item.sku.product.merchant.name,
        productTitle: item.sku.product.title,
        skuTitle: item.sku.title,
        imageUrl: item.sku.imageUrl,
        unitName: item.sku.product.unitName,
        quantity: item.quantity,
        weightGram: item.sku.weightGram,
        minOrderQuantity: item.sku.minOrderQuantity ?? item.sku.product.minOrderQuantity ?? 1,
        orderStepQuantity:
          item.sku.orderStepQuantity ?? item.sku.product.orderStepQuantity ?? 1,
        supplyPriceCents: item.sku.supplyPriceCents,
        basePriceCents: item.sku.basePriceCents,
        finalPriceCents: pricing.finalPriceCents,
        lineAmountCents,
        pricingSource: pricing.matchedSource,
        matchedRuleId: pricing.matchedRuleId,
      };
    });

    const merchantGroups = Array.from(
      itemSnapshots.reduce((map, item) => {
        const existing = map.get(item.merchantId) ?? {
          merchantId: item.merchantId,
          merchantName: item.merchantName,
          items: [] as typeof itemSnapshots,
        };
        existing.items.push(item);
        map.set(item.merchantId, existing);
        return map;
      }, new Map<string, { merchantId: string; merchantName: string; items: typeof itemSnapshots }>()),
    ).map(([, group]) => ({
      merchantId: group.merchantId,
      merchantName: group.merchantName,
      goodsAmountCents: group.items.reduce((sum, item) => sum + item.lineAmountCents, 0),
      items: group.items,
    }));

    const goodsAmountCents = merchantGroups.reduce((sum, group) => sum + group.goodsAmountCents, 0);
    const orderShippingRuleSnapshot = resolveDeliveryCheckoutShippingFee(
      itemSnapshots,
      goodsAmountCents,
      shippingRules,
    );
    const pickupMode = dto.pickupMode ?? DeliveryPickupMode.SINGLE;
    const plannedPickupCount =
      pickupMode === DeliveryPickupMode.MULTI_BATCH ? dto.plannedPickupCount ?? 2 : 1;
    const pickupSnapshot = await this.deliveryPickupPlanService.buildCheckoutPickupSnapshot({
      pickupMode,
      plannedPickupCount,
      cartItems: itemSnapshots.map((item) => ({
        cartItemId: item.cartItemId,
        merchantId: item.merchantId,
        merchantName: item.merchantName,
        quantity: item.quantity,
        weightGram: item.weightGram,
        lineAmountCents: item.lineAmountCents,
      })),
      merchantGroups: merchantGroups.map((group) => ({
        merchantId: group.merchantId,
        merchantName: group.merchantName,
        goodsAmountCents: group.goodsAmountCents,
      })),
      pickupPlanItems: dto.pickupPlanItems,
      fallbackShippingFeeCents: orderShippingRuleSnapshot.shippingFeeCents,
      shippingRules,
    });

    const shippingByMerchantId = pickupSnapshot.perBatchEstimates.reduce((map, item) => {
      map.set(item.merchantId, (map.get(item.merchantId) ?? 0) + item.estimatedShippingFeeCents);
      return map;
    }, new Map<string, number>());
    const merchantGroupsWithShipping = merchantGroups.map((group) => {
      const shippingFeeCents = shippingByMerchantId.get(group.merchantId) ?? 0;
      const batchEstimates = pickupSnapshot.perBatchEstimates
        .filter((item) => item.merchantId === group.merchantId)
        .map((item) => ({
          batchNo: item.batchNo,
          estimatedShippingFeeCents: item.estimatedShippingFeeCents,
        }));

      return {
        ...group,
        shippingFeeCents,
        totalAmountCents: group.goodsAmountCents + shippingFeeCents,
        shippingRuleSnapshot:
          pickupMode === DeliveryPickupMode.MULTI_BATCH
            ? {
                source: 'MULTI_BATCH_PICKUP_PLAN',
                pickupMode,
                plannedPickupCount,
                allocatedShippingFeeCents: shippingFeeCents,
                shippingFeeCents,
                batchEstimates,
                fallbackCheckoutShippingRuleSnapshot: orderShippingRuleSnapshot,
              }
            : {
                ...orderShippingRuleSnapshot,
                allocationBasis: 'GOODS_AMOUNT',
                allocationWeightCents: group.goodsAmountCents,
                allocatedShippingFeeCents: shippingFeeCents,
                pickupMode,
                plannedPickupCount,
              },
      };
    });

    const shippingFeeCents = pickupSnapshot.prepaidPickupShippingFeeCents;
    const totalAmountCents = goodsAmountCents + shippingFeeCents;
    const unitSnapshot = {
      id: currentUnit.id,
      name: currentUnit.name,
      contactName: currentUnit.contactName,
      contactPhone: currentUnit.contactPhone,
      provinceCode: currentUnit.provinceCode,
      provinceName: currentUnit.provinceName,
      cityCode: currentUnit.cityCode,
      cityName: currentUnit.cityName,
      districtCode: currentUnit.districtCode,
      districtName: currentUnit.districtName,
      detailAddress: currentUnit.detailAddress,
      extraFields: currentUnit.extraFields ?? null,
    };
    const addressSnapshot = address
      ? {
          source: 'ADDRESS',
          id: address.id,
          recipientName: address.recipientName,
          phone: address.phone,
          provinceCode: address.provinceCode,
          provinceName: address.provinceName,
          cityCode: address.cityCode,
          cityName: address.cityName,
          districtCode: address.districtCode,
          districtName: address.districtName,
          detailAddress: address.detailAddress,
          regionText: address.regionText ?? null,
          label: address.label ?? null,
        }
      : {
          source: 'UNIT',
          recipientName: currentUnit.contactName,
          phone: currentUnit.contactPhone,
          provinceCode: currentUnit.provinceCode,
          provinceName: currentUnit.provinceName,
          cityCode: currentUnit.cityCode,
          cityName: currentUnit.cityName,
          districtCode: currentUnit.districtCode,
          districtName: currentUnit.districtName,
          detailAddress: currentUnit.detailAddress,
          regionText: `${currentUnit.provinceName}${currentUnit.cityName}${currentUnit.districtName}`,
        };
    const pricingSnapshot = {
      currency: 'CNY_CENTS',
      merchantGroups: merchantGroupsWithShipping,
      totals: {
        goodsAmountCents,
        shippingFeeCents,
        totalAmountCents,
        pickupMode,
        plannedPickupCount,
        prepaidPickupShippingFeeCents: pickupSnapshot.prepaidPickupShippingFeeCents,
      },
      pickupPlanSnapshot: pickupSnapshot.pickupPlanSnapshot,
      perBatchEstimates: pickupSnapshot.perBatchEstimates,
      unsupportedAdjustments: {
        vip: false,
        coupon: false,
        reward: false,
        digitalAsset: false,
        referral: false,
      },
    };

    return {
      currentUnit,
      address,
      itemSnapshots,
      merchantGroups,
      pickupMode,
      plannedPickupCount,
      pickupSnapshot,
      goodsAmountCents,
      shippingFeeCents,
      totalAmountCents,
      unitSnapshot,
      addressSnapshot,
      pricingSnapshot,
    };
  }
}
