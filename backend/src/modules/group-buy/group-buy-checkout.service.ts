import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  GroupBuyActivityStatus,
  GroupBuyCodeStatus,
  GroupBuyInstanceStatus,
  Prisma,
  ProductStatus,
  SkuStatus,
} from "@prisma/client";

import { DEFAULT_SKU_WEIGHT_GRAM } from "../../common/constants/shipping.constants";
import { assertActiveUserWriteBarrier } from "../../common/transactions/active-user-write-barrier";
import { encryptJsonValue } from "../../common/security/encryption";
import { parseChineseAddress } from "../../common/utils/parse-region";
import { PrismaService } from "../../prisma/prisma.service";
import { BonusConfigService } from "../bonus/engine/bonus-config.service";
import { PLATFORM_COMPANY_ID } from "../bonus/engine/constants";
import { GroupBuyCheckoutDto } from "./dto/group-buy-checkout.dto";
import { MiniProgramGroupBuyCheckoutDto } from "./dto/mini-program-group-buy-checkout.dto";

const CHANNEL_MAP: Record<string, string> = {
  wechat: "WECHAT_PAY",
  alipay: "ALIPAY",
  bankcard: "UNIONPAY",
};

const GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY = "GROUP_BUY_MAX_MONTHLY_LAUNCHES";
const DEFAULT_MAX_MONTHLY_LAUNCHES = 4;

type CheckoutGroupBuyActivityItem = {
  productId: string;
  product: any;
  skuId: string;
  sku: any;
  quantity: number;
  sortOrder: number;
};

type GroupBuyPaymentScene = "APP" | "MINI_PROGRAM";

type TrustedAuthSessionContext = {
  sessionId?: string;
  authIdentityId?: string;
};

type GroupBuyCheckoutInput =
  GroupBuyCheckoutDto | MiniProgramGroupBuyCheckoutDto;

type CheckoutPaymentCoordinator = {
  createPaymentParamsForExistingCheckout(input: {
    userId: string;
    sessionId: string;
    requestedScene: GroupBuyPaymentScene;
    miniProgramOpenId?: string | null;
    description: string;
  }): Promise<{ session: any; paymentParams: Record<string, any> }>;
};

