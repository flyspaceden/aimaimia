import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusAllocationService } from '../bonus/engine/bonus-allocation.service';
import { BonusConfigService } from '../bonus/engine/bonus-config.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { sanitizeErrorForLog, sanitizeForLog } from '../../common/logging/log-sanitizer';
import { DEAD_LETTER_REASON } from '../bonus/engine/constants';
import {
  maskAddressSnapshot,
  maskTrackingNo,
} from '../../common/security/privacy-mask';
import { decryptJsonValue } from '../../common/security/encryption';
import { ACTIVE_STATUSES } from '../after-sale/after-sale.constants';
import { getConfigValue } from '../after-sale/after-sale.utils';

// 后端枚举 → 前端状态映射
const STATUS_MAP: Record<string, string> = {
  PENDING_PAYMENT: 'pendingPay',
  PAID: 'pendingShip',
  SHIPPED: 'shipping',
  DELIVERED: 'delivered',
  RECEIVED: 'completed',
  CANCELED: 'canceled',
  REFUNDED: 'afterSale',
};
const REPLACEMENT_REASON_LABELS: Record<string, string> = {
  QUALITY_ISSUE: '质量问题',
  WRONG_ITEM: '发错商品',
  DAMAGED: '运输损坏',
  NOT_AS_DESCRIBED: '与描述不符',
  SIZE_ISSUE: '规格不符',
  EXPIRED: '临期/过期',
  OTHER: '其他',
};

// 前端状态 → 后端枚举反向映射
const REVERSE_STATUS_MAP: Record<string, string> = {
  pendingPay: 'PENDING_PAYMENT',
  pendingShip: 'PAID',
  shipping: 'SHIPPED',
  delivered: 'DELIVERED',
  completed: 'RECEIVED',
  canceled: 'CANCELED',
  afterSale: 'REFUNDED',
};

