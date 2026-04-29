import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusConfigService } from '../bonus/engine/bonus-config.service';
import { CheckoutDto } from './checkout.dto';
import { VipCheckoutDto } from './vip-checkout.dto';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { PLATFORM_COMPANY_ID } from '../bonus/engine/constants';
import { encryptJsonValue } from '../../common/security/encryption';
import { parseChineseAddress } from '../../common/utils/parse-region';

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

  // ---------- 公开方法 ----------

  /** F1: 创建 CheckoutSession（校验库存+计算总额+预留奖励+返回支付参数） */
  async checkout(userId: string, dto: CheckoutDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('购物车为空，请先添加商品');
    }

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
        paymentParams,
      };
    };

    // 幂等检查
    if (dto.idempotencyKey) {
      const existing = await this.prisma.checkoutSession.findFirst({
        where: {
          userId,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      if (existing) {
        return await toCheckoutResponse(existing);
      }
    }

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
      if (sku.status !== 'ACTIVE') throw new BadRequestException(`商品规格 ${sku.title} 已下架`);
      if (sku.product.status !== 'ACTIVE') throw new BadRequestException(`商品 ${sku.product.title} 已下架`);
      // 库存读检查（不扣减），允许低库存通过（R12 超卖容忍由支付回调处理）
      if (sku.stock <= 0) {
        this.logger.warn(`R12: SKU ${sku.id} 库存已为 ${sku.stock}，允许继续结算（超卖容忍）`);
      }

      // 单笔限购校验
      if (sku.maxPerOrder !== null && item.quantity > sku.maxPerOrder) {
        throw new BadRequestException(
          `商品规格「${sku.title}」每单限购 ${sku.maxPerOrder} 件`,
        );
      }

      const resolvedSkuId = (item as any)._resolvedSkuId || sku.id;

      // 匹配奖品购物车项
      let prizeCartItem: (typeof cartPrizeItems)[0] | null = null;
      if (item.cartItemId && cartItemById.has(item.cartItemId)) {
        const candidate = cartItemById.get(item.cartItemId)!;
        if (candidate.isPrize && !matchedPrizeCartItemIds.has(candidate.id)) {
          prizeCartItem = candidate;
          matchedPrizeCartItemIds.add(candidate.id);
        }
      }
      if (!prizeCartItem && cartPrizeBySkuId.has(item.skuId)) {
        const candidates = cartPrizeBySkuId.get(item.skuId)!;
        for (const c of candidates) {
          if (!matchedPrizeCartItemIds.has(c.id)) {
            prizeCartItem = c;
            matchedPrizeCartItemIds.add(c.id);
            break;
          }
        }
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
          });
          if (lotteryRecord) {
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
      const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
      if (address && address.userId === userId) {
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
      skuWeightMap.set(id, (sku as any).weightGram ?? 0);
      skuWeightMap.set(sku.id, (sku as any).weightGram ?? 0);
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
    const totalShippingFee = await this.calculateShippingFee(
      '__PLATFORM__',
      totalGoodsForShipping,
      undefined,
      regionCode,
      totalWeightForShipping,
      isVip,
    );
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

    // 预留奖励前的只读校验（在事务外执行，减少事务持有时间）
    let rewardLedger: any = null;

    if (dto.rewardId) {
      // 先读取奖励信息进行校验（只读，不修改状态）
      const ledger = await this.prisma.rewardLedger.findUnique({
        where: { id: dto.rewardId },
      });
      if (!ledger) {
        throw new BadRequestException('奖励不存在');
      }
      if (ledger.userId !== userId) {
        throw new BadRequestException('奖励不属于当前用户');
      }
      if (ledger.status !== 'AVAILABLE') {
        throw new BadRequestException('奖励已被使用');
      }

      // 最低消费检查（CAS 之前验证，避免预留后再回滚）
      const minOrderAmount = ledger.amount >= 10 ? ledger.amount * 5 : 0;
      if (minOrderAmount > 0 && totalGoodsAmount < minOrderAmount) {
        throw new BadRequestException(
          `订单金额不满足奖励使用条件（最低 ¥${minOrderAmount}）`,
        );
      }

      rewardLedger = ledger;
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
          // 奖励 CAS 预留（在事务内执行，回滚时自动恢复）
          let discountAmount = 0;
          let reservedRewardId: string | null = null;

          if (dto.rewardId && rewardLedger) {
            const updated = await tx.rewardLedger.updateMany({
              where: {
                id: dto.rewardId,
                userId,
                status: 'AVAILABLE',
                entryType: 'RELEASE',
                refId: null,
              },
              data: { status: 'RESERVED' },
            });

            if (updated.count > 0) {
              discountAmount = rewardLedger.amount;
              reservedRewardId = dto.rewardId;
            } else {
              // CAS 失败：在校验和 CAS 之间状态已变化（并发竞争）
              throw new BadRequestException('奖励已被使用（请重试）');
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
            if (diff > 0.01) {
              // 直接抛异常，事务回滚会自动释放奖励预留
              throw new BadRequestException(
                `价格已变更：预期 ¥${dto.expectedTotal.toFixed(2)}，实际 ¥${expectedTotal.toFixed(2)}。请刷新后重新结算`,
              );
            }
          }

          // 创建 CheckoutSession（含平台红包信息）
          const created = await tx.checkoutSession.create({
            data: {
              userId,
              status: 'ACTIVE',
              itemsSnapshot: snapshotItems as any,
              addressSnapshot: encryptedAddressSnapshot as any,
              rewardId: reservedRewardId && discountAmount > 0 ? reservedRewardId : null,
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
              expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 分钟过期
            },
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
        // P2002 唯一约束冲突（幂等键重复）
        if (err?.code === 'P2002' && dto.idempotencyKey) {
          const existing = await this.prisma.checkoutSession.findFirst({
            where: { userId, idempotencyKey: dto.idempotencyKey },
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
      where: { id: dto.addressId },
    });
    if (!address || address.userId !== userId) {
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
    const itemsSnapshot: Array<{
      skuId: string;
      productId: string;
      title: string;
      skuTitle: string;
      image: string | null;
      unitPrice: number;
      quantity: number;
      isPrize: boolean;
      companyId: string;
    }> = giftOption.items.map((giftItem) => ({
      skuId: giftItem.sku.id,
      productId: giftItem.sku.product?.id || '',
      title: giftItem.sku.product?.title || '',
      skuTitle: giftItem.sku.title,
      image: giftItem.sku.product?.media?.[0]?.url ?? null,
      unitPrice: giftItem.sku.price,
      quantity: giftItem.quantity,
      isPrize: false,
      companyId: PLATFORM_COMPANY_ID,
    }));

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
    const session = await this.prisma.$transaction(async (tx) => {
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

      // 校验无活跃 VIP 会话（原子保证不会并发创建）
      const activeVipSession = await tx.checkoutSession.findFirst({
        where: {
          userId,
          bizType: 'VIP_PACKAGE',
          status: 'ACTIVE',
        },
      });
      if (activeVipSession) {
        throw new BadRequestException('您有一个进行中的 VIP 购买会话，请完成支付或等待超时');
      }

      // 商户订单号
      const merchantOrderNo = `VIP${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      // VIP 会话过期时间（30 分钟）
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      const session = await tx.checkoutSession.create({
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
          idempotencyKey: dto.idempotencyKey || null,
          expiresAt,
        },
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
            refId: session.id,
          },
        });
      }

      return session;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

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

          // 释放预留奖励
          if (session.rewardId) {
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

            // 5. 运费按商户金额比例分配到各商户订单
            const totalSessionGoodsAmount = companyGroups.reduce((s, g) => s + g.goodsAmount, 0);
            const groupShippingFees: number[] = companyGroups.map((group) => {
              if (totalSessionGoodsAmount === 0) return 0;
              return parseFloat(
                ((group.goodsAmount / totalSessionGoodsAmount) * session.shippingFee).toFixed(2),
              );
            });

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
              const groupTotal = Math.max(
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
                  bizType: (session as any).bizType || 'NORMAL_GOODS',
                  bizMeta: (session as any).bizMeta || undefined,
                  totalAmount: groupTotal,
                  goodsAmount: group.goodsAmount,
                  shippingFee: groupShippingFee,
                  discountAmount: groupRewardDiscount > 0 ? groupRewardDiscount : 0,
                  vipDiscountAmount: vipDiscountAllocations[idx] || 0,
                  // 平台红包抵扣金额记录到商户订单
                  totalCouponDiscount: groupCouponDiscount > 0 ? groupCouponDiscount : null,
                  idempotencyKey,
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

              // 奖励关联主订单
              if (isPrimary && session.rewardId && session.discountAmount > 0) {
                await tx.rewardLedger.update({
                  where: { id: session.rewardId },
                  data: { refType: 'ORDER', refId: order.id },
                });
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

            // 8. 奖励：RESERVED → VOIDED
            if (session.rewardId && session.discountAmount > 0) {
              await tx.rewardLedger.updateMany({
                where: { id: session.rewardId, status: 'RESERVED' },
                data: { status: 'VOIDED' },
              });
            }

            // 9. C3修复：按 cartItemId 精确删除购物车项（避免误删结算后新增的同 SKU 商品）
            const allCartItemIds = items
              .filter((i) => i.cartItemId)
              .map((i) => i.cartItemId as string);
            if (allCartItemIds.length > 0) {
              const userCart = await tx.cart.findUnique({
                where: { userId: session.userId },
              });
              if (userCart) {
                await tx.cartItem.deleteMany({
                  where: { id: { in: allCartItemIds }, cartId: userCart.id },
                });
              }
            }

            // 10. 消费 LotteryRecord（IN_CART → CONSUMED）
            const prizeRecordIds = items
              .filter((i) => i.isPrize && i.prizeRecordId)
              .map((i) => i.prizeRecordId as string);
            if (prizeRecordIds.length > 0) {
              await tx.lotteryRecord.updateMany({
                where: {
                  id: { in: prizeRecordIds },
                  status: { in: ['WON', 'IN_CART'] },
                },
                data: { status: 'CONSUMED' },
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

  /** 运费计算：平台统一发货，用整单总金额和总重量计算一次，支持 VIP 免运费门槛 */
  private async calculateShippingFee(
    _companyId: string,
    goodsAmount: number,
    tx?: any,
    regionCode?: string,
    totalWeight?: number,
    isVip?: boolean,
  ): Promise<number> {
    // 读取可配置的免运费门槛
    const sysConfig = await this.bonusConfig.getSystemConfig();
    const threshold = isVip
      ? sysConfig.vipFreeShippingThreshold
      : sysConfig.normalFreeShippingThreshold;

    // 门槛为 0 表示无条件免运费；订单金额达到门槛也免运费
    if (threshold === 0 || goodsAmount >= threshold) {
      return 0;
    }

    // 通过 ShippingRule 匹配运费
    if (this.shippingRuleService) {
      try {
        return await this.shippingRuleService.calculateShippingFee(
          goodsAmount,
          regionCode,
          totalWeight,
          tx,
        );
      } catch (err: any) {
        this.logger.warn(`ShippingRule 计算失败，降级为默认逻辑: ${err.message}`);
      }
    }

    // 降级：使用配置的默认运费
    return sysConfig.defaultShippingFee ?? DEFAULT_BASE_FEE;
  }
}