@Injectable()
export class GroupBuyCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusConfig: BonusConfigService,
  ) {}

  private alipayService: any = null;
  private wechatPayService: any = null;
  private shippingRuleService: any = null;
  private checkoutPaymentService: CheckoutPaymentCoordinator | null = null;
  private readonly logger = new Logger(GroupBuyCheckoutService.name);

  private readonly serializableTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  setAlipayService(service: any) {
    this.alipayService = service;
  }

  setWechatPayService(service: any) {
    this.wechatPayService = service;
  }

  setShippingRuleService(service: any) {
    this.shippingRuleService = service;
  }

  setCheckoutPaymentService(service: CheckoutPaymentCoordinator) {
    this.checkoutPaymentService = service;
  }

  async previewCheckout(userId: string, dto: GroupBuyCheckoutDto) {
    this.assertCashOnly(dto);

    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.groupBuyActivity.findUnique({
        where: { id: dto.activityId },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              type: true,
              companyId: true,
              status: true,
              media: {
                select: { url: true },
                orderBy: { sortOrder: "asc" },
                take: 1,
              },
              bundleItems: {
                orderBy: { sortOrder: "asc" },
                select: {
                  quantity: true,
                  sortOrder: true,
                  sku: {
                    select: {
                      id: true,
                      title: true,
                      weightGram: true,
                      product: { select: { id: true, title: true } },
                    },
                  },
                },
              },
            },
          },
          sku: {
            select: {
              id: true,
              title: true,
              status: true,
              price: true,
              stock: true,
              weightGram: true,
            },
          },
          items: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  companyId: true,
                  status: true,
                  media: {
                    select: { url: true },
                    orderBy: { sortOrder: "asc" },
                    take: 1,
                  },
                  bundleItems: {
                    orderBy: { sortOrder: "asc" },
                    select: {
                      quantity: true,
                      sortOrder: true,
                      sku: {
                        select: {
                          id: true,
                          title: true,
                          weightGram: true,
                          product: { select: { id: true, title: true } },
                        },
                      },
                    },
                  },
                },
              },
              sku: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  price: true,
                  stock: true,
                  weightGram: true,
                },
              },
            },
          },
          tiers: {
            orderBy: { sequence: "asc" },
          },
        },
      });
      if (!activity || activity.deletedAt) {
        throw new NotFoundException("团购活动不存在");
      }
      const activityItems = this.normalizeActivityItems(activity);
      this.assertActivityCanCheckout(activity, activityItems);

      const occupying = await tx.groupBuyInstance.findFirst({
        where: this.activeOccupyingInstanceWhere(userId),
        select: { id: true, status: true },
      });
      if (occupying) {
        throw new ConflictException({
          code: "GROUP_BUY_SLOT_OCCUPIED",
          message: "需要先结束本次分享，或完成本次分享后才能购买新的团购商品",
        });
      }

      const monthStart = this.getMonthStart();
      const monthlyStartedCount = await tx.groupBuyInstance.count({
        where: {
          userId,
          createdAt: { gte: monthStart },
        },
      });
      const maxMonthlyLaunches = await this.getMaxMonthlyLaunches(tx);
      if (monthlyStartedCount >= maxMonthlyLaunches) {
        throw new BadRequestException("本月团购参与次数已用完");
      }

      if (dto.shareCode) {
        await this.resolveShareCode(tx, userId, dto.activityId, dto.shareCode);
      }

      const address = await tx.address.findUnique({
        where: { id: dto.addressId, userId, deletedAt: null },
      });
      if (!address) {
        throw new BadRequestException("收货地址无效");
      }

      const shippingFee = await this.calculateShippingFee(
        activity,
        address,
        tx,
        activityItems,
      );
      const expectedTotal = Number((activity.price + shippingFee).toFixed(2));
      return {
        expectedTotal,
        goodsAmount: activity.price,
        shippingFee,
        discountAmount: 0,
      };
    }, this.serializableTransactionOptions);
  }

  async createCheckout(userId: string, dto: GroupBuyCheckoutDto) {
    return this.createCheckoutForScene(userId, dto, "APP");
  }

  async createMiniProgramCheckout(
    userId: string,
    dto: MiniProgramGroupBuyCheckoutDto,
    authContext: TrustedAuthSessionContext,
  ) {
    // 先验证当前 JWT 精确会话的微信身份，再创建资金会话；身份缺失时不能留下
    // 无法支付的 ACTIVE CheckoutSession。
    const miniProgramOpenId = await this.resolveMiniProgramOpenId(
      userId,
      authContext,
    );
    return this.createCheckoutForScene(
      userId,
      dto,
      "MINI_PROGRAM",
      authContext,
      miniProgramOpenId,
    );
  }

  private async createCheckoutForScene(
    userId: string,
    dto: GroupBuyCheckoutInput,
    paymentScene: GroupBuyPaymentScene,
    authContext?: TrustedAuthSessionContext,
    miniProgramOpenId?: string,
  ) {
    this.assertCashOnly(dto);
    const requestFingerprint = this.buildCheckoutRequestFingerprint(dto);

    if (dto.idempotencyKey) {
      const existing = await this.prisma.checkoutSession.findFirst({
        where: {
          userId,
          bizType: "GROUP_BUY",
          idempotencyKey: dto.idempotencyKey,
        },
      });
      if (existing) {
        this.assertReusableIdempotentSession(
          existing,
          paymentScene,
          requestFingerprint,
        );
        return this.toCheckoutResponse(
          existing,
          authContext,
          miniProgramOpenId,
        );
      }
    }

    const session = await this.prisma.$transaction(async (tx) => {
      await assertActiveUserWriteBarrier(tx, userId);
      const activeSession = await tx.checkoutSession.findFirst({
        where: {
          userId,
          bizType: "GROUP_BUY",
          status: "ACTIVE",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });
      if (activeSession) {
        if (
          dto.idempotencyKey &&
          activeSession.idempotencyKey === dto.idempotencyKey
        ) {
          this.assertReusableIdempotentSession(
            activeSession,
            paymentScene,
            requestFingerprint,
          );
          return activeSession;
        }
        throw new ConflictException({
          code: "PENDING_GROUP_BUY_CHECKOUT_EXISTS",
          message: "你有未完成的团购付款，请先完成支付或取消",
        });
      }

      const activity = await tx.groupBuyActivity.findUnique({
        where: { id: dto.activityId },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              type: true,
              companyId: true,
              status: true,
              media: {
                select: { url: true },
                orderBy: { sortOrder: "asc" },
                take: 1,
              },
              bundleItems: {
                orderBy: { sortOrder: "asc" },
                select: {
                  quantity: true,
                  sortOrder: true,
                  sku: {
                    select: {
                      id: true,
                      title: true,
                      weightGram: true,
                      product: { select: { id: true, title: true } },
                    },
                  },
                },
              },
            },
          },
          sku: {
            select: {
              id: true,
              title: true,
              status: true,
              price: true,
              stock: true,
              weightGram: true,
            },
          },
          items: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  companyId: true,
                  status: true,
                  media: {
                    select: { url: true },
                    orderBy: { sortOrder: "asc" },
                    take: 1,
                  },
                  bundleItems: {
                    orderBy: { sortOrder: "asc" },
                    select: {
                      quantity: true,
                      sortOrder: true,
                      sku: {
                        select: {
                          id: true,
                          title: true,
                          weightGram: true,
                          product: { select: { id: true, title: true } },
                        },
                      },
                    },
                  },
                },
              },
              sku: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  price: true,
                  stock: true,
                  weightGram: true,
                },
              },
            },
          },
          tiers: {
            orderBy: { sequence: "asc" },
          },
        },
      });
      if (!activity || activity.deletedAt) {
        throw new NotFoundException("团购活动不存在");
      }
      const activityItems = this.normalizeActivityItems(activity);
      this.assertActivityCanCheckout(activity, activityItems);

      const occupying = await tx.groupBuyInstance.findFirst({
        where: this.activeOccupyingInstanceWhere(userId),
        select: { id: true, status: true },
      });
      if (occupying) {
        throw new ConflictException({
          code: "GROUP_BUY_SLOT_OCCUPIED",
          message: "需要先结束本次分享，或完成本次分享后才能购买新的团购商品",
        });
      }

      const monthStart = this.getMonthStart();
      const monthlyStartedCount = await tx.groupBuyInstance.count({
        where: {
          userId,
          createdAt: { gte: monthStart },
        },
      });
      const maxMonthlyLaunches = await this.getMaxMonthlyLaunches(tx);
      if (monthlyStartedCount >= maxMonthlyLaunches) {
        throw new BadRequestException("本月团购参与次数已用完");
      }

      const groupBuyCode = dto.shareCode
        ? await this.resolveShareCode(tx, userId, dto.activityId, dto.shareCode)
        : null;

      const address = await tx.address.findUnique({
        where: { id: dto.addressId, userId, deletedAt: null },
      });
      if (!address) {
        throw new BadRequestException("收货地址无效");
      }

      const shippingFee = await this.calculateShippingFee(
        activity,
        address,
        tx,
        activityItems,
      );
      const expectedTotal = Number((activity.price + shippingFee).toFixed(2));
      if (
        dto.expectedTotal !== undefined &&
        Math.abs(dto.expectedTotal - expectedTotal) > 0.01
      ) {
        throw new BadRequestException(
          `价格已变更：预期 ¥${dto.expectedTotal.toFixed(2)}，实际 ¥${expectedTotal.toFixed(2)}。请刷新后重新结算`,
        );
      }

      const region = parseChineseAddress(address.regionText);
      const addressSnapshot = encryptJsonValue({
        recipientName: address.recipientName,
        phone: address.phone,
        regionCode: address.regionCode,
        regionText: address.regionText,
        province: region.province,
        city: region.city,
        district: region.district,
        detail: address.detail,
      });
      const tierSnapshot = activity.tiers.map((tier) => ({
        sequence: tier.sequence,
        basisPoints: tier.basisPoints,
        label: tier.label,
      }));
      const merchantOrderNo = `GB${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const session = await tx.checkoutSession.create({
        data: {
          userId,
          bizType: "GROUP_BUY",
          bizMeta: {
            groupBuyActivityId: activity.id,
            groupBuyCodeId: groupBuyCode?.id ?? null,
            referredByInstanceId: groupBuyCode?.instance?.id ?? null,
            groupBuyPriceSnapshot: activity.price,
            freeShippingSnapshot: activity.freeShipping,
            shippingFeeSnapshot: shippingFee,
            tierSnapshot,
            checkoutRequestFingerprint: requestFingerprint,
          },
          itemsSnapshot: this.buildItemsSnapshot(activity, activityItems),
          addressSnapshot,
          rewardId: null,
          deductionGroupId: null,
          expectedTotal,
          goodsAmount: activity.price,
          shippingFee,
          discountAmount: 0,
          vipDiscountAmount: 0,
          merchantOrderNo,
          paymentChannel:
            paymentScene === "MINI_PROGRAM"
              ? "WECHAT_PAY"
              : ((CHANNEL_MAP[
                  (dto as GroupBuyCheckoutDto).paymentChannel || "wechat"
                ] ||
                  (dto as GroupBuyCheckoutDto).paymentChannel ||
                  "WECHAT_PAY") as any),
          paymentScene,
          miniProgramPayerOpenId:
            paymentScene === "MINI_PROGRAM" ? miniProgramOpenId : null,
          couponInstanceIds: [],
          totalCouponDiscount: 0,
          couponPerAmounts: [],
          idempotencyKey: dto.idempotencyKey,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        } as any,
      });

      return session;
    }, this.serializableTransactionOptions);

    return this.toCheckoutResponse(session, authContext, miniProgramOpenId);
  }

  private assertCashOnly(dto: GroupBuyCheckoutInput) {
    const untrusted = dto as GroupBuyCheckoutDto;
    if ((untrusted.deductionAmount ?? 0) > 0 || untrusted.rewardId) {
      throw new BadRequestException(
        "团购商品必须现金购买，不能使用消费积分抵扣",
      );
    }
    if ((untrusted.groupBuyRebateDeductionAmount ?? 0) > 0) {
      throw new BadRequestException(
        "团购商品必须现金购买，不能使用团购返还余额抵扣",
      );
    }
    if (untrusted.couponInstanceIds && untrusted.couponInstanceIds.length > 0) {
      throw new BadRequestException("团购商品不能使用平台红包");
    }
    const dirtyDiscountFields = [
      "discountAmount",
      "vipDiscountAmount",
      "totalCouponDiscount",
      "couponPerAmounts",
    ];
    if (
      dirtyDiscountFields.some((field) =>
        Object.prototype.hasOwnProperty.call(dto, field),
      )
    ) {
      throw new BadRequestException("团购商品必须现金购买，不能使用优惠或折扣");
    }
  }

  private normalizeActivityItems(
    activity: any,
  ): CheckoutGroupBuyActivityItem[] {
    const rawItems =
      Array.isArray(activity.items) && activity.items.length > 0
        ? activity.items
        : [
            {
              productId: activity.productId,
              skuId: activity.skuId,
              quantity: 1,
              sortOrder: 0,
              product: activity.product,
              sku: activity.sku,
            },
          ];

    return rawItems
      .map((item: any, index: number) => {
        const product = item.product ?? activity.product;
        const sku = item.sku ?? activity.sku;
        return {
          productId: item.productId ?? product?.id,
          product,
          skuId: item.skuId ?? sku?.id,
          sku,
          quantity: Math.max(1, Math.floor(Number(item.quantity ?? 1))),
          sortOrder: item.sortOrder ?? index,
        };
      })
      .sort(
        (a: CheckoutGroupBuyActivityItem, b: CheckoutGroupBuyActivityItem) =>
          a.sortOrder - b.sortOrder,
      );
  }

  private assertActivityCanCheckout(
    activity: any,
    activityItems: CheckoutGroupBuyActivityItem[],
  ) {
    const now = new Date();
    if (activity.status !== GroupBuyActivityStatus.ACTIVE) {
      throw new BadRequestException("团购活动未开始或已结束");
    }
    if (activity.startAt && activity.startAt > now) {
      throw new BadRequestException("团购活动未开始");
    }
    if (!activity.endAt) {
      throw new BadRequestException("团购活动结束时间配置异常");
    }
    if (activity.endAt && activity.endAt <= now) {
      throw new BadRequestException("团购活动已结束");
    }
    if (activityItems.length === 0) {
      throw new BadRequestException("团购活动商品配置异常");
    }
    for (const item of activityItems) {
      if (!item.product || !item.sku || !item.productId || !item.skuId) {
        throw new BadRequestException("团购活动商品配置异常");
      }
      if (item.product.companyId !== PLATFORM_COMPANY_ID) {
        throw new BadRequestException("团购活动商品配置异常");
      }
      if (item.product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException("团购活动商品已下架");
      }
      if (item.sku.status !== SkuStatus.ACTIVE) {
        throw new BadRequestException("团购活动商品规格已下架");
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException("团购活动商品数量配置异常");
      }
      if (Number(item.sku.stock ?? 0) < item.quantity) {
        throw new BadRequestException("团购活动商品库存不足");
      }
    }
  }

  private async calculateShippingFee(
    activity: any,
    address: any,
    tx: Prisma.TransactionClient,
    activityItems: CheckoutGroupBuyActivityItem[],
  ) {
    if (activity.freeShipping) return 0;

    const totalWeight = activityItems.reduce((sum, item) => {
      const weightGram = Number(
        item.sku?.weightGram ?? DEFAULT_SKU_WEIGHT_GRAM,
      );
      const safeWeight =
        Number.isFinite(weightGram) && weightGram > 0
          ? weightGram
          : DEFAULT_SKU_WEIGHT_GRAM;
      return sum + safeWeight * item.quantity;
    }, 0);

    if (this.shippingRuleService?.calculateShippingDetail) {
      try {
        const detail = await this.shippingRuleService.calculateShippingDetail(
          Number(activity.price ?? 0),
          address.regionCode,
          totalWeight,
          tx,
        );
        const fee = Number(detail?.fee);
        if (Number.isFinite(fee) && fee >= 0) {
          return Number(fee.toFixed(2));
        }
        throw new Error("calculateShippingDetail returned invalid fee");
      } catch (err: any) {
        this.logger.warn(
          `团购运费规则计算失败，降级为默认运费: ${err.message}`,
        );
      }
    }

    const sysConfig = await this.bonusConfig.getSystemConfig();
    return Number((sysConfig.defaultShippingFee ?? 0).toFixed(2));
  }

  private buildItemsSnapshot(
    activity: any,
    activityItems: CheckoutGroupBuyActivityItem[],
  ) {
    const lineAmounts = this.allocateActivityPrice(
      activity.price,
      activityItems,
    );
    return activityItems.map((item, index) => {
      const product = item.product;
      const sku = item.sku;
      const unitPrice = Number((lineAmounts[index] / item.quantity).toFixed(4));
      const productType = product.type === "BUNDLE" ? "BUNDLE" : "SIMPLE";
      const bundleItems =
        productType === "BUNDLE"
          ? (product.bundleItems ?? []).map((bundleItem: any) => ({
              skuId: bundleItem.sku.id,
              productId: bundleItem.sku.product.id,
              productTitle: bundleItem.sku.product.title,
              skuTitle: bundleItem.sku.title,
              quantityPerBundle: bundleItem.quantity,
              totalQuantity: bundleItem.quantity * item.quantity,
              weightGram: bundleItem.sku.weightGram,
              sortOrder: bundleItem.sortOrder ?? 0,
            }))
          : undefined;

      return {
        skuId: item.skuId,
        quantity: item.quantity,
        isPrize: false,
        unitPrice,
        companyId: PLATFORM_COMPANY_ID,
        productSnapshot: {
          productId: item.productId,
          companyId: PLATFORM_COMPANY_ID,
          title: product.title,
          skuTitle: sku.title,
          image: product.media?.[0]?.url || "",
          price: unitPrice,
          isPrize: false,
          productType,
          ...(bundleItems && bundleItems.length > 0 ? { bundleItems } : {}),
        },
      };
    });
  }

  private allocateActivityPrice(
    activityPrice: number,
    activityItems: CheckoutGroupBuyActivityItem[],
  ) {
    const totalCents = Math.round(Number(activityPrice) * 100);
    const weights = activityItems.map((item) => {
      const skuPrice = Number(item.sku?.price ?? 0);
      const weight = skuPrice * item.quantity;
      return Number.isFinite(weight) && weight > 0 ? weight : item.quantity;
    });
    const totalWeight =
      weights.reduce((sum, weight) => sum + weight, 0) || activityItems.length;
    let remainingCents = totalCents;

    return activityItems.map((item, index) => {
      const isLast = index === activityItems.length - 1;
      const lineCents = isLast
        ? remainingCents
        : Math.max(
            0,
            Math.min(
              remainingCents,
              Math.round((totalCents * weights[index]) / totalWeight),
            ),
          );
      remainingCents -= lineCents;
      return Number((lineCents / 100).toFixed(2));
    });
  }

  private async resolveShareCode(
    tx: Prisma.TransactionClient,
    userId: string,
    activityId: string,
    shareCode: string,
  ) {
    const groupBuyCode = await tx.groupBuyCode.findUnique({
      where: { code: shareCode },
      include: {
        instance: {
          select: {
            id: true,
            userId: true,
            activityId: true,
            status: true,
            tierSnapshot: true,
            user: {
              select: { status: true, deletionExecutedAt: true },
            },
          },
        },
      },
    });
    if (!groupBuyCode || groupBuyCode.status !== GroupBuyCodeStatus.ACTIVE) {
      throw new BadRequestException("团购推荐码无效");
    }
    if (
      groupBuyCode.instance.user.status !== "ACTIVE" ||
      groupBuyCode.instance.user.deletionExecutedAt
    ) {
      throw new BadRequestException("团购推荐码无效");
    }
    if (groupBuyCode.instance.userId === userId) {
      throw new BadRequestException("不能使用自己的团购推荐码");
    }
    if (groupBuyCode.instance.activityId !== activityId) {
      throw new BadRequestException("团购推荐码与当前商品不匹配");
    }
    if (groupBuyCode.instance.status !== GroupBuyInstanceStatus.SHARING) {
      throw new BadRequestException("团购推荐码当前不可用");
    }
    const existingReferralCount = await tx.groupBuyReferral.count({
      where: {
        instanceId: groupBuyCode.instance.id,
        status: { in: ["CANDIDATE", "VALID"] },
      },
    });
    const tierCount = this.getSnapshotTierCount(
      groupBuyCode.instance.tierSnapshot,
    );
    if (existingReferralCount >= tierCount) {
      throw new BadRequestException("团购推荐码名额已满");
    }
    return groupBuyCode;
  }

  private getSnapshotTierCount(raw: unknown) {
    if (!Array.isArray(raw)) {
      throw new BadRequestException("团购推荐码配置异常");
    }
    const sequences = new Set<number>();
    for (const item of raw) {
      const sequence = Number((item as any)?.sequence);
      if (Number.isInteger(sequence) && sequence > 0) {
        sequences.add(sequence);
      }
    }
    if (sequences.size <= 0) {
      throw new BadRequestException("团购推荐码配置异常");
    }
    return sequences.size;
  }

  private getMonthStart(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  private activeOccupyingInstanceWhere(
    userId: string,
  ): Prisma.GroupBuyInstanceWhereInput {
    const now = new Date();
    return {
      userId,
      status: {
        in: [
          GroupBuyInstanceStatus.QUALIFICATION_PENDING,
          GroupBuyInstanceStatus.SHARING,
        ],
      },
      activity: {
        deletedAt: null,
        status: { not: GroupBuyActivityStatus.ENDED },
        endAt: { gt: now },
      },
    };
  }

  private async getMaxMonthlyLaunches(tx: Prisma.TransactionClient) {
    const row = await tx.ruleConfig.findUnique({
      where: { key: GROUP_BUY_MAX_MONTHLY_LAUNCHES_KEY },
      select: { value: true },
    });
    const value = this.unwrapRuleConfigNumber(row?.value);
    if (!Number.isFinite(value) || !value || value < 1) {
      return DEFAULT_MAX_MONTHLY_LAUNCHES;
    }
    return Math.max(1, Math.floor(value));
  }

  private unwrapRuleConfigNumber(raw: unknown) {
    const value =
      raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
        ? (raw as { value?: unknown }).value
        : raw;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private async toCheckoutResponse(
    session: any,
    authContext?: TrustedAuthSessionContext,
    miniProgramOpenId?: string,
  ) {
    const paymentParams = await this.buildPaymentParams(
      session,
      authContext,
      miniProgramOpenId,
    );
    return {
      sessionId: session.id,
      merchantOrderNo: session.merchantOrderNo,
      expectedTotal: session.expectedTotal,
      goodsAmount: session.goodsAmount,
      shippingFee: session.shippingFee,
      discountAmount: session.discountAmount ?? 0,
      paymentScene: session.paymentScene ?? "APP",
      paymentParams,
    };
  }

  private async buildPaymentParams(
    session: any,
    authContext?: TrustedAuthSessionContext,
    miniProgramOpenId?: string,
  ) {
    if (!this.checkoutPaymentService) {
      throw new ServiceUnavailableException("团购支付协调服务暂不可用");
    }
    const requestedScene: GroupBuyPaymentScene =
      session.paymentScene === "MINI_PROGRAM" ? "MINI_PROGRAM" : "APP";
    const openId = requestedScene === "MINI_PROGRAM"
      ? miniProgramOpenId ?? await this.resolveMiniProgramOpenId(session.userId, authContext)
      : null;
    const fenced = await this.checkoutPaymentService.createPaymentParamsForExistingCheckout({
      userId: session.userId,
      sessionId: session.id,
      requestedScene,
      miniProgramOpenId: openId,
      description: `爱买买团购订单-${session.merchantOrderNo}`,
    });
    return fenced.paymentParams;
  }

  private async persistMiniProgramPayerIdentity(
    session: { id: string; paymentChannel?: string; paymentScene?: string; miniProgramPayerOpenId?: string | null },
    openId: string,
  ) {
    if (session.miniProgramPayerOpenId && session.miniProgramPayerOpenId !== openId) {
      throw new BadRequestException("小程序支付身份快照不一致，请联系客服");
    }
    if (session.miniProgramPayerOpenId === openId) return;

    const updated = await this.prisma.checkoutSession.updateMany({
      where: {
        id: session.id,
        paymentChannel: "WECHAT_PAY",
        paymentScene: "MINI_PROGRAM",
        miniProgramPayerOpenId: null,
      },
      data: { miniProgramPayerOpenId: openId },
    });
    if (updated.count === 1) return;
    const current = await this.prisma.checkoutSession.findUnique({
      where: { id: session.id },
      select: {
        paymentChannel: true,
        paymentScene: true,
        miniProgramPayerOpenId: true,
      },
    });
    if (
      current?.paymentChannel !== "WECHAT_PAY"
      || current?.paymentScene !== "MINI_PROGRAM"
      || current?.miniProgramPayerOpenId !== openId
    ) {
      throw new BadRequestException("小程序支付身份快照不一致，请联系客服");
    }
  }

  private buildCheckoutRequestFingerprint(dto: GroupBuyCheckoutInput) {
    return JSON.stringify({
      activityId: dto.activityId.trim(),
      addressId: dto.addressId.trim(),
      shareCode: dto.shareCode?.trim() || null,
      expectedTotal:
        dto.expectedTotal === undefined
          ? null
          : Number(Number(dto.expectedTotal).toFixed(2)),
    });
  }

  private assertReusableIdempotentSession(
    session: any,
    requestedScene: GroupBuyPaymentScene,
    expectedFingerprint: string,
  ) {
    if (
      session.status !== "ACTIVE" ||
      new Date(session.expiresAt).getTime() <= Date.now()
    ) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "该结算请求已结束，请刷新后重试",
      });
    }
    const storedScene = session.paymentScene ?? "APP";
    if (storedScene !== requestedScene) {
      throw new ConflictException({
        code: "PAYMENT_SCENE_MISMATCH",
        message: "该支付由另一端发起，请先取消原支付后重新结算",
        currentScene: storedScene,
        requestedScene,
      });
    }
    const bizMeta =
      session.bizMeta && typeof session.bizMeta === "object"
        ? (session.bizMeta as Record<string, unknown>)
        : {};
    if (bizMeta.checkoutRequestFingerprint !== expectedFingerprint) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "幂等键已用于其他团购结算请求",
      });
    }
    if (
      requestedScene === "MINI_PROGRAM" &&
      session.paymentChannel !== "WECHAT_PAY"
    ) {
      throw new ConflictException({
        code: "PAYMENT_CHANNEL_MISMATCH",
        message: "该结算不是微信小程序支付",
      });
    }
  }

  private async resolveMiniProgramOpenId(
    userId: string,
    authContext?: TrustedAuthSessionContext,
  ): Promise<string> {
    if (!this.wechatPayService?.isMiniProgramAvailable?.()) {
      throw new ServiceUnavailableException("微信小程序支付暂不可用");
    }
    const miniProgramAppId = this.wechatPayService.getMiniProgramAppId?.();
    if (!miniProgramAppId) {
      throw new ServiceUnavailableException("微信小程序支付暂不可用");
    }
    if (!authContext?.sessionId || !authContext.authIdentityId) {
      throw new UnauthorizedException("小程序登录会话已失效，请重新登录");
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: authContext.sessionId,
        userId,
        authIdentityId: authContext.authIdentityId,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      select: {
        authIdentity: {
          select: {
            userId: true,
            provider: true,
            identifier: true,
            appId: true,
            verified: true,
          },
        },
      },
    });
    const identity = session?.authIdentity;
    if (
      !identity ||
      identity.userId !== userId ||
      identity.provider !== "WECHAT" ||
      identity.appId !== miniProgramAppId ||
      !identity.verified ||
      !identity.identifier?.trim()
    ) {
      throw new BadRequestException("当前账号未绑定微信小程序身份，请重新登录");
    }
    return identity.identifier.trim();
  }
}