// S20修复：默认运费规则（ShippingRule 无匹配时的 fallback，已迁移到 ShippingRuleService）
const DEFAULT_FREE_THRESHOLD = 99; // 满 99 免运费（兜底值，仅 ShippingRuleService 不可用时使用）
const DEFAULT_BASE_FEE = 8;        // 基础运费 8 元

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  // ShippingRuleService 通过可选注入（避免循环依赖），无注入时降级为旧逻辑
  private shippingRuleService: any = null;
  // CouponService 通过 setter 注入（由 OrderModule.onModuleInit 调用）
  private couponService: any = null;
  // CouponEngineService 通过 setter 注入（由 OrderModule.onModuleInit 调用）
  private couponEngineService: any = null;

  constructor(
    private prisma: PrismaService,
    private bonusAllocation: BonusAllocationService,
    private bonusConfig: BonusConfigService,
  ) {}

  /** 注入运费规则服务（由 OrderModule 在 onModuleInit 时调用） */
  setShippingRuleService(service: any) {
    this.shippingRuleService = service;
  }

  /** 注入红包服务（用于 preview 估算优惠券折扣） */
  setCouponService(service: any) {
    this.couponService = service;
  }

  /** 注入红包引擎服务（由 OrderModule 在 onModuleInit 时调用） */
  setCouponEngineService(service: any) {
    this.couponEngineService = service;
  }

  private summarizeShipments(
    shipments?: Array<{
      id: string;
      companyId?: string | null;
      carrierCode?: string | null;
      carrierName?: string | null;
      trackingNo?: string | null;
      status?: string | null;
      shippedAt?: Date | null;
      deliveredAt?: Date | null;
      trackingEvents?: Array<{ occurredAt?: Date | null; message?: string | null; location?: string | null }>;
    }>,
  ) {
    const normalized = (shipments || []).map((shipment) => ({
      id: shipment.id,
      companyId: shipment.companyId || null,
      carrierCode: shipment.carrierCode || '',
      carrierName: shipment.carrierName || '',
      trackingNo: shipment.trackingNo || null,
      trackingNoMasked: maskTrackingNo(shipment.trackingNo || null),
      status: shipment.status || 'INIT',
      shippedAt: shipment.shippedAt?.toISOString() || null,
      deliveredAt: shipment.deliveredAt?.toISOString() || null,
      trackingEvents: (shipment.trackingEvents || []).map((event) => ({
        time: event.occurredAt?.toISOString() || '',
        message: event.message || '',
        location: event.location || undefined,
      })),
    }));

    if (normalized.length === 0) {
      return {
        logisticsStatus: null,
        trackingNo: null,
        trackingNoMasked: null,
        trackingEvents: [],
        shipments: [],
      };
    }

    const statuses = normalized.map((shipment) => shipment.status);
    const logisticsStatus = statuses.every((status) => status === 'DELIVERED')
      ? 'DELIVERED'
      : statuses.some((status) => status === 'IN_TRANSIT' || status === 'SHIPPED')
        ? 'IN_TRANSIT'
        : statuses[0];
    const trackingEvents = normalized
      .flatMap((shipment) =>
        shipment.trackingEvents.map((event) => ({
          ...event,
          shipmentId: shipment.id,
          carrierName: shipment.carrierName,
          trackingNo: shipment.trackingNoMasked || shipment.trackingNo || undefined,
        })),
      )
      .sort((a, b) => b.time.localeCompare(a.time));
    const primary = normalized[0];

    return {
      logisticsStatus,
      trackingNo: normalized.length === 1 ? primary.trackingNo : null,
      trackingNoMasked: normalized.length === 1 ? primary.trackingNoMasked : null,
      trackingEvents,
      shipments: normalized,
    };
  }

  /**
   * 运费计算：优先使用平台统一运费规则（ShippingRule），降级为旧 ShippingTemplate 逻辑
   */
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

    // 优先使用平台统一运费规则
    if (this.shippingRuleService) {
      try {
        return await this.shippingRuleService.calculateShippingFee(
          goodsAmount, regionCode, totalWeight, tx,
        );
      } catch (err: any) {
        this.logger.warn(`ShippingRule 计算失败，降级为默认逻辑: ${err.message}`);
      }
    }

    // 降级：使用配置的默认运费
    return sysConfig.defaultShippingFee ?? DEFAULT_BASE_FEE;
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

  /** 订单列表（可按状态筛选，支持分页） */
  async list(userId: string, status?: string, page = 1, pageSize = 20) {
    const where: any = { userId };
    if (status) {
      if (status === 'afterSale') {
        // afterSale 列表 = 活跃售后订单 + 历史已退款订单
        where.OR = [
          { status: 'REFUNDED' },
          {
            afterSaleRequests: {
              some: { status: { in: [...ACTIVE_STATUSES] } },
            },
          },
        ];
      } else if (status === 'shipping') {
        // 买家”待收货”统一口径：运输中 + 已送达未确认
        where.status = { in: ['SHIPPED', 'DELIVERED'] };
        // 待收货列表排除售后进行中的订单，避免与 afterSale 口径冲突
        where.AND = [
          {
            afterSaleRequests: {
              none: { status: { in: [...ACTIVE_STATUSES] } },
            },
          },
        ];
      } else {
        const enumStatus = REVERSE_STATUS_MAP[status] || status;
        where.status = enumStatus;
      }
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          shipments: { select: { status: true, trackingNo: true } },
          afterSaleRequests: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, reason: true, afterSaleType: true, reasonType: true },
          },
          refunds: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, reason: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: orders.map((o) => this.mapOrder(o)),
      total,
      page,
      pageSize,
    };
  }

  /** 各状态订单数量（包含售后中订单计入 afterSale） */
  async getStatusCounts(userId: string) {
    // 单次查询包含售后请求信息，避免竞态
    const orders = await this.prisma.order.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        afterSaleRequests: {
          where: { status: { in: [...ACTIVE_STATUSES] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    const counts: Record<string, number> = {
      pendingPay: 0,
      pendingShip: 0,
      shipping: 0,
      delivered: 0,
      afterSale: 0,
      completed: 0,
      canceled: 0,
    };
    orders.forEach((o: any) => {
      // 有活跃售后请求的订单计入 afterSale
      if (o.afterSaleRequests.length > 0) {
        counts.afterSale++;
      } else {
        const frontStatus = STATUS_MAP[o.status] || o.status;
        counts[frontStatus] = (counts[frontStatus] ?? 0) + 1;
      }
    });

    return counts;
  }

  /** 最近异常订单（售后 + 退款 + 旧换货） */
  async getLatestIssue(userId: string) {
    // 查找最近售后记录（统一售后系统）
    const latestAfterSale = await this.prisma.afterSaleRequest.findFirst({
      where: {
        userId,
        status: { in: [...ACTIVE_STATUSES, 'REFUNDED', 'COMPLETED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          include: {
            items: true,
            afterSaleRequests: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true, reason: true, afterSaleType: true, reasonType: true },
            },
            refunds: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true, reason: true },
            },
          },
        },
      },
    });

    // 查找最近退款记录（兼容历史数据）
    const latestRefund = await this.prisma.refund.findFirst({
      where: {
        order: { userId, status: 'REFUNDED' },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          include: {
            items: true,
            afterSaleRequests: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true, reason: true, afterSaleType: true, reasonType: true },
            },
            refunds: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true, reason: true },
            },
          },
        },
      },
    });

    // 从所有来源中选取最近的一个
    type IssueCandidate = { createdAt: Date; order: any };
    const candidates: IssueCandidate[] = [];
    if (latestAfterSale?.order) candidates.push({ createdAt: latestAfterSale.createdAt, order: latestAfterSale.order });
    if (latestRefund?.order) candidates.push({ createdAt: latestRefund.createdAt, order: latestRefund.order });

    if (candidates.length === 0) return null;

    // 按时间降序排列，返回最新的
    candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return this.mapOrder(candidates[0].order);
  }

  /** 订单详情 */
  async getById(id: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        refunds: { orderBy: { createdAt: 'desc' }, take: 1 },
        afterSaleRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
        shipments: { include: { trackingEvents: { orderBy: { occurredAt: 'desc' } } }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) throw new NotFoundException('订单未找到');
    if (order.userId !== userId) throw new NotFoundException('订单未找到');

    return this.mapOrderDetail(order);
  }

  /** N09修复：预结算接口 — 返回服务端计算的分组、运费、奖励、合计，不扣库存不创建订单 */
  async previewOrder(userId: string, dto: CreateOrderDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('购物车为空');
    }

    // 查询所有 SKU 信息
    const skuIds = dto.items.map((i) => i.skuId);
    const skus = await this.prisma.productSKU.findMany({
      where: { id: { in: skuIds } },
      include: {
        product: {
          include: {
            company: { select: { id: true, name: true } },
            media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
      },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    // N01 SKU fallback
    const fallbackSkuIds = dto.items.filter((i) => !skuMap.has(i.skuId)).map((i) => i.skuId);
    if (fallbackSkuIds.length > 0) {
      const fallbackSkus = await this.prisma.productSKU.findMany({
        where: { productId: { in: fallbackSkuIds }, status: 'ACTIVE' },
        include: {
          product: {
            include: {
              company: { select: { id: true, name: true } },
              media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      const fallbackMap = new Map<string, typeof fallbackSkus[0]>();
      for (const s of fallbackSkus) {
        if (!fallbackMap.has(s.productId)) fallbackMap.set(s.productId, s);
      }
      for (const item of dto.items) {
        if (!skuMap.has(item.skuId) && fallbackMap.has(item.skuId)) {
          skuMap.set(item.skuId, fallbackMap.get(item.skuId)!);
        }
      }
    }

    // 查询用户购物车中的奖品项（用于 preview 也正确显示奖品价格）
    const previewCart = await this.prisma.cart.findUnique({ where: { userId } });
    const previewPrizeItems = previewCart
      ? await this.prisma.cartItem.findMany({
          where: {
            cartId: previewCart.id,
            isPrize: true,
            // F3: 排除已过期的奖品项
            OR: [
              { expiresAt: null },
              { expiresAt: { gte: new Date() } },
            ],
          },
        })
      : [];
    const previewCartItemById = new Map(previewPrizeItems.map((ci) => [ci.id, ci]));
    const previewPrizeBySkuId = new Map<string, typeof previewPrizeItems>();
    for (const ci of previewPrizeItems) {
      if (!previewPrizeBySkuId.has(ci.skuId)) previewPrizeBySkuId.set(ci.skuId, []);
      previewPrizeBySkuId.get(ci.skuId)!.push(ci);
    }
    const previewMatchedIds = new Set<string>();

    // 构建预览行
    type PreviewItem = { skuId: string; title: string; image: string; unitPrice: number; quantity: number; companyId: string; companyName: string; isPrize: boolean; prizeType: string | null };
    const previewItems: PreviewItem[] = [];

    for (const item of dto.items) {
      const sku = skuMap.get(item.skuId);
      if (!sku) throw new BadRequestException(`商品规格 ${item.skuId} 不存在`);
      if (sku.status !== 'ACTIVE') throw new BadRequestException(`商品规格 ${sku.title} 已下架`);
      if (sku.product.status !== 'ACTIVE') throw new BadRequestException(`商品 ${sku.product.title} 已下架`);

      // 判断是否为奖品项
      let prizeCi: typeof previewPrizeItems[0] | null = null;
      if ((item as any).cartItemId && previewCartItemById.has((item as any).cartItemId)) {
        const c = previewCartItemById.get((item as any).cartItemId)!;
        if (c.isPrize && !previewMatchedIds.has(c.id)) { prizeCi = c; previewMatchedIds.add(c.id); }
      }
      if (!prizeCi && previewPrizeBySkuId.has(item.skuId)) {
        for (const c of previewPrizeBySkuId.get(item.skuId)!) {
          if (!previewMatchedIds.has(c.id)) { prizeCi = c; previewMatchedIds.add(c.id); break; }
        }
      }

      let itemPrice = sku.price;
      let isPrizeItem = false;
      let itemPrizeType: string | null = null;
      if (prizeCi && prizeCi.prizeRecordId) {
        const lr = await this.prisma.lotteryRecord.findUnique({ where: { id: prizeCi.prizeRecordId } });
        // M1: preview 也需校验状态
        const validPrizeStatuses = ['WON', 'IN_CART'];
        if (lr && validPrizeStatuses.includes(lr.status) && lr.meta) {
          const meta = lr.meta as any;
          isPrizeItem = true;
          itemPrizeType = meta.prizeType || null;
          if (meta.prizePrice !== undefined && meta.prizePrice !== null) {
            itemPrice = meta.prizePrice;
          }
        }
      }

      previewItems.push({
        skuId: sku.id,
        title: sku.product.title,
        image: sku.product.media?.[0]?.url || '',
        unitPrice: itemPrice,
        quantity: item.quantity,
        companyId: sku.product.companyId,
        companyName: sku.product.company?.name || '',
        isPrize: isPrizeItem,
        prizeType: itemPrizeType,
      });
    }

    // F2: THRESHOLD_GIFT 消费门槛校验 — 解锁的赠品强制包含，未解锁的排除不参与结算
    const previewThresholdItems = previewItems.filter((pi) => pi.isPrize && pi.prizeType === 'THRESHOLD_GIFT');
    const excludedGifts: string[] = [];
    if (previewThresholdItems.length > 0) {
      // F2: 基于用户勾选的非奖品商品总额判断解锁
      const nonPrizeTotal = previewItems
        .filter((pi) => !pi.isPrize)
        .reduce((sum, pi) => sum + pi.unitPrice * pi.quantity, 0);

      for (const tpi of previewThresholdItems) {
        // 找到对应的购物车奖品项获取 threshold
        const matchedCi = previewPrizeItems.find(
          (ci) => ci.skuId === tpi.skuId && ci.prizeRecordId,
        );
        const threshold = matchedCi?.threshold ?? 0;
        // 如果购物车项没有 threshold 字段，从 LotteryRecord.meta 回退读取
        let effectiveThreshold = threshold;
        if (!effectiveThreshold && matchedCi?.prizeRecordId) {
          const lr = await this.prisma.lotteryRecord.findUnique({ where: { id: matchedCi.prizeRecordId } });
          effectiveThreshold = (lr?.meta as any)?.threshold ?? 0;
        }
        if (effectiveThreshold && nonPrizeTotal < effectiveThreshold) {
          // 未解锁：从结算中排除
          excludedGifts.push(`${tpi.title}（需消费满 ¥${effectiveThreshold}）`);
          const idx = previewItems.indexOf(tpi);
          if (idx >= 0) previewItems.splice(idx, 1);
        }
        // 解锁的保留在 previewItems 中，强制包含在结算
      }
    }

    // 查询收货地址的 regionCode（用于三维运费规则匹配）
    let regionCode: string | undefined;
    if (dto.addressId) {
      const address = await this.prisma.address.findUnique({
        where: { id: dto.addressId },
        select: { userId: true, regionCode: true },
      });
      if (address && address.userId === userId) {
        regionCode = address.regionCode;
      }
    }

    // 按 companyId 分组
    const groupMap = new Map<string, PreviewItem[]>();
    for (const pi of previewItems) {
      if (!groupMap.has(pi.companyId)) groupMap.set(pi.companyId, []);
      groupMap.get(pi.companyId)!.push(pi);
    }

    // 构建 skuId → weightGram 映射，用于计算分组总重量
    const skuWeightMap = new Map<string, number>();
    for (const [skuId, sku] of skuMap.entries()) {
      skuWeightMap.set(skuId, (sku as any).weightGram ?? 0);
    }

    const companyGroups = [...groupMap.entries()]
      .map(([companyId, items]) => ({
        companyId,
        companyName: items[0].companyName,
        items: items.map((i) => ({ skuId: i.skuId, title: i.title, image: i.image, unitPrice: i.unitPrice, quantity: i.quantity })),
        goodsAmount: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
        totalWeight: items.reduce((sum, i) => sum + i.quantity * (skuWeightMap.get(i.skuId) ?? 0), 0),
      }))
      .sort((a, b) => b.goodsAmount - a.goodsAmount);

    // VIP 状态查询（运费门槛 + 商品折扣共用）
    const vipNode = await this.prisma.vipTreeNode.findFirst({
      where: { userId },
      select: { id: true },
    });
    const isVip = !!vipNode;

    // 运费：平台统一发货，用整单总金额和总重量计算一次运费（VIP 享受更低免运费门槛）
    const totalGoodsAmountForShipping = companyGroups.reduce((s, g) => s + g.goodsAmount, 0);
    const totalWeightForShipping = companyGroups.reduce((s, g) => s + g.totalWeight, 0);
    const singleShippingFee = await this.calculateShippingFee(
      '__PLATFORM__', totalGoodsAmountForShipping, undefined, regionCode, totalWeightForShipping, isVip,
    );
    const groups: (typeof companyGroups[0] & { shippingFee: number; discountAmount: number })[] =
      companyGroups.map((g) => ({ ...g, shippingFee: 0, discountAmount: 0 }));

    // 奖励只读校验（不消费）
    const totalGoodsAmount = groups.reduce((s, g) => s + g.goodsAmount, 0);
    let couponDiscount = 0;
    let rewardDiscount = 0;

    // VIP 折扣计算（只读，不消费）
    let vipDiscount = 0;
    if (vipNode) {
      const sysConfig = await this.bonusConfig.getSystemConfig();
      const vipRate = sysConfig.vipDiscountRate ?? 0.95;
      if (vipRate < 1.0) {
        // 查询哪些 companyId 是平台公司
        const allCompanyIds = groups.map((g) => g.companyId).filter((id) => id !== '__NO_COMPANY__');
        const platformCompanies = allCompanyIds.length > 0
          ? await this.prisma.company.findMany({
              where: { id: { in: allCompanyIds }, isPlatform: true },
              select: { id: true },
            })
          : [];
        const platformIds = new Set(platformCompanies.map((c) => c.id));
        const nonPlatformGoodsAmount = groups
          .filter((g) => !platformIds.has(g.companyId))
          .reduce((sum, g) => sum + g.goodsAmount, 0);
        vipDiscount = Number((nonPlatformGoodsAmount * (1 - vipRate)).toFixed(2));
      }
    }

    // 平台红包预估（不锁定，只读校验）
    if (dto.couponInstanceIds && dto.couponInstanceIds.length > 0) {
      if (!this.couponService) {
        throw new BadRequestException('红包服务不可用，请稍后重试');
      }
      const deduped = Array.from(new Set(dto.couponInstanceIds));
      if (deduped.length !== dto.couponInstanceIds.length) {
        throw new BadRequestException('红包不可重复选择');
      }

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

      const eligibleCoupons = await this.couponService.getCheckoutEligible(userId, {
        orderAmount: totalGoodsAmount,
        categoryIds,
        companyIds,
      }) as Array<{
        id: string;
        eligible: boolean;
        ineligibleReason: string | null;
        stackable: boolean;
        stackGroup: string | null;
        estimatedDiscount: number;
      }>;
      const couponMap = new Map<string, (typeof eligibleCoupons)[number]>(
        eligibleCoupons.map((coupon) => [coupon.id, coupon]),
      );

      const selectedNonStackableByGroup = new Map<string, string>();
      for (const couponId of deduped) {
        const coupon = couponMap.get(couponId);
        if (!coupon) {
          throw new BadRequestException(`红包 ${couponId} 不存在或不可用`);
        }
        if (!coupon.eligible) {
          throw new BadRequestException(
            `红包 ${couponId} 不可用：${coupon.ineligibleReason || '不满足使用条件'}`,
          );
        }
        if (!coupon.stackable) {
          const group = coupon.stackGroup ?? '__default__';
          const existing = selectedNonStackableByGroup.get(group);
          if (existing) {
            throw new BadRequestException(
              `红包 ${couponId} 与 ${existing} 不可叠加使用`,
            );
          }
          selectedNonStackableByGroup.set(group, couponId);
        }
        couponDiscount += coupon.estimatedDiscount || 0;
      }

      couponDiscount = Number(
        Math.min(couponDiscount, totalGoodsAmount).toFixed(2),
      );
    }

    if (dto.rewardId) {
      const ledger = await this.prisma.rewardLedger.findUnique({ where: { id: dto.rewardId } });
      if (ledger && ledger.userId === userId && ledger.status === 'AVAILABLE' && ledger.entryType === 'RELEASE') {
        // 已到账奖励不过期，直接检查使用条件
        const minOrderAmount = ledger.amount >= 10 ? ledger.amount * 5 : 0;
        if (minOrderAmount === 0 || totalGoodsAmount >= minOrderAmount) {
          rewardDiscount = Number(
            Math.min(ledger.amount, totalGoodsAmount).toFixed(2),
          );
        }
      }
    }

    const rewardAllocations = this.allocateDiscountByCapacities(
      groups.map((group) => group.goodsAmount),
      rewardDiscount,
    );
    const remainingCapacities = groups.map((group, idx) =>
      Math.max(0, group.goodsAmount - rewardAllocations[idx]),
    );
    const couponAllocations = this.allocateDiscountByCapacities(
      remainingCapacities,
      couponDiscount,
    );
    groups.forEach((group, idx) => {
      group.discountAmount = Number(
        (rewardAllocations[idx] + couponAllocations[idx]).toFixed(2),
      );
    });

    const totalDiscount = Number(
      groups.reduce((sum, group) => sum + group.discountAmount, 0).toFixed(2),
    );

    const totalShippingFee = singleShippingFee;
    const totalPayable = Math.max(0, totalGoodsAmount - vipDiscount + totalShippingFee - totalDiscount);

    // 计算免运费门槛提示信息
    const sysConfig = await this.bonusConfig.getSystemConfig();
    const freeShippingThreshold = isVip
      ? sysConfig.vipFreeShippingThreshold
      : sysConfig.normalFreeShippingThreshold;
    const amountToFreeShipping = freeShippingThreshold === 0
      ? 0
      : Math.max(0, Number((freeShippingThreshold - totalGoodsAmount).toFixed(2)));

    return {
      groups,
      summary: {
        totalGoodsAmount,
        totalShippingFee,
        totalDiscount,
        vipDiscount,
        totalPayable,
        freeShippingThreshold,
        amountToFreeShipping,
      },
      expiredPrizes: [],       // F3: 过期的奖品（查询时已排除）
      lockedGifts: excludedGifts, // F2: 未解锁的赠品列表（未达消费门槛）
    };
  }

  // createFromCart 已移除 — 旧流程已废弃，使用 CheckoutService.checkout() + 支付回调代替

  // payOrder 已移除 — 旧流程已废弃，新流程由支付回调自动创建 PAID 订单

  // batchPayOrders 已移除 — 旧合并支付流程已废弃，使用 CheckoutService + 支付回调代替

  /** 确认收货 */
  async confirmReceive(id: string, userId: string) {
    // C5修复：Serializable 隔离 + CAS 防止双重确认收货导致重复分润
    const MAX_RETRIES = 3;
    let updated: any;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        updated = await this.prisma.$transaction(async (tx) => {
          // 事务内读取订单，校验归属和状态
          const current = await tx.order.findUnique({ where: { id } });
          if (!current) throw new NotFoundException('订单未找到');
          if (current.userId !== userId) throw new NotFoundException('订单未找到');
          if (current.status !== 'SHIPPED' && current.status !== 'DELIVERED') {
            throw new BadRequestException('当前订单状态无法确认收货');
          }

          // CAS 原子更新：仅当状态仍为 SHIPPED 或 DELIVERED 时才转为 RECEIVED
          const now = new Date();
          const casResult = await tx.order.updateMany({
            where: { id, status: { in: ['SHIPPED', 'DELIVERED'] } },
            data: { status: 'RECEIVED', receivedAt: now },
          });
          if (casResult.count === 0) {
            throw new ConflictException('订单状态已变更，请刷新后重试');
          }

          // 兜底：如果 deliveredAt 未设置（物流异常/直接从 SHIPPED 确认），补充退货窗口
          if (!(current as any).deliveredAt) {
            const returnWindowDays = await getConfigValue(tx as any, 'RETURN_WINDOW_DAYS', 7);
            await tx.order.update({
              where: { id },
              data: {
                deliveredAt: now,
                returnWindowExpiresAt: new Date(now.getTime() + returnWindowDays * 24 * 60 * 60 * 1000),
              },
            });
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId: id,
              fromStatus: current.status,
              toStatus: 'RECEIVED',
              reason: '买家确认收货',
            },
          });

          // 在事务内统计已确认订单数（Serializable 保证一致性，避免异步计数的竞态）
          const receivedCount = await tx.order.count({
            where: { userId, status: 'RECEIVED' },
          });

          // 返回更新后的订单 + 是否首单标记
          const result = await tx.order.findUnique({
            where: { id },
            include: { items: true },
          });
          return { ...result, _isFirstReceived: receivedCount === 1 };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        // CAS 成功，跳出重试循环
        break;
      } catch (e: any) {
        // P2034: Serializable 事务序列化冲突，可安全重试
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(`confirmReceive 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: orderId=${id}`);
          continue;
        }
        throw e;
      }
    }

    // I16修复：分润失败增加重试机制
    const orderId = id;
    const maxRetries = 3;
    const attemptBonus = async (attempt: number) => {
      try {
        await this.bonusAllocation.allocateForOrder(orderId);
      } catch (err: any) {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.warn(
          `分润尝试 ${attempt}/${maxRetries} 失败: orderId=${orderId}; error=${safeErr.message}`,
          safeErr.stack,
        );
        if (attempt < maxRetries) {
          // 指数退避重试
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          return attemptBonus(attempt + 1);
        }
        // 分润最终失败：记录死信日志，便于后续监控和人工介入
        this.logger.error(
          JSON.stringify({
            event: 'BONUS_ALLOCATION_DEAD_LETTER',
            orderId,
            retries: maxRetries,
            error: safeErr.message,
            stack: safeErr.stack,
            failedAt: new Date().toISOString(),
          }),
        );
        // 将失败信息写入 OrderStatusHistory 作为持久化死信记录
        try {
          await this.prisma.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: 'RECEIVED',
              toStatus: 'RECEIVED',
              reason: DEAD_LETTER_REASON,
              meta: {
                deadLetter: true,
                retries: maxRetries,
                error: safeErr.message,
                failedAt: new Date().toISOString(),
              },
            },
          });
        } catch (dlErr: any) {
          this.logger.error(
            `死信记录写入失败: orderId=${orderId}; error=${JSON.stringify(sanitizeForLog(dlErr))}`,
          );
        }
      }
    };
    attemptBonus(1).catch(() => {});

    // Phase F: 红包触发事件（fire-and-forget，不阻塞确认收货流程）
    if (this.couponEngineService && updated) {
      const orderUserId = updated.userId;
      const couponEngine = this.couponEngineService;

      // FIRST_ORDER: 使用事务内已计算的 _isFirstReceived（避免异步竞态）
      if (updated._isFirstReceived) {
        couponEngine.handleTrigger(orderUserId, 'FIRST_ORDER').catch((err: any) => {
          this.logger.warn(`FIRST_ORDER 红包触发失败: userId=${orderUserId}, error=${err?.message}`);
        });
      }

      // CUMULATIVE_SPEND: 计算用户已确认订单累计消费金额
      this.prisma.order.aggregate({
        where: { userId: orderUserId, status: 'RECEIVED' },
        _sum: { totalAmount: true },
      }).then((agg) => {
        const totalSpent = agg._sum?.totalAmount ?? 0;
        if (totalSpent > 0) {
          couponEngine.handleTrigger(orderUserId, 'CUMULATIVE_SPEND', { totalSpent }).catch((err: any) => {
            this.logger.warn(`CUMULATIVE_SPEND 红包触发失败: userId=${orderUserId}, error=${err?.message}`);
          });
        }
      }).catch((err: any) => {
        this.logger.warn(`CUMULATIVE_SPEND 聚合查询失败: userId=${orderUserId}, error=${err?.message}`);
      });
    }

    return this.mapOrder(updated);
  }

  /** 取消订单（N07修复：CAS 原子状态更新，防止与支付回调并发竞态） */
  async cancelOrder(id: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('订单未找到');
    if (order.userId !== userId) throw new NotFoundException('订单未找到');
    if (order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('当前订单状态无法取消');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // N07修复：CAS 更新订单状态，仅当 status 仍为 PENDING_PAYMENT 时才取消
      const casResult = await tx.order.updateMany({
        where: { id, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELED' },
      });
      if (casResult.count === 0) {
        // 状态已变（已支付/已取消），拒绝操作
        throw new BadRequestException('订单状态已变更，无法取消');
      }

      // CAS 成功后才恢复库存
      for (const item of order.items) {
        await tx.productSKU.update({
          where: { id: item.skuId },
          data: { stock: { increment: item.quantity } },
        });
        await tx.inventoryLedger.create({
          data: {
            skuId: item.skuId,
            type: 'RELEASE',
            qty: item.quantity,
            refType: 'ORDER',
            refId: id,
          },
        });
      }

      // 恢复被使用的奖励：将关联本订单的 VOIDED 奖励恢复为 AVAILABLE
      await tx.rewardLedger.updateMany({
        where: { refType: 'ORDER', refId: id, status: 'VOIDED' },
        data: { status: 'AVAILABLE', refType: null, refId: null },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: 'PENDING_PAYMENT',
          toStatus: 'CANCELED',
          reason: '买家取消订单',
        },
      });

      return tx.order.findUnique({
        where: { id },
        include: { items: true },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return this.mapOrder(updated);
  }

  /** 映射为前端 Order 列表项 */
  private mapOrder(order: any) {
    const snapshot = (item: any) => {
      const ps = (item.productSnapshot as any) || {};
      return {
        id: item.id,
        productId: ps.productId || item.skuId,
        title: ps.title || '',
        image: ps.image || '',
        price: item.unitPrice,
        quantity: item.quantity,
      };
    };

    // 售后系统数据 + 旧退款兼容
    const afterSaleReq = order.afterSaleRequests?.[0];
    const refund = order.refunds?.[0];

    // 售后系统状态映射
    const afterSaleStatusMap: Record<string, string> = {
      REQUESTED: 'applying',
      UNDER_REVIEW: 'reviewing',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      PENDING_ARBITRATION: 'arbitrating',
      RETURN_SHIPPING: 'returnShipping',
      RECEIVED_BY_SELLER: 'sellerReceived',
      SELLER_REJECTED_RETURN: 'sellerRejected',
      REFUNDING: 'refunding',
      REFUNDED: 'refunded',
      REPLACEMENT_SHIPPED: 'shipped',
      COMPLETED: 'completed',
      CLOSED: 'closed',
      CANCELED: 'canceled',
    };
    const refundStatusMap: Record<string, string> = {
      REQUESTED: 'applying',
      APPROVED: 'reviewing',
      REFUNDING: 'refunding',
      REFUNDED: 'completed',
      REJECTED: 'rejected',
      FAILED: 'failed',
    };

    // 判断是否有活跃售后
    const activeAfterSale = !!afterSaleReq
      && (ACTIVE_STATUSES as readonly string[]).includes(afterSaleReq.status);
    const hasRefundRecord = order.status === 'REFUNDED';

    const frontStatus = activeAfterSale || hasRefundRecord
      ? 'afterSale'
      : (STATUS_MAP[order.status] || order.status);

    let afterSaleStatus: string | undefined;
    let afterSaleReason: string | undefined;
    let afterSaleType: 'return' | 'exchange' | 'refund' | undefined;

    if (afterSaleReq) {
      // 统一售后系统
      const typeMap: Record<string, 'return' | 'exchange'> = {
        NO_REASON_RETURN: 'return',
        QUALITY_RETURN: 'return',
        QUALITY_EXCHANGE: 'exchange',
      };
      afterSaleType = typeMap[afterSaleReq.afterSaleType] || 'return';
      afterSaleStatus = afterSaleStatusMap[afterSaleReq.status] || 'applying';
      afterSaleReason = this.formatAfterSaleReason(afterSaleReq);
    } else if (refund && hasRefundRecord) {
      // 兼容旧退款数据
      afterSaleType = 'refund';
      afterSaleStatus = refundStatusMap[refund.status] || 'applying';
      afterSaleReason = refund.reason;
    }

    return {
      id: order.id,
      status: frontStatus,
      bizType: order.bizType || 'NORMAL_GOODS',
      afterSaleStatus,
      afterSaleReason,
      afterSaleType,
      returnWindowExpiresAt: order.returnWindowExpiresAt?.toISOString() || null,
      totalPrice: order.totalAmount,
      createdAt:
        order.createdAt instanceof Date
          ? order.createdAt.toISOString().slice(0, 16).replace('T', ' ')
          : order.createdAt,
      items: (order.items || []).map(snapshot),
    };
  }

  /** 映射为前端 Order 详情（含物流/售后/支付信息） */
  private mapOrderDetail(order: any) {
    const base = this.mapOrder(order);
    const payment = order.payments?.[0];
    const addressSnapshot = decryptJsonValue(order.addressSnapshot);
    const logistics = this.summarizeShipments(order.shipments);

    // 售后相关字段已由 mapOrder() 统一处理（afterSaleStatus/afterSaleReason/afterSaleType）

    return {
      ...base,
      addressSnapshot,
      addressSnapshotMasked: maskAddressSnapshot(addressSnapshot),
      goodsAmount: order.goodsAmount,
      shippingFee: order.shippingFee,
      discountAmount: order.discountAmount,
      vipDiscountAmount: order.vipDiscountAmount ?? 0,
      paidAt: order.paidAt?.toISOString() || null,
      paymentMethod: payment
        ? payment.channel === 'WECHAT_PAY'
          ? 'wechat'
          : payment.channel === 'UNIONPAY'
            ? 'bankcard'
            : 'alipay'
        : undefined,
      logisticsStatus: logistics.logisticsStatus,
      trackingNo: logistics.trackingNo,
      trackingNoMasked: logistics.trackingNoMasked,
      trackingEvents: logistics.trackingEvents,
      shipments: logistics.shipments,
      statusHistory: (order.statusHistory || []).map((h: any) => ({
        from: STATUS_MAP[h.fromStatus] || h.fromStatus,
        to: STATUS_MAP[h.toStatus] || h.toStatus,
        reason: h.reason,
        time: h.createdAt?.toISOString() || '',
      })),
    };
  }

  /** 售后系统理由格式化 */
  private formatAfterSaleReason(req: { reasonType?: string | null; reason?: string | null; afterSaleType?: string | null }) {
    // 无理由退货
    if (req.afterSaleType === 'NO_REASON_RETURN') {
      return req.reason || '七天无理由退货';
    }
    if (!req.reasonType) {
      return req.reason || undefined;
    }
    if (req.reasonType === 'OTHER') {
      return req.reason || REPLACEMENT_REASON_LABELS.OTHER;
    }
    return REPLACEMENT_REASON_LABELS[req.reasonType] || req.reason || req.reasonType;
  }

  /**
   * 检查订单是否所有商品项都已退款完成 → 更新订单状态为 REFUNDED
   * 由 AfterSaleService / AdminAfterSaleService 在退款完成后调用
   */
  async checkAndUpdateFullRefund(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        afterSaleRequests: {
          select: { orderItemId: true, status: true },
        },
      },
    });
    if (!order) return;

    // 仅对 RECEIVED / DELIVERED 状态的订单检查全额退款
    if (!['RECEIVED', 'DELIVERED', 'SHIPPED'].includes(order.status)) return;

    // 非奖品商品项（奖品不可退，不参与全额退款判断）
    const nonPrizeItems = order.items.filter((item: any) => !item.isPrize);
    if (nonPrizeItems.length === 0) return;

    // 检查每个非奖品商品项是否都有已退款的售后记录
    const allItemsRefunded = nonPrizeItems.every((item) =>
      order.afterSaleRequests.some(
        (req: any) => req.orderItemId === item.id && req.status === 'REFUNDED',
      ),
    );

    if (allItemsRefunded) {
      await this.prisma.$transaction(async (tx) => {
        const casResult = await tx.order.updateMany({
          where: { id: orderId, status: { in: ['RECEIVED', 'DELIVERED', 'SHIPPED'] } },
          data: { status: 'REFUNDED' },
        });
        if (casResult.count > 0) {
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: order.status,
              toStatus: 'REFUNDED',
              reason: '所有商品项退款完成，订单自动标记为已退款',
            },
          });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
  }
}
