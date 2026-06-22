import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusConfigService } from '../bonus/engine/bonus-config.service';
import { RewardDeductionService } from '../bonus/reward-deduction.service';
import { CheckoutDto } from './checkout.dto';
import { VipCheckoutDto } from './vip-checkout.dto';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { PLATFORM_COMPANY_ID } from '../bonus/engine/constants';
import { encryptJsonValue } from '../../common/security/encryption';
import { parseChineseAddress } from '../../common/utils/parse-region';
import { DEFAULT_SKU_WEIGHT_GRAM } from '../../common/constants/shipping.constants';
import {
  getPrizeUnavailableReason,
  getUnavailableReasonText,
} from '../lottery/prize-availability.util';
import { WechatPayService } from '../payment/wechat-pay.service';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';

// 前端支付方式 → Prisma PaymentChannel 枚举
const CHANNEL_MAP: Record<string, string> = {
  wechat: 'WECHAT_PAY',
  alipay: 'ALIPAY',
  bankcard: 'UNIONPAY',
};

// 默认运费规则（ShippingRule 无匹配时的 fallback）
const DEFAULT_FREE_THRESHOLD = 99;
const DEFAULT_BASE_FEE = 8;

/** 快照中每一条购物车项的结构 */
interface SnapshotItem {
  skuId: string;
  quantity: number;
  cartItemId?: string;
  isPrize: boolean;
  prizeRecordId?: string;
  prizeType?: string;
  unitPrice: number;
  companyId: string;
  /** 结算时按商户分组计算出的运费快照（用于支付回调建单） */
  groupShippingFee?: number;
  productSnapshot: any;
}

export interface ExcludedCheckoutItem {
  cartItemId?: string;
  skuId: string;
  reason: string;
  isPrize: boolean;
  prizeRecordId?: string | null;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  // ShippingRuleService 通过可选注入（避免循环依赖）
  private shippingRuleService: any = null;
  // CouponService 通过可选注入（避免循环依赖）
  private couponService: any = null;
  // BonusService 通过可选注入（VIP 激活用）
  private bonusService: any = null;
  // InboxService 硬依赖（C13修复：确保上线后通知一定能发出去）
  private inboxService: any = null; // 由 OrderModule.onModuleInit 注入，启动时校验
  // AlipayService 通过可选注入（支付宝下单用）
  private alipayService: any = null;
  private wechatPayService: any = null;
  // PaymentService 通过可选注入（cancel/expire 主动建单后通知商家用）
  private paymentService: any = null;
  // RewardDeductionService 通过 setter 注入，避免扩大构造函数循环依赖面
  private rewardDeductionService: RewardDeductionService | null = null;
  private digitalAssetService: DigitalAssetService | null = null;

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
  ) {}

  /** 注入运费规则服务（由 OrderModule 在 onModuleInit 时调用） */
  setShippingRuleService(service: any) {
    this.shippingRuleService = service;
  }

  /** 注入红包服务（由 OrderModule 在 onModuleInit 时调用） */
  setCouponService(service: any) {
    this.couponService = service;
  }

  /** 注入分润服务（VIP 激活用，由 OrderModule 在 onModuleInit 时调用） */
  setBonusService(service: any) {
    this.bonusService = service;
  }

  /** 注入站内消息服务（VIP 开通通知用，由 OrderModule 在 onModuleInit 时调用） */
  setInboxService(service: any) {
    this.inboxService = service;
  }

  /** 注入支付宝服务（由 OrderModule 在 onModuleInit 时调用） */
  setAlipayService(service: any) {
    this.alipayService = service;
  }

  /** 注入微信支付服务（由 OrderModule 在 onModuleInit 时调用） */
  setWechatPayService(service: any) {
    this.wechatPayService = service;
  }

  /** 注入支付服务（cancel/expire 主动建单后通知商家用，由 OrderModule 在 onModuleInit 时调用） */
  setPaymentService(service: any) {
    this.paymentService = service;
  }

  /** 注入消费积分抵扣服务（由 OrderModule 在 onModuleInit 时调用） */
  setRewardDeductionService(service: RewardDeductionService) {
    this.rewardDeductionService = service;
  }

  /** 注入数字资产服务（普通商品付款后冻结消费资产） */
  setDigitalAssetService(service: DigitalAssetService) {
    this.digitalAssetService = service;
  }

  private extractWechatAmountFen(queryResult: any): number | null {
    const rawFen = queryResult?.totalAmountFen ?? queryResult?.amountFen;
    return (
      typeof rawFen === 'number' &&
      Number.isInteger(rawFen) &&
      Number.isSafeInteger(rawFen) &&
      rawFen >= 0
    ) ? rawFen : null;
  }

  private assertWechatAmountMatchesSession(
    queryResult: any,
    expectedTotal: number,
    context: string,
    sessionId: string,
  ): void {
    const claimedFen = this.extractWechatAmountFen(queryResult);
    const expectedFen = WechatPayService.yuanToFenAmount(expectedTotal, 'expectedTotal');
    if (claimedFen === null || claimedFen !== expectedFen) {
      this.logger.error(
        `${context} 微信金额校验失败：wechatFen=${claimedFen ?? 'N/A'} sessionFen=${expectedFen} sessionId=${sessionId}`,
      );
      throw new BadRequestException('支付金额校验失败，请联系客服');
    }
  }

  // ---------- 公开方法 ----------

  /** F1: 创建 CheckoutSession（校验库存+计算总额+预留奖励+返回支付参数） */
  async checkout(userId: string, dto: CheckoutDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('购物车为空，请先添加商品');
    }
    const excludedItems: ExcludedCheckoutItem[] = [];

    const toCheckoutResponse = async (session: {
      id: string;
      merchantOrderNo: string | null;
      expectedTotal: number;
      goodsAmount: number;
      shippingFee: number;
      discountAmount: number;
      paymentChannel?: string | null;
      vipDiscountAmount?: number;
      totalCouponDiscount?: number;
      couponInstanceIds?: string[];
    }) => {
      let paymentParams: Record<string, any> = {};

      // 支付宝渠道：生成 APP 支付参数
      if (session.paymentChannel === 'ALIPAY' && this.alipayService?.isAvailable() && session.merchantOrderNo) {
        try {
          const orderStr = await this.alipayService.createAppPayOrder({
            merchantOrderNo: session.merchantOrderNo,
            totalAmount: session.expectedTotal,
            subject: `爱买买订单-${session.merchantOrderNo}`,
          });
          paymentParams = { channel: 'alipay', orderStr };
        } catch (err: any) {
          this.logger.error(`生成支付宝支付参数失败: ${err.message}`);
        }
      } else if (session.paymentChannel === 'WECHAT_PAY' && this.wechatPayService?.isAvailable() && session.merchantOrderNo) {
        try {
          const wxParams = await this.wechatPayService.createAppOrder({
            outTradeNo: session.merchantOrderNo,
            amount: session.expectedTotal,
            description: `爱买买订单-${session.merchantOrderNo}`,
          });
          paymentParams = { channel: 'wechat', ...wxParams };
        } catch (err: any) {
          this.logger.error(`生成微信支付参数失败: ${err.message}`);
        }
      }

      return {
        sessionId: session.id,
        merchantOrderNo: session.merchantOrderNo,
        expectedTotal: session.expectedTotal,
        goodsAmount: session.goodsAmount,
        shippingFee: session.shippingFee,
        discountAmount: session.discountAmount,
        vipDiscountAmount: session.vipDiscountAmount ?? 0,
        totalCouponDiscount: session.totalCouponDiscount ?? 0,
        couponInstanceIds: session.couponInstanceIds ?? [],
        excludedItems,
        paymentParams,
      };
    };

    // 幂等检查（按 bizType 过滤，避免与 VIP 订单 idempotencyKey 冲突）
    if (dto.idempotencyKey) {
      const existing = await this.prisma.checkoutSession.findFirst({
        where: {
          userId,
          bizType: 'NORMAL_GOODS',
          idempotencyKey: dto.idempotencyKey,
        },
      });
      if (existing) {
        return await toCheckoutResponse(existing);
      }
    }

    // Task 18 修正：防重锁挪进 Serializable 事务内执行（见步骤 11），
    // 避免两个并发请求都通过事务外检查再各自创建 ACTIVE session

    // 1. 查询所有 SKU 信息
    const skuIds = dto.items.map((i) => i.skuId);
    const skus = await this.prisma.productSKU.findMany({
      where: { id: { in: skuIds } },
      include: {
        product: {
          include: {
            media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
      },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    // N01修复：SKU fallback（skuId 可能是 productId）
    const fallbackSkuIds = dto.items.filter((i) => !skuMap.has(i.skuId)).map((i) => i.skuId);
    if (fallbackSkuIds.length > 0) {
      const fallbackSkus = await this.prisma.productSKU.findMany({
        where: { productId: { in: fallbackSkuIds }, status: 'ACTIVE' },
        include: {
          product: {
            include: {
              media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      const fallbackMap = new Map<string, (typeof fallbackSkus)[0]>();
      for (const s of fallbackSkus) {
        if (!fallbackMap.has(s.productId)) fallbackMap.set(s.productId, s);
      }
      for (const item of dto.items) {
        if (!skuMap.has(item.skuId) && fallbackMap.has(item.skuId)) {
          const realSku = fallbackMap.get(item.skuId)!;
          skuMap.set(item.skuId, realSku);
          (item as any)._resolvedSkuId = realSku.id;
        }
      }
    }

    // 2. 查询用户购物车中的所有项（用于匹配 cartItemId + 奖品识别）
    const userCart = await this.prisma.cart.findUnique({ where: { userId } });
    const allCartItems = userCart
      ? await this.prisma.cartItem.findMany({
          where: { cartId: userCart.id },
        })
      : [];
    // 奖品项（非过期）
    const cartPrizeItems = allCartItems.filter(
      (ci) => ci.isPrize && (!ci.expiresAt || ci.expiresAt >= new Date()),
    );
    // 普通项：按 skuId 索引（用于查找 cartItemId）
    const normalCartBySkuId = new Map<string, typeof allCartItems[0]>();
    for (const ci of allCartItems) {
      if (!ci.isPrize && !normalCartBySkuId.has(ci.skuId)) {
        normalCartBySkuId.set(ci.skuId, ci);
      }
    }
    const cartItemById = new Map(cartPrizeItems.map((ci) => [ci.id, ci]));
    const cartPrizeBySkuId = new Map<string, typeof cartPrizeItems>();
    for (const ci of cartPrizeItems) {
      if (!cartPrizeBySkuId.has(ci.skuId)) cartPrizeBySkuId.set(ci.skuId, []);
      cartPrizeBySkuId.get(ci.skuId)!.push(ci);
    }

    // 3. 校验 SKU 有效性、匹配奖品项、构建快照
    const matchedPrizeCartItemIds = new Set<string>();
    const snapshotItems: SnapshotItem[] = [];

    for (const item of dto.items) {
      const sku = skuMap.get(item.skuId);
      if (!sku) throw new BadRequestException(`商品规格 ${item.skuId} 不存在`);

      const resolvedSkuId = (item as any)._resolvedSkuId || sku.id;

      // 匹配奖品购物车项
      let prizeCartItem: (typeof cartPrizeItems)[0] | null = null;
      if (item.cartItemId && cartItemById.has(item.cartItemId)) {
        const candidate = cartItemById.get(item.cartItemId)!;
        if (candidate.isPrize) {
          if (candidate.skuId !== resolvedSkuId) {
            throw new BadRequestException('购物车项与商品规格不匹配，请刷新购物车后重试');
          }
          if (!matchedPrizeCartItemIds.has(candidate.id)) {
            prizeCartItem = candidate;
            matchedPrizeCartItemIds.add(candidate.id);
          }
        }
      }
      if (!item.cartItemId && !prizeCartItem && cartPrizeBySkuId.has(resolvedSkuId)) {
        const candidates = cartPrizeBySkuId.get(resolvedSkuId)!;
        for (const c of candidates) {
          if (!matchedPrizeCartItemIds.has(c.id)) {
            prizeCartItem = c;
            matchedPrizeCartItemIds.add(c.id);
            break;
          }
        }
      }

      if (sku.status !== 'ACTIVE' || sku.product.status !== 'ACTIVE') {
        if (prizeCartItem) {
          excludedItems.push({
            cartItemId: prizeCartItem.id,
            skuId: resolvedSkuId,
            reason: sku.status !== 'ACTIVE' ? '商品规格已下架' : '商品已下架',
            isPrize: true,
            prizeRecordId: prizeCartItem.prizeRecordId ?? null,
          });
          continue;
        }
        if (sku.status !== 'ACTIVE') throw new BadRequestException(`商品规格 ${sku.title} 已下架`);
        throw new BadRequestException(`商品 ${sku.product.title} 已下架`);
      }

      if (!prizeCartItem) {
        if (sku.stock <= 0) {
          throw new BadRequestException(`商品「${sku.product.title}」暂无库存，请从购物车移除后再结算`);
        }
        if (item.quantity > sku.stock) {
          throw new BadRequestException(`商品「${sku.product.title}」当前仅剩 ${sku.stock} 件，请调整数量`);
        }
      }

      // 单笔限购校验
      if (sku.maxPerOrder !== null && item.quantity > sku.maxPerOrder) {
        throw new BadRequestException(
          `商品规格「${sku.title}」每单限购 ${sku.maxPerOrder} 件`,
        );
      }

      let unitPrice = sku.price;
      let isPrize = false;
      let prizeType: string | null = null;
      let prizeRecordId: string | null = null;

      if (prizeCartItem) {
        isPrize = true;
        prizeRecordId = prizeCartItem.prizeRecordId;
        item.quantity = prizeCartItem.quantity; // 强制使用购物车数量

        // 校验 LotteryRecord 生命周期
        if (prizeCartItem.prizeRecordId) {
          const lotteryRecord = await this.prisma.lotteryRecord.findUnique({
            where: { id: prizeCartItem.prizeRecordId },
            include: {
              prize: {
                include: {
                  sku: { include: { product: true } },
                  product: true,
                },
              },
            },
          });
          if (lotteryRecord) {
            const unavailableReason = (lotteryRecord as any).prize
              ? getPrizeUnavailableReason((lotteryRecord as any).prize)
              : null;
            if (unavailableReason) {
              excludedItems.push({
                cartItemId: prizeCartItem.id,
                skuId: resolvedSkuId,
                reason: getUnavailableReasonText(unavailableReason),
                isPrize: true,
                prizeRecordId: prizeCartItem.prizeRecordId ?? null,
              });
              continue;
            }
            const validStatuses = ['WON', 'IN_CART'];
            if (!validStatuses.includes(lotteryRecord.status)) {
              throw new BadRequestException(
                `奖品状态不允许结算（当前状态：${lotteryRecord.status}），请移除该奖品`,
              );
            }
            if (lotteryRecord.meta) {
              const meta = lotteryRecord.meta as any;
              prizeType = meta.prizeType || null;
              if (meta.prizePrice !== undefined && meta.prizePrice !== null) {
                unitPrice = meta.prizePrice;
              }
            }
          }
        }
      }

      // C3修复：为普通商品项也记录 cartItemId，避免支付回调时按 skuId 批量删除误伤
      const normalCartItem = !isPrize ? normalCartBySkuId.get(resolvedSkuId) || normalCartBySkuId.get(item.skuId) : undefined;
      snapshotItems.push({
        skuId: resolvedSkuId,
        quantity: item.quantity,
        cartItemId: prizeCartItem?.id || normalCartItem?.id || item.cartItemId,
        isPrize,
        prizeRecordId: prizeRecordId || undefined,
        prizeType: prizeType || undefined,
        unitPrice,
        companyId: sku.product.companyId,
        productSnapshot: {
          productId: sku.product.id,
          companyId: sku.product.companyId,
          title: sku.product.title,
          skuTitle: sku.title,
          image: sku.product.media?.[0]?.url || '',
          price: unitPrice,
          isPrize,
          prizeType,
        },
      });
    }

    // 4. F2: THRESHOLD_GIFT 门槛校验
    const thresholdItems = snapshotItems.filter(
      (si) => si.isPrize && si.prizeType === 'THRESHOLD_GIFT',
    );
    if (thresholdItems.length > 0) {
      const nonPrizeTotal = snapshotItems
        .filter((si) => !si.isPrize)
        .reduce((sum, si) => sum + si.unitPrice * si.quantity, 0);

      const excludeIndices: number[] = [];
      for (const tpi of thresholdItems) {
        const matchedCi = cartPrizeItems.find(
          (ci) => ci.skuId === tpi.skuId && ci.prizeRecordId,
        );
        let effectiveThreshold = matchedCi?.threshold ?? 0;
        if (!effectiveThreshold && tpi.prizeRecordId) {
          const lr = await this.prisma.lotteryRecord.findUnique({
            where: { id: tpi.prizeRecordId },
          });
          effectiveThreshold = (lr?.meta as any)?.threshold ?? 0;
        }
        if (effectiveThreshold && nonPrizeTotal < effectiveThreshold) {
          const idx = snapshotItems.indexOf(tpi);
          if (idx >= 0) excludeIndices.push(idx);
          this.logger.log(
            `F2: 赠品 ${tpi.skuId} 未解锁（需 ¥${effectiveThreshold}，当前 ¥${nonPrizeTotal.toFixed(2)}），排除`,
          );
        }
      }
      for (const idx of excludeIndices.sort((a, b) => b - a)) {
        snapshotItems.splice(idx, 1);
      }
    }

    if (snapshotItems.length === 0) {
      throw new BadRequestException('没有可结算的商品（赠品未解锁或奖品已过期）');
    }

    // 5. 地址快照
    let addressSnapshot: any = null;
    let regionCode: string | undefined;
    if (dto.addressId) {
      const address = await this.prisma.address.findUnique({
        where: { id: dto.addressId, userId, deletedAt: null },
      });
      if (address) {
        regionCode = address.regionCode;
        const region = parseChineseAddress(address.regionText);
        addressSnapshot = {
          recipientName: address.recipientName,
          phone: address.phone,
          regionCode: address.regionCode,
          regionText: address.regionText,
          province: region.province,
          city: region.city,
          district: region.district,
          detail: address.detail,
        };
      }
    }
    if (!addressSnapshot) {
      throw new BadRequestException('请选择有效的收货地址');
    }
    const encryptedAddressSnapshot = encryptJsonValue(addressSnapshot);

    // 6. 按 companyId 分组
    const itemsByCompany = new Map<string, SnapshotItem[]>();
    for (const si of snapshotItems) {
      const key = si.companyId ?? '__NO_COMPANY__';
      if (!itemsByCompany.has(key)) itemsByCompany.set(key, []);
      itemsByCompany.get(key)!.push(si);
    }

    // 构建 skuId → weightGram 映射
    const skuWeightMap = new Map<string, number>();
    for (const [id, sku] of skuMap.entries()) {
      const weightGram = this.normalizeSkuWeightGram((sku as any).weightGram);
      skuWeightMap.set(id, weightGram);
      skuWeightMap.set(sku.id, weightGram);
    }

    const companyGroups = [...itemsByCompany.entries()]
      .map(([companyId, items]) => ({
        companyId,
        items,
        goodsAmount: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
        totalWeight: items.reduce(
          (sum, i) => sum + i.quantity * (skuWeightMap.get(i.skuId) ?? 0),
          0,
        ),
      }))
      .sort((a, b) => b.goodsAmount - a.goodsAmount);

    // VIP 折扣计算：VIP 用户对非奖励商品打折（平台补贴）
    let vipDiscountAmount = 0;
    const vipNode = await this.prisma.vipTreeNode.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (vipNode) {
      const sysConfig = await this.bonusConfig.getSystemConfig();
      const vipRate = sysConfig.vipDiscountRate ?? 0.95;
      if (vipRate < 1.0) {
        // 查询哪些 companyId 是平台公司
        const companyIds = companyGroups.map((g) => g.companyId).filter((id) => id !== '__NO_COMPANY__');
        const platformCompanies = companyIds.length > 0
          ? await this.prisma.company.findMany({
              where: { id: { in: companyIds }, isPlatform: true },
              select: { id: true },
            })
          : [];
        const platformCompanyIds = new Set(platformCompanies.map((c) => c.id));
        // 非奖励商品总额
        const nonPlatformGoodsAmount = companyGroups
          .filter((g) => !platformCompanyIds.has(g.companyId))
          .reduce((sum, g) => sum + g.goodsAmount, 0);
        vipDiscountAmount = Number(
          (nonPlatformGoodsAmount * (1 - vipRate)).toFixed(2),
        );
      }
    }

    // 7. 计算运费 — 平台统一发货，用整单总金额和总重量计算一次（VIP 享受更低免运费门槛）
    const totalGoodsForShipping = companyGroups.reduce((s, g) => s + g.goodsAmount, 0);
    const totalWeightForShipping = companyGroups.reduce((s, g) => s + g.totalWeight, 0);
    const isVip = !!vipNode;
    const shippingDetail = await this.calculateShippingDetailForCheckout(
      totalGoodsForShipping,
      regionCode,
      totalWeightForShipping,
      isVip,
    );
    const totalShippingFee = shippingDetail.fee;
    // 运费统一记录到快照中（每个商品项记录总运费，建单时按比例分配）
    for (const item of snapshotItems) {
      item.groupShippingFee = totalShippingFee;
    }

    // 8. 平台红包校验与锁定（在奖励预留之前执行，独立 Serializable 事务）
    const totalGoodsAmount = companyGroups.reduce((s, g) => s + g.goodsAmount, 0);
    let couponReservation: {
      totalDiscount: number;
      perCouponAmounts: Array<{ couponInstanceId: string; discountAmount: number }>;
    } | null = null;

    if (dto.couponInstanceIds && dto.couponInstanceIds.length > 0) {
      if (!this.couponService) {
        throw new BadRequestException('红包服务不可用，请稍后重试');
      }

      // 收集品类 ID 和商户 ID（用于红包适用范围校验）
      const categoryIds: string[] = [];
      const companyIds: string[] = [];
      for (const sku of skus) {
        if (sku.product.companyId && !companyIds.includes(sku.product.companyId)) {
          companyIds.push(sku.product.companyId);
        }
        if ((sku.product as any).categoryId && !categoryIds.includes((sku.product as any).categoryId)) {
          categoryIds.push((sku.product as any).categoryId);
        }
      }

      try {
        couponReservation = await this.couponService.validateAndReserveCoupons(
          userId,
          dto.couponInstanceIds,
          totalGoodsAmount,
          categoryIds,
          companyIds,
        );
        this.logger.log(
          `红包锁定成功：${dto.couponInstanceIds.length} 张，总抵扣 ¥${couponReservation!.totalDiscount}`,
        );
      } catch (err: any) {
        // 红包校验失败直接抛出，不需要清理（validateAndReserveCoupons 内部事务会回滚）
        throw err;
      }
    }

    // 消费积分抵扣上限只读校验；事务内 reserveDeduction 会重新校验并 CAS 扣减。
    if (dto.deductionAmount && dto.deductionAmount > 0) {
      if (!this.rewardDeductionService) {
        throw new BadRequestException('消费积分抵扣服务不可用，请稍后重试');
      }
      const maxDeduction = await this.rewardDeductionService.calculateMaxDeductible(
        userId,
        totalGoodsAmount,
      );
      if (dto.deductionAmount > maxDeduction.maxDeductible) {
        throw new BadRequestException('抵扣金额超出上限');
      }
    }

    // 10. 生成 merchantOrderNo（在事务外生成，事务内使用）
    const merchantOrderNo = `CS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const paymentChannel = dto.paymentChannel ? CHANNEL_MAP[dto.paymentChannel] : null;

    // 红包抵扣金额（来自独立事务的锁定结果）
    const totalCouponDiscount = couponReservation?.totalDiscount ?? 0;
    const reservedCouponIds = dto.couponInstanceIds ?? [];

    // 11. H6修复：奖励预留 + Session 创建在同一个 Serializable 事务中
    //     如果事务回滚，奖励状态自动恢复，不会出现 RESERVED 泄漏
    //     注意：红包已在步骤 8 的独立事务中锁定（AVAILABLE → RESERVED），
    //     如果本事务失败，需要在 catch 中释放红包
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const session = await this.prisma.$transaction(async (tx) => {
          // Task 18 修正：防重锁按 bizType 隔离 — 普通商品 session 间互斥；
          // 不影响 VIP session（用户可以同时有一个普通 + 一个 VIP ACTIVE session）
          const activeSession = await tx.checkoutSession.findFirst({
            where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() }, bizType: 'NORMAL_GOODS' },
            orderBy: { createdAt: 'desc' },
          });
          if (activeSession && (!dto.idempotencyKey || activeSession.idempotencyKey !== dto.idempotencyKey)) {
            throw new ConflictException({
              code: 'PENDING_CHECKOUT_EXISTS',
              message: '你有未完成的订单，请先完成支付或取消',
            });
          }

          // 消费积分抵扣 CAS 预留（在事务内执行，回滚时自动恢复）
          let discountAmount = 0;
          let reservedRewardId: string | null = null;
          let deductionGroupId: string | null = null;

          if (dto.deductionAmount && dto.deductionAmount > 0) {
            if (!this.rewardDeductionService) {
              throw new BadRequestException('消费积分抵扣服务不可用，请稍后重试');
            }
            const reserved = await this.rewardDeductionService.reserveDeduction(
              tx,
              userId,
              totalGoodsAmount,
              dto.deductionAmount,
            );
            if (reserved) {
              discountAmount = Number((reserved.deductedFromVip + reserved.deductedFromNormal).toFixed(2));
              reservedRewardId = reserved.primaryLedgerId;
              deductionGroupId = reserved.groupId;
            }
          }

          // 计算应付总额（按商户分摊分润奖励抵扣 + 平台红包抵扣）
          const rewardDiscountAllocations = this.allocateDiscountByCapacities(
            companyGroups.map((group) => group.goodsAmount),
            discountAmount,
          );
          const remainingCapacities = companyGroups.map((group, idx) =>
            Math.max(0, group.goodsAmount - rewardDiscountAllocations[idx]),
          );
          const couponDiscountAllocations = this.allocateDiscountByCapacities(
            remainingCapacities,
            totalCouponDiscount,
          );
          const effectiveTotalCouponDiscount = Number(
            couponDiscountAllocations
              .reduce((sum, value) => sum + value, 0)
              .toFixed(2),
          );
          const effectiveCouponPerAmounts = this.capCouponPerAmounts(
            couponReservation?.perCouponAmounts ?? [],
            reservedCouponIds,
            effectiveTotalCouponDiscount,
          );
          const totalGroupDiscount = companyGroups.reduce((total, _, idx) => {
            return total + rewardDiscountAllocations[idx] + couponDiscountAllocations[idx];
          }, 0);
          const expectedTotal = Math.max(0, totalGoodsForShipping - vipDiscountAmount - totalGroupDiscount + totalShippingFee);

          if (expectedTotal <= 0) {
            throw new BadRequestException('订单金额必须大于 0');
          }

          // S12: 前端 expectedTotal 校验（在事务内，失败会自动回滚奖励预留）
          if (dto.expectedTotal !== undefined && dto.expectedTotal !== null) {
            const diff = Math.abs(expectedTotal - dto.expectedTotal);
            const excludedPrizeItems = excludedItems.filter((item) => item.isPrize);
            const onlyLowerBecausePrizeExcluded =
              excludedPrizeItems.length > 0 &&
              excludedPrizeItems.length === excludedItems.length &&
              expectedTotal <= dto.expectedTotal;
            if (diff > 0.01 && !onlyLowerBecausePrizeExcluded) {
              // 直接抛异常，事务回滚会自动释放奖励预留
              throw new BadRequestException(
                `价格已变更：预期 ¥${dto.expectedTotal.toFixed(2)}，实际 ¥${expectedTotal.toFixed(2)}。请刷新后重新结算`,
              );
            }
          }

          // 创建 CheckoutSession（含平台红包信息）
          const excludedPrizeItems = excludedItems.filter((item) => item.isPrize);
          const created = await tx.checkoutSession.create({
            data: {
              userId,
              status: 'ACTIVE',
              bizMeta: excludedPrizeItems.length > 0
                ? ({ excludedPrizeItems } as unknown as Prisma.InputJsonValue)
                : undefined,
              itemsSnapshot: snapshotItems as any,
              addressSnapshot: encryptedAddressSnapshot as any,
              rewardId: reservedRewardId && discountAmount > 0 ? reservedRewardId : null,
              deductionGroupId,
              expectedTotal,
              goodsAmount: totalGoodsAmount,
              shippingFee: totalShippingFee,
              discountAmount,
              vipDiscountAmount,
              // 平台红包
              couponInstanceIds: reservedCouponIds,
              totalCouponDiscount: effectiveTotalCouponDiscount,
              couponPerAmounts: effectiveCouponPerAmounts as any,
              merchantOrderNo,
              paymentChannel: paymentChannel as any,
              idempotencyKey: dto.idempotencyKey || null,
              buyerNote: dto.buyerNote || null,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 分钟过期
            } as any,
          });

          return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        this.logger.log(
          `CheckoutSession 已创建: sessionId=${session.id}, merchantOrderNo=${session.merchantOrderNo}, total=${session.expectedTotal}` +
          (vipDiscountAmount > 0 ? `, VIP折扣=${vipDiscountAmount}` : '') +
          ((session.totalCouponDiscount ?? 0) > 0 ? `, 红包抵扣=${session.totalCouponDiscount}` : ''),
        );

        return await toCheckoutResponse(session);
      } catch (err: any) {
        // P2034 序列化冲突重试（不释放红包，重试即可）
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `checkout createSession 序列化冲突，第 ${attempt + 1}/${MAX_RETRIES} 次重试`,
          );
          continue;
        }
        // P2002 唯一约束冲突（幂等键重复）— 新唯一约束 (userId, bizType, idempotencyKey)
        if (err?.code === 'P2002' && dto.idempotencyKey) {
          const existing = await this.prisma.checkoutSession.findFirst({
            where: { userId, bizType: 'NORMAL_GOODS', idempotencyKey: dto.idempotencyKey },
          });
          if (existing) {
            return await toCheckoutResponse(existing);
          }
        }
        // 事务失败（非重试情况）：释放已锁定的红包，防止 RESERVED 泄漏
        if (reservedCouponIds.length > 0 && this.couponService) {
          try {
            await this.couponService.releaseCoupons(reservedCouponIds);
            this.logger.warn(
              `Session 创建失败，已释放 ${reservedCouponIds.length} 张红包`,
            );
          } catch (releaseErr: any) {
            this.logger.error(
              `释放红包失败（RESERVED 泄漏风险）：${releaseErr.message}`,
            );
          }
        }
        throw err;
      }
    }
    // TypeScript 需要显式兜底（理论上不可达）— 释放红包后再抛
    if (reservedCouponIds.length > 0 && this.couponService) {
      try {
        await this.couponService.releaseCoupons(reservedCouponIds);
      } catch {
        // 忽略
      }
    }
    throw new BadRequestException('结算创建失败，请重试');
  }

  /**
   * VIP 礼包结算（Phase 3）
   * 独立于普通商品 checkout，无购物车、无红包、无分润奖励、包邮。
   */
  async checkoutVipPackage(userId: string, dto: VipCheckoutDto) {
    // 1. 读取 VIP 档位信息（价格来自 VipPackage 而非全局配置）
    const pkg = await this.prisma.vipPackage.findUnique({
      where: { id: dto.packageId },
    });
    if (!pkg || pkg.status !== 'ACTIVE') {
      throw new BadRequestException('VIP 档位不存在或已下架');
    }
    const vipPrice = pkg.price;

    // 2. 幂等检查（按 bizType 过滤，避免与普通订单 idempotencyKey 冲突）
    if (dto.idempotencyKey) {
      const existing = await this.prisma.checkoutSession.findFirst({
        where: { userId, bizType: 'VIP_PACKAGE', idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        return {
          sessionId: existing.id,
          merchantOrderNo: existing.merchantOrderNo,
          expectedTotal: existing.expectedTotal,
          goodsAmount: vipPrice,
          shippingFee: 0,
          discountAmount: 0,
        };
      }
    }

    // Task 18 修正：防重锁挪进 Serializable 事务内执行（见步骤 9），
    // 避免两个并发请求都通过事务外检查再各自创建 ACTIVE session

    // 3. 校验赠品方案（事务外预检，减少事务持锁时间）
    const giftOption = await this.prisma.vipGiftOption.findUnique({
      where: { id: dto.giftOptionId },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            sku: {
              include: {
                product: {
                  select: {
                    id: true,
                    title: true,
                    companyId: true,
                    status: true,
                    media: { orderBy: { sortOrder: 'asc' as const }, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!giftOption) {
      throw new NotFoundException('赠品方案不存在');
    }
    if (giftOption.status !== 'ACTIVE') {
      throw new BadRequestException('该赠品方案已下架');
    }
    if (giftOption.packageId !== dto.packageId) {
      throw new BadRequestException('赠品方案与所选档位不匹配');
    }
    if (giftOption.items.length === 0) {
      throw new BadRequestException('该赠品方案没有配置商品');
    }
    // 逐项校验库存和状态
    for (const giftItem of giftOption.items) {
      if (giftItem.sku.status !== 'ACTIVE') {
        throw new BadRequestException(`赠品 SKU「${giftItem.sku.title}」已下架`);
      }
      if (giftItem.sku.product?.status !== 'ACTIVE') {
        throw new BadRequestException(`赠品商品「${giftItem.sku.product?.title}」已下架`);
      }
      if (giftItem.sku.stock < giftItem.quantity) {
        throw new BadRequestException(`赠品「${giftItem.sku.title}」库存不足`);
      }
      if (giftItem.sku.product?.companyId !== PLATFORM_COMPANY_ID) {
        throw new BadRequestException('赠品 SKU 必须属于平台公司');
      }
    }

    // 4. 价格校验（如前端传了 expectedTotal）
    if (dto.expectedTotal != null && Math.abs(dto.expectedTotal - vipPrice) > 0.01) {
      throw new BadRequestException(
        `价格不一致：前端 ${dto.expectedTotal}，服务端 ${vipPrice}，请刷新后重试`,
      );
    }

    // 5. 地址快照
    const address = await this.prisma.address.findUnique({
      where: { id: dto.addressId, userId, deletedAt: null },
    });
    if (!address) {
      throw new BadRequestException('收货地址无效');
    }
    const region = parseChineseAddress(address.regionText);
    const addressSnapshot = {
      recipientName: address.recipientName,
      phone: address.phone,
      regionCode: address.regionCode,
      regionText: address.regionText,
      province: region.province,
      city: region.city,
      district: region.district,
      detail: address.detail,
    };
    const encryptedAddressSnapshot = encryptJsonValue(addressSnapshot);

    // 6. 商品快照（多商品组合）
    //    Phase 3 Review Fix 1：嵌套 productSnapshot 结构对齐普通 checkout
    //    下游 getPendingForUser / handlePaymentSuccess 直接将 productSnapshot 落到 OrderItem
    const itemsSnapshot: Array<{
      skuId: string;
      productId: string;
      unitPrice: number;
      quantity: number;
      isPrize: boolean;
      companyId: string;
      productSnapshot: {
        productId: string;
        companyId: string;
        title: string;
        skuTitle: string;
        image: string;
        price: number;
        isPrize: boolean;
      };
    }> = giftOption.items.map((giftItem) => {
      const sku = giftItem.sku;
      const product = sku.product;
      const unitPrice = sku.price;
      return {
        skuId: sku.id,
        productId: product?.id || '',
        unitPrice,
        quantity: giftItem.quantity,
        isPrize: false,
        companyId: PLATFORM_COMPANY_ID,
        productSnapshot: {
          productId: product?.id || '',
          companyId: PLATFORM_COMPANY_ID,
          title: product?.title || '',
          skuTitle: sku.title || '',
          image: product?.media?.[0]?.url || '',
          price: unitPrice,
          isPrize: false,
        },
      };
    });

    // 7. bizMeta（VIP 礼包专用元数据）
    const bizMeta = {
      vipPackageId: pkg.id,
      referralBonusRate: pkg.referralBonusRate,
      vipGiftOptionId: giftOption.id,
      giftTitle: giftOption.title,
      giftCoverMode: giftOption.coverMode,
      giftCoverUrl: giftOption.coverUrl || null,
      giftBadge: giftOption.badge || null,
      itemCount: giftOption.items.length,
      snapshotPrice: vipPrice,
      shippingFeeMode: 'FREE' as const,
      inventoryReserved: true,
    };

    // 8. 支付渠道
    const paymentChannel = dto.paymentChannel
      ? CHANNEL_MAP[dto.paymentChannel] || dto.paymentChannel
      : 'WECHAT_PAY';

    // 9. Serializable 事务：VIP 状态检查 + 活跃会话检查 + 创建会话（原子操作）
    //    Fix 2：与普通 checkout 一致，加 P2034 序列化冲突重试（指数退避）
    const VIP_MAX_RETRIES = 3;
    let vipSession: any = null;
    let vipLastErr: any = null;
    for (let attempt = 0; attempt < VIP_MAX_RETRIES; attempt++) {
      try {
        vipSession = await this.prisma.$transaction(async (tx) => {
          // Task 18 修正：防重锁按 bizType 隔离 — VIP session 间互斥；
          // 不影响普通商品 session（跨类型不互斥）
          const globalActiveSession = await tx.checkoutSession.findFirst({
            where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() }, bizType: 'VIP_PACKAGE' },
            orderBy: { createdAt: 'desc' },
          });
          if (
            globalActiveSession &&
            (!dto.idempotencyKey || globalActiveSession.idempotencyKey !== dto.idempotencyKey)
          ) {
            throw new ConflictException({
              code: 'PENDING_CHECKOUT_EXISTS',
              message: '你有未完成的订单，请先完成支付或取消',
            });
          }

          // 事务内校验用户不是 VIP（防止检查到创建之间的竞态）
          const member = await tx.memberProfile.findUnique({
            where: { userId },
          });
          if (member?.tier === 'VIP') {
            throw new BadRequestException('您已是 VIP 会员，无需重复购买');
          }

          // 清理并释放当前用户已过期的 VIP 会话，避免过期预留阻塞再次下单
          const expiredVipSessions = await tx.checkoutSession.findMany({
            where: {
              userId,
              bizType: 'VIP_PACKAGE',
              status: 'ACTIVE',
              expiresAt: { lt: new Date() },
            },
            select: {
              id: true,
              bizType: true,
              itemsSnapshot: true,
            },
          });
          for (const expiredSession of expiredVipSessions) {
            await this.releaseVipReservation(tx, expiredSession);
            await tx.checkoutSession.update({
              where: { id: expiredSession.id },
              data: { status: 'EXPIRED' },
            });
          }

          // 商户订单号
          const merchantOrderNo = `VIP${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
          // VIP 会话过期时间（5 分钟）— VIP 不需要"未完成订单"概念，用户取消后可立即重下单；
          // 5min 仅作为前端 cancel 调用失败时的后端兜底超时
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

          const txSession = await tx.checkoutSession.create({
            data: {
              userId,
              merchantOrderNo,
              bizType: 'VIP_PACKAGE',
              bizMeta,
              itemsSnapshot: itemsSnapshot as any,
              addressSnapshot: encryptedAddressSnapshot as any,
              paymentChannel: paymentChannel as any,
              expectedTotal: vipPrice,
              goodsAmount: vipPrice,
              shippingFee: 0,
              discountAmount: 0,
              deductionGroupId: null,
              idempotencyKey: dto.idempotencyKey || null,
              buyerNote: dto.buyerNote || null,
              expiresAt,
            } as any,
          });

          // 逐项预留库存（CAS 模式，防止超卖）
          for (const giftItem of giftOption.items) {
            const reserveResult = await tx.productSKU.updateMany({
              where: {
                id: giftItem.sku.id,
                status: 'ACTIVE',
                stock: { gte: giftItem.quantity },
              },
              data: { stock: { decrement: giftItem.quantity } },
            });
            if (reserveResult.count === 0) {
              throw new BadRequestException(`赠品「${giftItem.sku.title}」库存不足`);
            }

            await tx.inventoryLedger.create({
              data: {
                skuId: giftItem.sku.id,
                type: 'RESERVE',
                qty: -giftItem.quantity,
                refType: 'CHECKOUT_SESSION',
                refId: txSession.id,
              },
            });
          }

          return txSession;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        break; // 成功跳出重试循环
      } catch (err: any) {
        vipLastErr = err;
        // P2034 序列化冲突 → 指数退避重试
        if (err?.code === 'P2034' && attempt < VIP_MAX_RETRIES - 1) {
          this.logger.warn(
            `VIP checkout createSession 序列化冲突，第 ${attempt + 1}/${VIP_MAX_RETRIES} 次重试`,
          );
          await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
          continue;
        }
        throw err; // 非 P2034 或重试用尽
      }
    }
    if (!vipSession) {
      throw vipLastErr ?? new BadRequestException('VIP 结算创建失败，请重试');
    }
    const session = vipSession;

    this.logger.log(
      `VIP 礼包 CheckoutSession 已创建：sessionId=${session.id}, userId=${userId}, giftOption=${giftOption.title}`,
    );

    // 支付宝渠道：生成 APP 支付参数
    let paymentParams: Record<string, any> = {};
    if (paymentChannel === 'ALIPAY' && this.alipayService?.isAvailable() && session.merchantOrderNo) {
      try {
        const orderStr = await this.alipayService.createAppPayOrder({
          merchantOrderNo: session.merchantOrderNo,
          totalAmount: vipPrice,
          subject: `爱买买VIP礼包-${giftOption.title}`,
        });
        paymentParams = { channel: 'alipay', orderStr };
      } catch (err: any) {
        this.logger.error(`VIP 结账生成支付宝参数失败: ${err.message}`);
      }
    } else if (paymentChannel === 'WECHAT_PAY' && this.wechatPayService?.isAvailable() && session.merchantOrderNo) {
      try {
        const wxParams = await this.wechatPayService.createAppOrder({
          outTradeNo: session.merchantOrderNo,
          amount: vipPrice,
          description: `爱买买VIP礼包-${giftOption.title}`,
        });
        paymentParams = { channel: 'wechat', ...wxParams };
      } catch (err: any) {
        this.logger.error(`VIP 结账生成微信支付参数失败: ${err.message}`);
      }
    }

    return {
      sessionId: session.id,
      merchantOrderNo: session.merchantOrderNo,
      expectedTotal: vipPrice,
      goodsAmount: vipPrice,
      shippingFee: 0,
      discountAmount: 0,
      paymentParams,
    };
  }

  /** F1: 取消结算会话，释放预留奖励和红包 */
  async cancelSession(userId: string, sessionId: string) {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('结算会话不存在');
    if (session.userId !== userId) throw new NotFoundException('结算会话不存在');
    if (session.status !== 'ACTIVE') {
      throw new BadRequestException(`当前会话状态 ${session.status} 不允许取消`);
    }

    // 资金安全：取消前先查支付宝，避免误删已付款 session
    // （场景：支付宝侧已 TRADE_SUCCESS 但 notify 还没到，cancel 会让 notify 抵达后被拒绝）
    if (
      session.merchantOrderNo &&
      session.paymentChannel === 'ALIPAY' &&
      this.alipayService?.isAvailable()
    ) {
      let queryResult: { tradeStatus: string } | null = null;
      try {
        queryResult = await this.alipayService.queryOrder(session.merchantOrderNo);
      } catch (err: any) {
        this.logger.warn(
          `cancelSession 查支付宝异常，拒绝取消（让用户稍后重试）：sessionId=${sessionId}, error=${err.message}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }
      if (
        queryResult &&
        (queryResult.tradeStatus === 'TRADE_SUCCESS' ||
          queryResult.tradeStatus === 'TRADE_FINISHED')
      ) {
        // 资金安全：用户取消时检测到已支付 — 主动建单完成支付流程，不能直接拒绝
        // （场景：notify 永久丢失或大延迟，session 永远 ACTIVE 无法变 PAID）
        this.logger.warn(
          `cancelSession 检测到已支付，主动建单：sessionId=${sessionId}, tradeStatus=${queryResult.tradeStatus}`,
        );
        try {
          // 金额校验：支付宝返回 totalAmount 必须等于 session.expectedTotal（防恶意篡改）
          const claimedAmount = (queryResult as any).totalAmount;
          if (claimedAmount && claimedAmount !== session.expectedTotal.toFixed(2)) {
            this.logger.error(
              `cancelSession 主动建单金额校验失败：alipay=${claimedAmount} session=${session.expectedTotal.toFixed(2)} sessionId=${sessionId}`,
            );
            throw new BadRequestException('支付金额校验失败，请联系客服');
          }
          const buildResult = await this.handlePaymentSuccess(
            session.merchantOrderNo,
            (queryResult as any).tradeNo,
            new Date().toISOString(),
          );
          // 主动建单成功后通知商家（fire-and-forget，不影响主流程）
          if (buildResult?.orderIds?.length > 0) {
            void this.notifyMerchantsAfterCheckoutBuild(buildResult.orderIds, 'cancel-paid');
          }
          throw new BadRequestException('支付已完成，订单已自动创建，请稍后查看订单');
        } catch (e: any) {
          if (e instanceof BadRequestException) throw e;
          this.logger.error(
            `cancelSession 主动建单失败，sessionId=${sessionId}：${e.message}`,
          );
          throw new BadRequestException('正在确认支付状态，请稍后再试');
        }
      }
      // 其他状态（TRADE_CLOSED / WAIT_BUYER_PAY / 未查到）— 调 alipay.trade.close 关闭支付宝交易，
      // 防止"先 query 拿到 WAIT_BUYER_PAY → 用户立刻付款 → 我们改 EXPIRED"竞态
      try {
        const closeResult = await this.alipayService.closeOrder(session.merchantOrderNo);
        if (closeResult?.alreadyPaid) {
          // close 时支付宝告知已支付 — 重新查询并主动建单
          let queryAfterClose: { tradeStatus: string; tradeNo: string; totalAmount: string } | null = null;
          try {
            queryAfterClose = await this.alipayService.queryOrder(session.merchantOrderNo);
          } catch {
            throw new BadRequestException('支付状态异常，请稍后再试');
          }
          if (
            queryAfterClose &&
            (queryAfterClose.tradeStatus === 'TRADE_SUCCESS' ||
              queryAfterClose.tradeStatus === 'TRADE_FINISHED')
          ) {
            // 金额校验
            if (
              queryAfterClose.totalAmount &&
              queryAfterClose.totalAmount !== session.expectedTotal.toFixed(2)
            ) {
              this.logger.error(
                `cancelSession close 后金额校验失败：alipay=${queryAfterClose.totalAmount} session=${session.expectedTotal.toFixed(2)} sessionId=${sessionId}`,
              );
              throw new BadRequestException('支付金额校验失败，请联系客服');
            }
            try {
              const closePaidResult = await this.handlePaymentSuccess(
                session.merchantOrderNo,
                queryAfterClose.tradeNo,
                new Date().toISOString(),
              );
              // 主动建单成功后通知商家（fire-and-forget）
              if (closePaidResult?.orderIds?.length > 0) {
                void this.notifyMerchantsAfterCheckoutBuild(closePaidResult.orderIds, 'cancel-close-paid');
              }
            } catch (buildErr: any) {
              this.logger.error(
                `cancelSession close-paid 建单失败，sessionId=${sessionId}：${buildErr.message}`,
              );
            }
            throw new BadRequestException('支付已完成，订单已自动创建，请稍后查看订单');
          }
          throw new BadRequestException('支付状态异常，请稍后再试');
        }
        if (closeResult && closeResult.success === false && !closeResult.terminal) {
          // close 失败（网络/接口异常，非终态）— 不允许 cancel，让用户稍后重试
          this.logger.warn(
            `cancelSession close 失败，拒绝取消：sessionId=${sessionId}`,
          );
          throw new BadRequestException('正在确认支付状态，请稍后再试');
        }
        // close 成功（success: true，含 terminal: true 表示支付宝侧不存在/已关闭）— 继续走 CAS ACTIVE → EXPIRED
      } catch (closeErr: any) {
        if (closeErr instanceof BadRequestException) throw closeErr;
        this.logger.warn(
          `cancelSession close 异常，拒绝取消：sessionId=${sessionId}, error=${closeErr.message}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }
    }

    if (
      session.merchantOrderNo &&
      session.paymentChannel === 'WECHAT_PAY'
    ) {
      if (!this.wechatPayService?.isAvailable()) {
        this.logger.warn(
          `cancelSession 微信支付服务不可用，拒绝取消：sessionId=${sessionId}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }

      let queryResult: any = null;
      try {
        queryResult = await this.wechatPayService.queryOrder(session.merchantOrderNo);
      } catch (err: any) {
        this.logger.warn(
          `cancelSession 查微信异常，拒绝取消：sessionId=${sessionId}, error=${err.message}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }

      if (!queryResult) {
        this.logger.warn(
          `cancelSession 查微信无结果，拒绝取消：sessionId=${sessionId}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }

      if (queryResult?.tradeState === 'SUCCESS') {
        this.logger.warn(
          `cancelSession 检测到微信已支付，主动建单：sessionId=${sessionId}, tradeState=${queryResult.tradeState}`,
        );
        if (!queryResult.transactionId) {
          this.logger.error(`cancelSession 微信成功态缺少交易流水号：sessionId=${sessionId}`);
          throw new BadRequestException('正在确认支付状态，请稍后再试');
        }
        try {
          this.assertWechatAmountMatchesSession(
            queryResult,
            session.expectedTotal,
            'cancelSession 主动建单',
            sessionId,
          );
          const buildResult = await this.handlePaymentSuccess(
            session.merchantOrderNo,
            queryResult.transactionId,
            queryResult.paidAt?.toISOString?.() ?? queryResult.paidAt ?? new Date().toISOString(),
          );
          if (buildResult?.orderIds?.length > 0) {
            void this.notifyMerchantsAfterCheckoutBuild(buildResult.orderIds, 'cancel-paid-wechat');
          }
          throw new BadRequestException('支付已完成，订单已自动创建，请稍后查看订单');
        } catch (e: any) {
          if (e instanceof BadRequestException) throw e;
          this.logger.error(
            `cancelSession 微信主动建单失败，sessionId=${sessionId}：${e.message}`,
          );
          throw new BadRequestException('正在确认支付状态，请稍后再试');
        }
      }

      let closeResult: any;
      try {
        closeResult = await this.wechatPayService.closeOrder(session.merchantOrderNo);
      } catch (closeErr: any) {
        this.logger.warn(
          `cancelSession 微信 close 异常，拒绝取消：sessionId=${sessionId}, error=${closeErr.message}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }

      if (closeResult?.alreadyPaid) {
        let queryAfterClose: any = null;
        try {
          queryAfterClose = await this.wechatPayService.queryOrder(session.merchantOrderNo);
        } catch {
          throw new BadRequestException('支付状态异常，请稍后再试');
        }
        if (queryAfterClose?.tradeState === 'SUCCESS') {
          if (!queryAfterClose.transactionId) {
            this.logger.error(`cancelSession 微信 close-paid 成功态缺少交易流水号：sessionId=${sessionId}`);
            throw new BadRequestException('正在确认支付状态，请稍后再试');
          }
          try {
            this.assertWechatAmountMatchesSession(
              queryAfterClose,
              session.expectedTotal,
              'cancelSession close-paid',
              sessionId,
            );
            const closePaidResult = await this.handlePaymentSuccess(
              session.merchantOrderNo,
              queryAfterClose.transactionId,
              queryAfterClose.paidAt?.toISOString?.() ?? queryAfterClose.paidAt ?? new Date().toISOString(),
            );
            if (closePaidResult?.orderIds?.length > 0) {
              void this.notifyMerchantsAfterCheckoutBuild(closePaidResult.orderIds, 'cancel-close-paid-wechat');
            }
          } catch (buildErr: any) {
            if (buildErr instanceof BadRequestException) throw buildErr;
            this.logger.error(
              `cancelSession 微信 close-paid 建单失败，sessionId=${sessionId}：${buildErr.message}`,
            );
            throw new BadRequestException('正在确认支付状态，请稍后再试');
          }
          throw new BadRequestException('支付已完成，订单已自动创建，请稍后查看订单');
        }
        throw new BadRequestException('支付状态异常，请稍后再试');
      }

      if (!closeResult || (closeResult.success === false && !closeResult.terminal)) {
        this.logger.warn(
          `cancelSession 微信 close 失败，拒绝取消：sessionId=${sessionId}`,
        );
        throw new BadRequestException('正在确认支付状态，请稍后再试');
      }
    }

    // H8修复：Serializable 隔离级别 + P2034 重试，防止与 handlePaymentSuccess 竞态
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // CAS: ACTIVE → EXPIRED
          const result = await tx.checkoutSession.updateMany({
            where: { id: sessionId, status: 'ACTIVE' },
            data: { status: 'EXPIRED' },
          });
          if (result.count === 0) {
            throw new BadRequestException('会话状态已变更，无法取消');
          }

          if (session.bizType === 'VIP_PACKAGE') {
            await this.releaseVipReservation(tx, session);
          }

          const deductionGroupId = (session as any).deductionGroupId as string | null | undefined;
          if (deductionGroupId && this.rewardDeductionService) {
            await this.rewardDeductionService.releaseDeduction(tx, deductionGroupId);
          } else if (session.rewardId) {
            // 兼容旧会话：旧模型只存 primary rewardId。
            await tx.rewardLedger.updateMany({
              where: { id: session.rewardId, status: 'RESERVED' },
              data: { status: 'AVAILABLE', refType: null, refId: null },
            });
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        // 事务成功后，释放已锁定的平台红包（在事务外执行，CouponService 有自己的事务）
        if (session.couponInstanceIds && session.couponInstanceIds.length > 0 && this.couponService) {
          try {
            await this.couponService.releaseCoupons(session.couponInstanceIds);
            this.logger.log(
              `已释放 ${session.couponInstanceIds.length} 张平台红包（会话取消）`,
            );
          } catch (couponErr: any) {
            this.logger.error(
              `释放红包失败（会话取消）：${couponErr.message}`,
            );
          }
        }

        break; // 成功则跳出重试循环
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `cancelSession 序列化冲突，第 ${attempt + 1}/${MAX_RETRIES} 次重试`,
          );
          continue;
        }
        throw e;
      }
    }

    this.logger.log(`CheckoutSession ${sessionId} 已取消`);
    return { success: true };
  }

  /**
   * 支付失败/通道异常时释放 CheckoutSession 占用资源。
   *
   * 幂等：只有 ACTIVE 会话会被 CAS 标记为 FAILED；非 ACTIVE 直接返回。
   */
  async releaseSessionOnFailure(merchantOrderNo: string): Promise<void> {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const session = await tx.checkoutSession.findFirst({
            where: { merchantOrderNo },
          });
          if (!session) {
            return { released: false, reason: 'session_not_found', couponInstanceIds: [] as string[] };
          }

          const cas = await tx.checkoutSession.updateMany({
            where: { id: session.id, status: 'ACTIVE' },
            data: { status: 'FAILED' },
          });
          if (cas.count === 0) {
            return { released: false, reason: 'session_not_active', couponInstanceIds: [] as string[] };
          }

          const deductionGroupId = (session as any).deductionGroupId as string | null | undefined;
          if (deductionGroupId && this.rewardDeductionService) {
            await this.rewardDeductionService.releaseDeduction(tx, deductionGroupId);
          } else if (session.rewardId) {
            // 兼容旧会话：Worker B 移除 PaymentService 旧释放逻辑后，这里兜住历史 rewardId。
            await tx.rewardLedger.updateMany({
              where: { id: session.rewardId, status: 'RESERVED' },
              data: { status: 'AVAILABLE', refType: null, refId: null },
            });
          }

          if (session.bizType === 'VIP_PACKAGE') {
            await this.releaseVipReservationInTx(tx, {
              id: session.id,
              bizType: session.bizType,
              itemsSnapshot: session.itemsSnapshot,
            });
          }

          return {
            released: true,
            sessionId: session.id,
            couponInstanceIds: session.couponInstanceIds ?? [],
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        if (result.released && result.couponInstanceIds.length > 0 && this.couponService) {
          await this.couponService.releaseCoupons(result.couponInstanceIds).catch((err: any) => {
            this.logger.error(`释放红包失败（支付失败释放）：sessionId=${result.sessionId}, error=${err.message}`);
          });
        }
        return;
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `releaseSessionOnFailure 序列化冲突，第 ${attempt + 1}/${MAX_RETRIES} 次重试`,
          );
          continue;
        }
        throw err;
      }
    }
  }

  /** F1: 查询结算会话状态（前端轮询） */
  async getSessionStatus(userId: string, sessionId: string) {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: { select: { id: true } } },
    });
    if (!session) throw new NotFoundException('结算会话不存在');
    if (session.userId !== userId) throw new NotFoundException('结算会话不存在');

    return {
      status: session.status,
      orderIds: session.orders.map((o) => o.id),
      expectedTotal: session.expectedTotal,
    };
  }

  /** Task 16: 查询当前用户最新的 ACTIVE CheckoutSession（用于"未完成订单"入口） */
  async getPendingForUser(userId: string) {
    const session = await this.prisma.checkoutSession.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        bizType: { not: 'VIP_PACKAGE' },  // VIP 没有"未完成订单"概念，pending API 不返 VIP session
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return null;
    const items = (session.itemsSnapshot as any[]) || [];
    const first = items[0];
    return {
      sessionId: session.id,
      merchantOrderNo: session.merchantOrderNo,
      expectedTotal: session.expectedTotal,
      goodsAmount: session.goodsAmount,
      shippingFee: session.shippingFee,
      expiresAt: session.expiresAt.toISOString(),
      itemCount: items.reduce((s, i) => s + (i.quantity || 1), 0),
      bizType: session.bizType,
      preview: {
        firstItemImage: first?.productSnapshot?.image || '',
        firstItemTitle: first?.productSnapshot?.title || '',
        extraCount: Math.max(0, items.length - 1),
      },
      items: items.map((i) => ({
        image: i.productSnapshot?.image || '',
        title: i.productSnapshot?.title || '',
        skuTitle: i.productSnapshot?.skuTitle || '',
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    };
  }

  /** Task 17: 续付未完成的 CheckoutSession（重新生成支付参数） */
  async resumeSession(userId: string, sessionId: string) {
    const session = await this.prisma.checkoutSession.findFirst({
      where: { id: sessionId, userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    });
    if (!session) throw new NotFoundException('订单不存在或已过期');
    if (!session.merchantOrderNo) throw new BadRequestException('支付参数缺失');

    let paymentParams: Record<string, any> = {};
    if (session.paymentChannel === 'ALIPAY' && this.alipayService?.isAvailable() && session.merchantOrderNo) {
      try {
        const orderStr = await this.alipayService.createAppPayOrder({
          merchantOrderNo: session.merchantOrderNo,
          totalAmount: session.expectedTotal,
          subject: `爱买买订单-${session.merchantOrderNo}`,
        });
        paymentParams = { channel: 'alipay', orderStr };
      } catch (err: any) {
        this.logger.error(`续付生成支付宝参数失败: ${err.message}`);
        throw new ServiceUnavailableException('支付服务暂不可用，请稍后重试');
      }
    } else if (session.paymentChannel === 'WECHAT_PAY') {
      if (!this.wechatPayService?.isAvailable()) {
        this.logger.error(`续付生成微信支付参数失败: 微信支付服务未启用`);
        throw new ServiceUnavailableException('支付服务暂不可用，请稍后重试');
      }
      try {
        const wxParams = await this.wechatPayService.createAppOrder({
          outTradeNo: session.merchantOrderNo,
          amount: session.expectedTotal,
          description: `爱买买订单-${session.merchantOrderNo}`,
        });
        paymentParams = { channel: 'wechat', ...wxParams };
      } catch (err: any) {
        this.logger.error(`续付生成微信支付参数失败: ${err.message}`);
        throw new ServiceUnavailableException('支付服务暂不可用，请稍后重试');
      }
    }

    return {
      sessionId: session.id,
      merchantOrderNo: session.merchantOrderNo,
      expectedTotal: session.expectedTotal,
      paymentParams,
    };
  }

  /** F1: 查找 CheckoutSession（payment callback 路由用） */
  async findByMerchantOrderNo(merchantOrderNo: string) {
    return this.prisma.checkoutSession.findUnique({
      where: { merchantOrderNo },
    });
  }

  /**
   * F1: 支付成功回调 — 原子创建订单+扣库存+清购物车+消费奖品记录+确认红包使用
   * Serializable 事务 + 指数退避重试
   */
  async handlePaymentSuccess(
    merchantOrderNo: string,
    providerTxnId: string,
    paidAt?: string,
  ): Promise<{ orderIds: string[] }> {
    const maxRetries = 3;

    const execute = async (attempt: number): Promise<{ orderIds: string[] }> => {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            // 1. 查找 CheckoutSession
            const session = await tx.checkoutSession.findUnique({
              where: { merchantOrderNo },
            });
            if (!session) {
              throw new NotFoundException('结算会话不存在');
            }

            // 2. CAS: ACTIVE → PAID
            const casResult = await tx.checkoutSession.updateMany({
              where: { id: session.id, status: 'ACTIVE' },
              data: {
                status: 'PAID',
                providerTxnId,
                paidAt: paidAt ? new Date(paidAt) : new Date(),
              },
            });

            if (casResult.count === 0) {
              // H3修复：重新读取最新状态（初始 session 可能是 stale read）
              const currentSession = await tx.checkoutSession.findUnique({
                where: { id: session.id },
              });
              const currentStatus = currentSession?.status || session.status;
              // 已处理（幂等）：如果已 COMPLETED 或 PAID，返回已创建的订单
              if (currentStatus === 'COMPLETED' || currentStatus === 'PAID') {
                const existingOrders = await tx.order.findMany({
                  where: { checkoutSessionId: session.id },
                  select: { id: true },
                });
                return { orderIds: existingOrders.map((o) => o.id) };
              }
              throw new BadRequestException(
                `结算会话状态 ${currentStatus} 不允许支付`,
              );
            }

            // 3. 解析快照
            const items = session.itemsSnapshot as unknown as SnapshotItem[];
            const addressSnapshot = session.addressSnapshot;
            const sessionBizType = (session as any).bizType || 'NORMAL_GOODS';
            const isVipPackageSession = sessionBizType === 'VIP_PACKAGE';
            if (isVipPackageSession && (session as any).deductionGroupId) {
              throw new InternalServerErrorException('VIP 礼包不应有 deductionGroupId，数据异常');
            }

            // 4. 按 companyId 分组
            const itemsByCompany = new Map<string, SnapshotItem[]>();
            for (const si of items) {
              const key = si.companyId ?? '__NO_COMPANY__';
              if (!itemsByCompany.has(key)) itemsByCompany.set(key, []);
              itemsByCompany.get(key)!.push(si);
            }

            const companyGroups = [...itemsByCompany.entries()]
              .map(([companyId, groupItems]) => ({
                companyId,
                items: groupItems,
                goodsAmount: groupItems.reduce(
                  (sum, i) => sum + i.unitPrice * i.quantity,
                  0,
                ),
              }))
              .sort((a, b) => b.goodsAmount - a.goodsAmount);

            // VIP 礼包支付的是会员资格包，赠品 SKU 价格只用于履约快照，不能反写成订单实付金额。
            if (isVipPackageSession && companyGroups.length > 0) {
              const vipGoodsAmount = Number(session.goodsAmount || session.expectedTotal || 0);
              companyGroups.forEach((group, idx) => {
                group.goodsAmount = idx === 0 ? vipGoodsAmount : 0;
              });
            }

            // 5. 运费按商户金额比例分配到各商户订单
            const totalSessionGoodsAmount = companyGroups.reduce((s, g) => s + g.goodsAmount, 0);
            const groupShippingFees = this.allocateShippingFeeByGoodsAmount(
              companyGroups.map((group) => group.goodsAmount),
              session.shippingFee,
            );

            // 6. 创建订单（含红包抵扣）
            const createdOrderIds: string[] = [];
            const companyOrderIdMap = new Map<string, string>();
            const cartContentHash = createHash('sha256')
              .update(items.map((i) => `${i.skuId}:${i.quantity}`).sort().join('|'))
              .digest('hex')
              .slice(0, 16);

            // VIP折扣金额（从 session 中读取）
            const sessionVipDiscount = (session as any).vipDiscountAmount ?? 0;

            // 红包抵扣金额（从 session 中读取）
            const sessionCouponDiscount = session.totalCouponDiscount ?? 0;
            const rewardDiscountAllocations = this.allocateDiscountByCapacities(
              companyGroups.map((group) => group.goodsAmount),
              session.discountAmount,
            );
            const remainingCapacities = companyGroups.map((group, idx) =>
              Math.max(0, group.goodsAmount - rewardDiscountAllocations[idx]),
            );
            const couponDiscountAllocations = this.allocateDiscountByCapacities(
              remainingCapacities,
              sessionCouponDiscount,
            );

            // VIP折扣按商户商品金额比例分摊
            const vipDiscountAllocations = this.allocateDiscountByCapacities(
              companyGroups.map((group) => group.goodsAmount),
              sessionVipDiscount,
            );

            for (let idx = 0; idx < companyGroups.length; idx++) {
              const group = companyGroups[idx];
              const isPrimary = idx === 0;
              const groupShippingFee = groupShippingFees[idx];
              // 分润奖励 + 平台红包按商户金额分摊
              const groupRewardDiscount = rewardDiscountAllocations[idx] || 0;
              const groupCouponDiscount = couponDiscountAllocations[idx] || 0;
              const groupVipDiscount = vipDiscountAllocations[idx] || 0;
              const groupTotalDiscount = groupRewardDiscount + groupCouponDiscount;
              const groupTotal = isVipPackageSession
                ? (idx === 0 ? Number(session.expectedTotal || group.goodsAmount || 0) : 0)
                : Math.max(
                    0,
                    group.goodsAmount - groupVipDiscount - groupTotalDiscount + groupShippingFee,
                  );
              const idempotencyKey = `cs:${session.id}:${cartContentHash}:${idx}`;

              const order = await tx.order.create({
                data: {
                  userId: session.userId,
                  checkoutSessionId: session.id,
                  status: 'PAID',
                  // 传递业务类型（VIP_PACKAGE / NORMAL_GOODS）
                  bizType: sessionBizType,
                  bizMeta: (session as any).bizMeta || undefined,
                  totalAmount: groupTotal,
                  goodsAmount: group.goodsAmount,
                  shippingFee: groupShippingFee,
                  discountAmount: groupRewardDiscount > 0 ? groupRewardDiscount : 0,
                  vipDiscountAmount: vipDiscountAllocations[idx] || 0,
                  // 平台红包抵扣金额记录到商户订单
                  totalCouponDiscount: groupCouponDiscount > 0 ? groupCouponDiscount : null,
                  idempotencyKey,
                  buyerNote: (session as any).buyerNote ?? null,
                  addressSnapshot: addressSnapshot as any,
                  paidAt: paidAt ? new Date(paidAt) : new Date(),
                  items: {
                    create: group.items.map((oi) => ({
                      skuId: oi.skuId,
                      unitPrice: oi.unitPrice,
                      quantity: oi.quantity,
                      companyId: oi.companyId,
                      productSnapshot: oi.productSnapshot,
                      isPrize: oi.isPrize,
                      prizeType: oi.prizeType || null,
                      prizeRecordId: oi.prizeRecordId || null,
                    })),
                  },
                },
              });

              // 消费积分抵扣关联主订单。新模型按 groupId 关联全部 DEDUCT ledger。
              if (isPrimary && session.discountAmount > 0) {
                const deductionGroupId = (session as any).deductionGroupId as string | null | undefined;
                if (deductionGroupId) {
                  await (tx as any).rewardLedger.updateMany({
                    where: {
                      entryType: 'DEDUCT',
                      meta: { path: ['groupId'], equals: deductionGroupId },
                    },
                    data: { refType: 'ORDER', refId: order.id },
                  });
                } else if (session.rewardId) {
                  await tx.rewardLedger.update({
                    where: { id: session.rewardId },
                    data: { refType: 'ORDER', refId: order.id },
                  });
                }
              }

              // 记录订单状态历史
              await tx.orderStatusHistory.create({
                data: {
                  orderId: order.id,
                  fromStatus: 'PENDING_PAYMENT',
                  toStatus: 'PAID',
                  reason: 'CheckoutSession 支付回调建单',
                  meta: { merchantOrderNo, providerTxnId },
                },
              });

              createdOrderIds.push(order.id);
              companyOrderIdMap.set(group.companyId, order.id);
            }

            if (sessionBizType === 'GROUP_BUY') {
              await this.createGroupBuyRecordsAfterPayment(
                tx,
                session as any,
                createdOrderIds[0],
              );
            }

            // 7. R12 超卖容忍：逐 SKU 扣库存（VIP 礼包会话已预留库存，这里转换预留引用）
            for (const item of items) {
              const companyKey = item.companyId ?? '__NO_COMPANY__';
              const refOrderId = companyOrderIdMap.get(companyKey) ?? createdOrderIds[0];
              if (session.bizType === 'VIP_PACKAGE') {
                const migrated = await tx.inventoryLedger.updateMany({
                  where: {
                    skuId: item.skuId,
                    type: 'RESERVE',
                    qty: -item.quantity,
                    refType: 'CHECKOUT_SESSION',
                    refId: session.id,
                  },
                  data: {
                    refType: 'ORDER',
                    refId: refOrderId,
                  },
                });
                if (migrated.count > 0) {
                  continue;
                }
              }

              const updatedSku = await tx.productSKU.update({
                where: { id: item.skuId },
                data: { stock: { decrement: item.quantity } },
              });
              if (updatedSku.stock < 0) {
                this.logger.warn(
                  `R12 超卖: skuId=${item.skuId}, currentStock=${updatedSku.stock}`,
                );
                // C10修复：超卖通知卖家补货
                if (this.inboxService && item.companyId) {
                  const ownerStaff = await tx.companyStaff.findFirst({
                    where: { companyId: item.companyId, role: 'OWNER', status: 'ACTIVE' },
                    select: { userId: true },
                  });
                  if (ownerStaff) {
                    const sku = await tx.productSKU.findUnique({
                      where: { id: item.skuId },
                      include: { product: { select: { title: true } } },
                    });
                    const skuLabel = sku?.title || sku?.product?.title || item.skuId;
                    // setImmediate 避免阻塞事务
                    const inboxService = this.inboxService;
                    const userId = ownerStaff.userId;
                    const oversoldQty = Math.abs(updatedSku.stock);
                    setImmediate(() => {
                      inboxService.send({
                        userId,
                        category: 'transaction',
                        type: 'stock_shortage',
                        title: '商品超卖补货提醒',
                        content: `商品「${skuLabel}」超卖 ${oversoldQty} 件，当前库存 ${updatedSku.stock}，请尽快补货。`,
                        // 卖家路由不在买家 App 路由表中，省略 target 让消息变为纯信息（不可点击跳转）
                        // 卖家应在卖家后台 web 处理库存，将来可考虑发独立卖家通知渠道
                      }).catch(() => {});
                    });
                  }
                }
              }
              await tx.inventoryLedger.create({
                data: {
                  skuId: item.skuId,
                  type: 'RESERVE',
                  qty: -item.quantity,
                  refType: 'ORDER',
                  refId: refOrderId,
                },
              });
            }

            // 8. 消费积分抵扣：RESERVED → VOIDED
            const deductionGroupId = (session as any).deductionGroupId as string | null | undefined;
            if (deductionGroupId && this.rewardDeductionService) {
              await this.rewardDeductionService.confirmDeduction(tx, deductionGroupId);
            } else if (session.rewardId && session.discountAmount > 0) {
              await tx.rewardLedger.updateMany({
                where: { id: session.rewardId, status: 'RESERVED' },
                data: { status: 'VOIDED' },
              });
            }

            // 9. C3修复：按 cartItemId 精确删除购物车项（避免误删结算后新增的同 SKU 商品）
            const excludedPrizeCleanupItems = this.getExcludedPrizeCleanupItems(session as any);
            const excludedPrizeCartItemIds = excludedPrizeCleanupItems
              .map((item) => item.cartItemId)
              .filter((id): id is string => !!id);
            const excludedPrizeRecordIds = excludedPrizeCleanupItems
              .map((item) => item.prizeRecordId)
              .filter((id): id is string => !!id);
            const allCartItemIds = Array.from(new Set([
              ...items
                .filter((i) => i.cartItemId)
                .map((i) => i.cartItemId as string),
              ...excludedPrizeCartItemIds,
            ]));
            const consumedPrizeRecordIds = Array.from(new Set(
              items
                .filter((i) => i.isPrize && i.prizeRecordId)
                .map((i) => i.prizeRecordId as string),
            ));
            const consumedPrizeRecordIdSet = new Set(consumedPrizeRecordIds);
            const expiredPrizeRecordIds = Array.from(new Set(
              excludedPrizeRecordIds.filter((id) => !consumedPrizeRecordIdSet.has(id)),
            ));
            const cleanupPrizeRecordIds = Array.from(new Set([
              ...consumedPrizeRecordIds,
              ...expiredPrizeRecordIds,
            ]));
            if (allCartItemIds.length > 0 || cleanupPrizeRecordIds.length > 0) {
              const userCart = await tx.cart.findUnique({
                where: { userId: session.userId },
              });
              if (userCart) {
                const deleteConditions: any[] = [];
                if (allCartItemIds.length > 0) {
                  deleteConditions.push({ id: { in: allCartItemIds } });
                }
                if (cleanupPrizeRecordIds.length > 0) {
                  deleteConditions.push({
                    isPrize: true,
                    prizeRecordId: { in: cleanupPrizeRecordIds },
                  });
                }
                await tx.cartItem.deleteMany({
                  where: {
                    cartId: userCart.id,
                    OR: deleteConditions,
                  },
                });
              }
            }

            // 10. 消费 LotteryRecord（IN_CART → CONSUMED）
            if (consumedPrizeRecordIds.length > 0) {
              await tx.lotteryRecord.updateMany({
                where: {
                  id: { in: consumedPrizeRecordIds },
                  status: { in: ['WON', 'IN_CART'] },
                },
                data: { status: 'CONSUMED' },
              });
            }

            if (expiredPrizeRecordIds.length > 0) {
              await tx.lotteryRecord.updateMany({
                where: {
                  id: { in: expiredPrizeRecordIds },
                  status: { in: ['WON', 'IN_CART'] },
                },
                data: { status: 'EXPIRED' },
              });
            }

            // 11. Session → COMPLETED
            await tx.checkoutSession.update({
              where: { id: session.id },
              data: { status: 'COMPLETED' },
            });

            // 12. 收集红包确认数据（事务外执行确认）
            let couponConfirmInfo: {
              couponInstanceIds: string[];
              primaryOrderId: string;
              perCouponAmounts: Array<{ couponInstanceId: string; discountAmount: number }>;
            } | null = null;

            if (
              session.couponInstanceIds &&
              session.couponInstanceIds.length > 0 &&
              sessionCouponDiscount > 0
            ) {
              const storedPerAmounts = Array.isArray(session.couponPerAmounts)
                ? (session.couponPerAmounts as Array<{
                    couponInstanceId: string;
                    discountAmount: number;
                  }>)
                : [];
              const amountMap = new Map(
                storedPerAmounts.map((item) => [
                  item.couponInstanceId,
                  Number(item.discountAmount || 0),
                ]),
              );
              let resolvedPerAmounts = session.couponInstanceIds.map(
                (couponInstanceId: string) => ({
                  couponInstanceId,
                  discountAmount: amountMap.get(couponInstanceId) ?? 0,
                }),
              );

              const resolvedTotal = Number(
                resolvedPerAmounts
                  .reduce((sum, item) => sum + item.discountAmount, 0)
                  .toFixed(2),
              );
              if (resolvedTotal <= 0 && sessionCouponDiscount > 0) {
                // 兼容老会话：没有逐张金额快照时回退为均分 + 尾差补偿
                const base = Number(
                  (sessionCouponDiscount / session.couponInstanceIds.length).toFixed(2),
                );
                let allocated = 0;
                resolvedPerAmounts = session.couponInstanceIds.map(
                  (couponInstanceId: string, index: number) => {
                    const discountAmount =
                      index === session.couponInstanceIds.length - 1
                        ? Number((sessionCouponDiscount - allocated).toFixed(2))
                        : base;
                    allocated = Number((allocated + discountAmount).toFixed(2));
                    return { couponInstanceId, discountAmount };
                  },
                );
              }

              // 防御性兜底：旧会话/脏数据场景下，确保逐张金额总和不超过 session 总红包抵扣
              const normalizedPerAmounts = this.capCouponPerAmounts(
                resolvedPerAmounts,
                session.couponInstanceIds,
                sessionCouponDiscount,
              );
              const normalizedTotal = Number(
                normalizedPerAmounts
                  .reduce((sum, item) => sum + item.discountAmount, 0)
                  .toFixed(2),
              );
              const resolvedTotalAfterFallback = Number(
                resolvedPerAmounts
                  .reduce((sum, item) => sum + item.discountAmount, 0)
                  .toFixed(2),
              );
              if (resolvedTotalAfterFallback - normalizedTotal > 0.01) {
                this.logger.warn(
                  `检测到逐张红包金额异常并已裁剪：sessionId=${session.id}, before=${resolvedTotalAfterFallback}, after=${normalizedTotal}, couponTotal=${sessionCouponDiscount}`,
                );
              }

              couponConfirmInfo = {
                couponInstanceIds: session.couponInstanceIds,
                primaryOrderId: createdOrderIds[0],
                perCouponAmounts: normalizedPerAmounts,
              };
            }

            this.logger.log(
              `CheckoutSession ${session.id} 支付成功，创建 ${createdOrderIds.length} 笔订单` +
              (sessionCouponDiscount > 0 ? `，红包抵扣 ¥${sessionCouponDiscount}` : ''),
            );

            return {
              orderIds: createdOrderIds,
              couponConfirmInfo,
              sessionBizType: (session as any).bizType || 'NORMAL_GOODS',
              sessionBizMeta: (session as any).bizMeta as Record<string, any> | null,
              sessionUserId: session.userId,
              sessionItemsSnapshot: session.itemsSnapshot as any[] | null,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        // 事务成功后：确认红包使用（RESERVED → USED + 创建使用记录）
        // 在事务外执行，CouponService.confirmCouponUsage 有自己的 Serializable 事务
        if (result.couponConfirmInfo && this.couponService) {
          let confirmSucceeded = false;
          for (let confirmAttempt = 1; confirmAttempt <= 3; confirmAttempt++) {
            try {
              await this.couponService.confirmCouponUsage(
                result.couponConfirmInfo.couponInstanceIds,
                result.couponConfirmInfo.primaryOrderId,
                result.couponConfirmInfo.perCouponAmounts,
              );
              this.logger.log(
                `红包确认使用成功：${result.couponConfirmInfo.couponInstanceIds.length} 张，关联订单 ${result.couponConfirmInfo.primaryOrderId}`,
              );
              confirmSucceeded = true;
              break;
            } catch (couponErr: any) {
              const isLastAttempt = confirmAttempt === 3;
              this.logger.error(
                `红包确认使用失败（第 ${confirmAttempt}/3 次）：${couponErr.message}`,
              );
              if (!isLastAttempt) {
                const delay = 200 * Math.pow(2, confirmAttempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
          }
          if (!confirmSucceeded) {
            this.logger.error(
              `红包确认使用最终失败（已保留待补偿）：session 对应订单 ${result.couponConfirmInfo.primaryOrderId}`,
            );
          }
        }

        if (
          result.sessionBizType !== 'VIP_PACKAGE' &&
          this.digitalAssetService &&
          result.orderIds.length > 0
        ) {
          await Promise.all(result.orderIds.map(async (orderId: string) => {
            try {
              await this.digitalAssetService!.recordOrderPaid(orderId);
            } catch (assetErr: any) {
              this.logger.error(
                `数字资产冻结失败（不阻断支付成功）：orderId=${orderId}, error=${assetErr.message}`,
              );
            }
          }));
        }

        // VIP 礼包订单：触发 VIP 激活（在独立 Serializable 事务中，3 次重试）
        if (result.sessionBizType === 'VIP_PACKAGE' && this.bonusService) {
          const bizMeta = result.sessionBizMeta;
          // 校验 bizMeta 完整性
          if (!bizMeta || !bizMeta.vipGiftOptionId || bizMeta.snapshotPrice == null) {
            this.logger.error(
              `VIP 激活失败：bizMeta 不完整，userId=${result.sessionUserId}, orderId=${result.orderIds?.[0]}, bizMeta=${JSON.stringify(bizMeta)}`,
            );
          } else if (result.orderIds.length > 0) {
            let vipActivated = false;
            for (let vipAttempt = 1; vipAttempt <= 3; vipAttempt++) {
              try {
                // 构建多商品赠品快照
                const snapshotItems = result.sessionItemsSnapshot || [];
                const giftItems = snapshotItems.map((snap: any) => ({
                  skuId: snap.skuId,
                  skuTitle: snap.skuTitle,
                  productTitle: snap.title,
                  productImage: snap.image,
                  price: snap.unitPrice,
                  quantity: snap.quantity,
                }));
                const giftSnapshot = {
                  title: bizMeta.giftTitle,
                  coverMode: bizMeta.giftCoverMode,
                  coverUrl: bizMeta.giftCoverUrl,
                  badge: bizMeta.giftBadge,
                  items: giftItems,
                };

                await this.bonusService.activateVipAfterPayment(
                  result.sessionUserId,
                  result.orderIds[0],
                  bizMeta.vipGiftOptionId,
                  bizMeta.snapshotPrice,
                  giftSnapshot,
                  (bizMeta as any)?.vipPackageId,
                  (bizMeta as any)?.referralBonusRate,
                );
                vipActivated = true;
                this.logger.log(
                  `VIP 激活成功：userId=${result.sessionUserId}, orderId=${result.orderIds[0]}`,
                );
                break;
              } catch (vipErr: any) {
                if (vipAttempt < 3) {
                  const delay = 200 * Math.pow(2, vipAttempt - 1);
                  this.logger.warn(
                    `VIP 激活第 ${vipAttempt} 次失败，${delay}ms 后重试：${vipErr.message}`,
                  );
                  await new Promise(r => setTimeout(r, delay));
                }
              }
            }
            if (!vipActivated) {
              this.logger.error(
                `VIP 激活最终失败（3 次重试均失败，待补偿）：userId=${result.sessionUserId}, orderId=${result.orderIds[0]}`,
              );
            }

            // Phase 6：VIP 开通成功通知（异步，不阻塞主流程）
            if (vipActivated && this.inboxService) {
              this.inboxService.send({
                userId: result.sessionUserId,
                category: 'system',
                type: 'vip_activated',
                title: 'VIP 会员开通成功',
                content: `恭喜您成为 VIP 会员！您选择的赠品「${bizMeta.giftTitle}」将随订单发货，请留意物流信息。`,
                target: { route: '/orders/[id]', params: { id: result.orderIds[0] } },
              }).catch((err: any) => {
                this.logger.warn(`VIP 开通通知发送失败：${err.message}`);
              });
            }
          }
        }

        return { orderIds: result.orderIds };
      } catch (error: any) {
        const isSerializationError =
          error.code === 'P2034' ||
          error.message?.includes('could not serialize') ||
          error.message?.includes('40001');
        if (isSerializationError && attempt < maxRetries) {
          const delay = 100 * Math.pow(2, attempt);
          this.logger.warn(
            `handlePaymentSuccess 序列化冲突，第 ${attempt}/${maxRetries} 次重试，等待 ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          return execute(attempt + 1);
        }
        throw error;
      }
    };

    return execute(1);
  }

  // ---------- 私有方法 ----------

  private async createGroupBuyRecordsAfterPayment(
    tx: Prisma.TransactionClient,
    session: {
      id: string;
      userId: string;
      goodsAmount: number;
      shippingFee: number;
      bizMeta?: any;
    },
    orderId: string,
  ) {
    const bizMeta = session.bizMeta;
    if (!bizMeta?.groupBuyActivityId || !Array.isArray(bizMeta.tierSnapshot)) {
      throw new InternalServerErrorException('团购支付会话元数据不完整');
    }

    const ownInstance = await tx.groupBuyInstance.create({
      data: {
        userId: session.userId,
        activityId: bizMeta.groupBuyActivityId,
        initiatorOrderId: orderId,
        status: 'QUALIFICATION_PENDING',
        priceSnapshot: Number(bizMeta.groupBuyPriceSnapshot ?? session.goodsAmount),
        shippingFeeSnapshot: Number(bizMeta.shippingFeeSnapshot ?? session.shippingFee ?? 0),
        freeShippingSnapshot: Boolean(bizMeta.freeShippingSnapshot),
        tierSnapshot: bizMeta.tierSnapshot,
        activitySnapshot: bizMeta,
      },
    });

    if (!bizMeta.groupBuyCodeId || !bizMeta.referredByInstanceId) {
      return;
    }

    const existingReferralCount = await tx.groupBuyReferral.count({
      where: {
        instanceId: bizMeta.referredByInstanceId,
        status: { in: ['CANDIDATE', 'VALID'] },
      },
    });
    if (existingReferralCount >= bizMeta.tierSnapshot.length) {
      throw new BadRequestException('团购推荐码名额已满');
    }

    await tx.groupBuyReferral.create({
      data: {
        instanceId: bizMeta.referredByInstanceId,
        codeId: bizMeta.groupBuyCodeId,
        status: 'CANDIDATE',
        referredUserId: session.userId,
        referredOrderId: orderId,
        referredInstanceId: ownInstance.id,
        candidateSequence: existingReferralCount + 1,
      },
    });
    await tx.groupBuyInstance.update({
      where: { id: bizMeta.referredByInstanceId },
      data: { candidateCount: { increment: 1 } },
    });
  }

  private getExcludedPrizeCleanupItems(session: {
    bizMeta?: unknown;
  }): Array<Pick<ExcludedCheckoutItem, 'cartItemId' | 'skuId' | 'prizeRecordId'>> {
    const meta = session.bizMeta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];

    const rawItems = (meta as any).excludedPrizeItems;
    if (!Array.isArray(rawItems)) return [];

    return rawItems
      .filter((item) => {
        if (!item || typeof item !== 'object') return false;
        if ((item as any).isPrize !== true) return false;
        return typeof (item as any).cartItemId === 'string' ||
          typeof (item as any).prizeRecordId === 'string';
      })
      .map((item) => ({
        cartItemId: typeof item.cartItemId === 'string' ? item.cartItemId : undefined,
        skuId: typeof item.skuId === 'string' ? item.skuId : '',
        prizeRecordId: typeof item.prizeRecordId === 'string' ? item.prizeRecordId : null,
      }));
  }

  /**
   * 按容量（通常为各商户商品金额）分摊折扣，保证：
   * 1) 每组折扣不超过自身容量
   * 2) 总和尽量等于目标折扣（2 位小数）
   */
  private allocateDiscountByCapacities(
    capacities: number[],
    totalDiscount: number,
  ): number[] {
    const toCents = (value: number) =>
      Math.max(0, Math.round((value + Number.EPSILON) * 100));
    const normalizedCaps = capacities.map(toCents);
    const capTotal = normalizedCaps.reduce((sum, value) => sum + value, 0);
    const target = Math.min(
      Math.max(0, toCents(totalDiscount)),
      capTotal,
    );
    if (target <= 0 || normalizedCaps.length === 0) {
      return normalizedCaps.map(() => 0);
    }

    const allocations = normalizedCaps.map(() => 0);
    let remainingDiscount = target;
    let remainingCapTotal = capTotal;

    for (let idx = 0; idx < normalizedCaps.length; idx++) {
      const capacity = normalizedCaps[idx];
      if (remainingDiscount <= 0 || capacity <= 0) continue;

      let share = 0;
      if (idx === normalizedCaps.length - 1 || remainingCapTotal <= 0) {
        share = Math.min(capacity, remainingDiscount);
      } else {
        share = Math.min(
          capacity,
          Math.floor((capacity * remainingDiscount) / remainingCapTotal),
        );
      }

      allocations[idx] = share;
      remainingDiscount -= share;
      remainingCapTotal -= capacity;
    }

    if (remainingDiscount > 0) {
      for (let idx = 0; idx < normalizedCaps.length; idx++) {
        const room = normalizedCaps[idx] - allocations[idx];
        if (room <= 0) continue;
        const extra = Math.min(room, remainingDiscount);
        allocations[idx] += extra;
        remainingDiscount -= extra;
        if (remainingDiscount <= 0) break;
      }
    }

    return allocations.map((value) => value / 100);
  }

  /**
   * 将红包逐张抵扣金额裁剪到有效总抵扣，避免“预留抵扣 > 实际建单抵扣”导致的使用记录失真
   */
  private capCouponPerAmounts(
    perCouponAmounts: Array<{ couponInstanceId: string; discountAmount: number }>,
    couponInstanceIds: string[],
    effectiveTotalDiscount: number,
  ): Array<{ couponInstanceId: string; discountAmount: number }> {
    if (!couponInstanceIds || couponInstanceIds.length === 0) return [];

    const toCents = (value: number) =>
      Math.max(0, Math.round((value + Number.EPSILON) * 100));
    const amountMap = new Map(
      perCouponAmounts.map((item) => [
        item.couponInstanceId,
        toCents(Number(item.discountAmount || 0)),
      ]),
    );

    const source = couponInstanceIds.map((couponInstanceId) => ({
      couponInstanceId,
      amountCents: amountMap.get(couponInstanceId) ?? 0,
    }));
    const sourceTotal = source.reduce((sum, item) => sum + item.amountCents, 0);
    let remaining = Math.min(toCents(effectiveTotalDiscount), sourceTotal);

    const capped = source.map((item) => {
      if (remaining <= 0) {
        return { couponInstanceId: item.couponInstanceId, discountAmount: 0 };
      }
      const amount = Math.min(item.amountCents, remaining);
      remaining -= amount;
      return {
        couponInstanceId: item.couponInstanceId,
        discountAmount: amount / 100,
      };
    });

    return capped;
  }

  private getVipReservationItems(session: {
    bizType?: string | null;
    itemsSnapshot?: unknown;
  }): Array<{ skuId: string; quantity: number }> {
    if (session.bizType !== 'VIP_PACKAGE' || !Array.isArray(session.itemsSnapshot)) {
      return [];
    }

    return (session.itemsSnapshot as Array<Record<string, any>>)
      .map((item) => ({
        skuId: String(item.skuId || ''),
        quantity: Number(item.quantity || 0),
      }))
      .filter((item) => item.skuId && item.quantity > 0);
  }

  /**
   * 公开 wrapper：在已有事务内释放 VIP 礼包预留库存（供 PaymentService 等外部调用）
   *
   * 仅 bizType === 'VIP_PACKAGE' 的 session 会真正释放，其他类型直接返回。
   */
  async releaseVipReservationInTx(
    tx: Prisma.TransactionClient,
    session: { id: string; bizType?: string | null; itemsSnapshot?: unknown },
  ) {
    if (session.bizType !== 'VIP_PACKAGE') return;
    await this.releaseVipReservation(tx, session);
  }

  private async releaseVipReservation(
    tx: Prisma.TransactionClient,
    session: { id: string; bizType?: string | null; itemsSnapshot?: unknown },
  ) {
    const reservationItems = this.getVipReservationItems(session);
    for (const item of reservationItems) {
      const reservedCount = await tx.inventoryLedger.count({
        where: {
          skuId: item.skuId,
          type: 'RESERVE',
          qty: -item.quantity,
          refType: 'CHECKOUT_SESSION',
          refId: session.id,
        },
      });
      if (reservedCount === 0) {
        continue;
      }
      await tx.productSKU.update({
        where: { id: item.skuId },
        data: { stock: { increment: item.quantity } },
      });
      await tx.inventoryLedger.create({
        data: {
          skuId: item.skuId,
          type: 'RELEASE',
          qty: item.quantity,
          refType: 'CHECKOUT_SESSION',
          refId: session.id,
        },
      });
    }
  }

  private normalizeSkuWeightGram(weightGram: unknown): number {
    const normalized = Number(weightGram);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return DEFAULT_SKU_WEIGHT_GRAM;
    }
    return Math.round(normalized);
  }

  private allocateShippingFeeByGoodsAmount(
    goodsAmounts: number[],
    totalShippingFee: number,
  ): number[] {
    const totalFeeCents = Math.max(
      0,
      Math.round((Number(totalShippingFee || 0) + Number.EPSILON) * 100),
    );
    if (goodsAmounts.length === 0) return [];
    if (totalFeeCents === 0) return goodsAmounts.map(() => 0);

    const weights = goodsAmounts.map((amount) =>
      Math.max(0, Math.round((Number(amount || 0) + Number.EPSILON) * 100)),
    );
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight === 0) {
      const allocations = goodsAmounts.map(() => 0);
      allocations[allocations.length - 1] = totalFeeCents / 100;
      return allocations;
    }

    const allocations: number[] = [];
    let allocatedCents = 0;
    for (let idx = 0; idx < weights.length; idx++) {
      const remainingCents = totalFeeCents - allocatedCents;
      if (idx === weights.length - 1) {
        allocations.push(remainingCents / 100);
        break;
      }
      const cents = Math.min(
        remainingCents,
        Math.round((weights[idx] / totalWeight) * totalFeeCents),
      );
      allocations.push(cents / 100);
      allocatedCents += cents;
    }
    return allocations;
  }

  private async calculateShippingDetailForCheckout(
    goodsAmount: number,
    regionCode?: string,
    totalWeight?: number,
    isVip?: boolean,
    tx?: any,
  ): Promise<{ fee: number }> {
    const sysConfig = await this.bonusConfig.getSystemConfig();
    const threshold = isVip
      ? sysConfig.vipFreeShippingThreshold
      : sysConfig.normalFreeShippingThreshold;

    // 门槛为 0 表示无条件免运费；订单金额达到门槛也免运费，不触发规则引擎。
    if (threshold === 0 || goodsAmount >= threshold) {
      return { fee: 0 };
    }

    if (this.shippingRuleService?.calculateShippingDetail) {
      try {
        const detail = await this.shippingRuleService.calculateShippingDetail(
          goodsAmount,
          regionCode,
          totalWeight,
          tx,
        );
        const fee = Number(detail?.fee);
        if (Number.isFinite(fee) && fee >= 0) {
          return { fee };
        }
        throw new Error('calculateShippingDetail returned invalid fee');
      } catch (err: any) {
        this.logger.warn(`ShippingRule 详情计算失败，降级为默认逻辑: ${err.message}`);
      }
    }

    return { fee: sysConfig.defaultShippingFee ?? DEFAULT_BASE_FEE };
  }

  /** 运费计算：平台统一发货，用整单总金额和总重量计算一次，支持 VIP 免运费门槛 */
  private async calculateShippingFee(
    _companyId: string,
    goodsAmount: number,
    tx?: any,
    regionCode?: string,
    totalWeight?: number,
    isVip?: boolean,
  ): Promise<number> {
    const detail = await this.calculateShippingDetailForCheckout(
      goodsAmount,
      regionCode,
      totalWeight,
      isVip,
      tx,
    );
    return detail.fee;
  }

  /**
   * cancel/expire 主动建单成功后的统一后处理：通知商家、记日志。
   * 不抛错（fire-and-forget），但失败必记 error 日志方便后续排查。
   *
   * @param orderIds 已建单的订单 ID 列表
   * @param context  调用语境（'cancel-paid' | 'cancel-close-paid' | 'expire-paid' | 'expire-close-paid'），仅用于日志
   */
  private async notifyMerchantsAfterCheckoutBuild(
    orderIds: string[],
    context: string,
  ): Promise<void> {
    if (orderIds.length === 0) return;
    if (!this.paymentService) {
      this.logger.warn(
        `[${context}] 商家通知跳过：paymentService 未注入，orderIds=${orderIds.join(',')}`,
      );
      return;
    }
    try {
      await this.paymentService.notifyMerchantsForOrders(orderIds);
      this.logger.log(
        `[${context}] 商家通知成功：orderIds=${orderIds.join(',')}`,
      );
    } catch (err: any) {
      // 主动建单已经成功，商家通知失败不影响订单状态 — 只记 error 日志
      this.logger.error(
        `[${context}] 商家通知失败（不影响订单）：orderIds=${orderIds.join(',')}, error=${err.message}, stack=${err.stack}`,
      );
    }
  }
}
