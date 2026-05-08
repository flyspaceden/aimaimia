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
import {
  getPrizeUnavailableReason,
  getUnavailableReasonText,
} from '../lottery/prize-availability.util';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { CartService } from '../cart/cart.service';
import { RepurchaseResult, RepurchaseResultItem, RepurchaseSkipReason } from './repurchase.types';

// Bug 74 hotfix-2 (2026-05-06): 删 STATUS_MAP / REVERSE_STATUS_MAP
// 之前 backend 把 schema 大写枚举转成 lowerCamel 再发 App，是历史协议；
// Phase 2 App 已迁移到大写枚举（与 schema 一致），后端不再做转换，前后端协议统一。
//
// 兼容性:
// - 'afterSale' / 'shipping' 是虚拟聚合 tab，仍由 list() 函数特判（向后兼容旧 App）
// - 列表/详情/历史 API 返回 status 直接是 schema 大写枚举（PAID/SHIPPED/...）
// - status counts 返回 keys 也改成大写枚举（前端 me.tsx 已期望大写）

const REPLACEMENT_REASON_LABELS: Record<string, string> = {
  QUALITY_ISSUE: '质量问题',
  WRONG_ITEM: '发错商品',
  DAMAGED: '运输损坏',
  NOT_AS_DESCRIBED: '与描述不符',
  SIZE_ISSUE: '规格不符',
  EXPIRED: '临期/过期',
  OTHER: '其他',
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
  // PaymentService 通过 setter 注入（避免与 PaymentModule 循环依赖；PAID 取消用）
  private paymentService: any = null;
  // InboxService 通过 setter 注入（PAID 取消通知商户用）
  private inboxService: any = null;

  constructor(
    private prisma: PrismaService,
    private bonusAllocation: BonusAllocationService,
    private bonusConfig: BonusConfigService,
    private redisCoord: RedisCoordinatorService,
    private cartService: CartService,
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

  /** 注入支付服务（PAID 未发货取消调 initiateRefund 用） */
  setPaymentService(service: any) {
    this.paymentService = service;
  }

  /** 注入站内信服务（PAID 取消通知商户 OWNER 用） */
  setInboxService(service: any) {
    this.inboxService = service;
  }

  private earliestShippedAt(shipments?: any[]): string | null {
    if (!shipments || shipments.length === 0) return null;
    const times = shipments
      .map((s) => s.shippedAt)
      .filter(Boolean)
      .map((d: Date) => d.getTime());
    return times.length ? new Date(Math.min(...times)).toISOString() : null;
  }

  private summarizeLatestEvent(shipments?: any[]): {
    status: string | null;
    latestEventMessage: string | null;
    latestEventTime: string | null;
  } | null {
    if (!shipments || shipments.length === 0) return null;
    const allEvents = shipments.flatMap((s) => s.trackingEvents || []);
    if (allEvents.length === 0) {
      return {
        status: shipments[0].status ?? null,
        latestEventMessage: null,
        latestEventTime: null,
      };
    }
    const sorted = [...allEvents].sort((a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
    const latest = sorted[0];
    return {
      status: shipments[0].status ?? null,
      latestEventMessage: latest.message ?? null,
      latestEventTime: latest.occurredAt instanceof Date
        ? latest.occurredAt.toISOString()
        : (latest.occurredAt ?? null),
    };
  }

  private summarizeShipments(
    shipments?: Array<{
      id: string;
      companyId?: string | null;
      carrierCode?: string | null;
      carrierName?: string | null;
      trackingNo?: string | null;
      waybillNo?: string | null;
      status?: string | null;
      shippedAt?: Date | null;
      deliveredAt?: Date | null;
      trackingEvents?: Array<{ occurredAt?: Date | null; message?: string | null; location?: string | null }>;
    }>,
  ) {
    const normalized = (shipments || []).map((shipment) => {
      // Phase 2 hotfix: 自动取号路径写 waybillNo（trackingNo=null）；手填路径写 trackingNo
      // App 显示统一用「waybillNo || trackingNo」，否则自动取号订单 App 看不到运单号
      const effectiveTrackingNo = shipment.waybillNo || shipment.trackingNo || null;
      return {
      id: shipment.id,
      companyId: shipment.companyId || null,
      carrierCode: shipment.carrierCode || '',
      carrierName: shipment.carrierName || '',
      trackingNo: effectiveTrackingNo,
      trackingNoMasked: maskTrackingNo(effectiveTrackingNo),
      status: shipment.status || 'INIT',
      shippedAt: shipment.shippedAt?.toISOString() || null,
      deliveredAt: shipment.deliveredAt?.toISOString() || null,
      trackingEvents: (shipment.trackingEvents || []).map((event) => ({
        time: event.occurredAt?.toISOString() || '',
        message: event.message || '',
        location: event.location || undefined,
      })),
      };
    });

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

  private mapRefundSummary(refund?: any) {
    if (!refund) return null;
    return {
      id: refund.id,
      amount: refund.amount,
      status: refund.status,
      reason: refund.reason,
      merchantRefundNo: refund.merchantRefundNo,
      providerRefundId: refund.providerRefundId ?? null,
      updatedAt: refund.updatedAt?.toISOString?.() ?? refund.updatedAt ?? null,
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
        // 旧 App 兼容：'shipping' 聚合 SHIPPED+DELIVERED
        // 新版 App 已拆成「已发货 SHIPPED」「待收货 DELIVERED」两个 tab，分别走 exact match
        where.status = { in: ['SHIPPED', 'DELIVERED'] };
        // 排除售后进行中订单，避免与 afterSale 口径冲突
        where.AND = [
          {
            afterSaleRequests: {
              none: { status: { in: [...ACTIVE_STATUSES] } },
            },
          },
        ];
      } else {
        // App 已传大写 schema 枚举（PAID/SHIPPED/DELIVERED/RECEIVED/...）：exact match
        where.status = status;
      }
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          shipments: {
            select: {
              status: true,
              trackingNo: true,
              waybillNo: true,
              carrierCode: true,
              carrierName: true,
              shippedAt: true,
              deliveredAt: true,
              trackingEvents: {
                orderBy: { occurredAt: 'desc' },
                take: 1,
                select: { occurredAt: true, message: true, location: true },
              },
            },
          },
          afterSaleRequests: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, reason: true, afterSaleType: true, reasonType: true },
          },
          refunds: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              amount: true,
              status: true,
              reason: true,
              merchantRefundNo: true,
              providerRefundId: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    // 批量取店铺信息（多商户场景，每订单店铺数有限，N+1 可控）
    // 注：Company 表当前无 logo 字段，companyLogo 暂统一返回 null，待 schema 补充
    const companyIds = [...new Set(
      orders.flatMap((o: any) => o.items.map((i: any) => i.companyId)).filter(Boolean)
    )] as string[];
    const companies = companyIds.length > 0 ? await this.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true, shortName: true },
    }) : [];
    const companyMap = new Map(
      companies.map((c) => [c.id, { id: c.id, name: c.shortName || c.name, logoUrl: null as string | null }]),
    );

    return {
      items: orders.map((o) => this.mapOrder(o, companyMap)),
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

    // schema 大写枚举 keys + afterSale 虚拟聚合（issueFlag/活跃售后派生）
    const counts: Record<string, number> = {
      PAID: 0,
      SHIPPED: 0,
      DELIVERED: 0,
      RECEIVED: 0,
      CANCELED: 0,
      REFUNDED: 0,
      afterSale: 0,
    };
    orders.forEach((o: any) => {
      // 有活跃售后请求的订单计入 afterSale 虚拟态
      if (o.afterSaleRequests.length > 0) {
        counts.afterSale++;
      } else {
        counts[o.status] = (counts[o.status] ?? 0) + 1;
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
              select: {
                id: true,
                amount: true,
                status: true,
                reason: true,
                merchantRefundNo: true,
                providerRefundId: true,
                updatedAt: true,
              },
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
              select: {
                id: true,
                amount: true,
                status: true,
                reason: true,
                merchantRefundNo: true,
                providerRefundId: true,
                updatedAt: true,
              },
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

    // Phase 3 Review Fix 2：批量 join Company，避免店铺名 fallback 成"商家"
    const companyIds = [...new Set((order.items as any[]).map((i) => i.companyId).filter(Boolean))] as string[];
    const companies = companyIds.length > 0
      ? await this.prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, name: true, shortName: true },
        })
      : [];
    const companyMap = new Map(
      companies.map((c) => [
        c.id,
        { id: c.id, name: (c as any).shortName || c.name, logoUrl: null as string | null },
      ]),
    );

    return this.mapOrderDetail(order, companyMap);
  }

  private repurchaseTitle(item: any): string {
    const ps = (item.productSnapshot as any) || {};
    return ps.title || item.sku?.product?.title || item.skuId;
  }

  private repurchaseSkipped(
    item: any,
    reason: RepurchaseSkipReason,
    message: string,
  ): RepurchaseResultItem {
    return {
      orderItemId: item.id,
      skuId: item.skuId,
      title: this.repurchaseTitle(item),
      quantity: item.quantity,
      status: 'SKIPPED',
      reason,
      message,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildRepurchaseSummary(items: RepurchaseResultItem[], cart: unknown): RepurchaseResult {
    const added = items.filter((item) => item.status === 'ADDED');
    const skipped = items.filter((item) => item.status === 'SKIPPED');
    return {
      addedItemCount: added.length,
      addedQuantity: added.reduce((sum, item) => sum + item.quantity, 0),
      skippedItemCount: skipped.length,
      skippedQuantity: skipped.reduce((sum, item) => sum + item.quantity, 0),
      priceChangedCount: added.filter((item) => item.priceChanged).length,
      cart,
      items,
    };
  }

  async repurchase(orderId: string, userId: string): Promise<RepurchaseResult> {
    const resultKey = `order:repurchase:result:${userId}:${orderId}`;
    const lockKey = `order:repurchase:lock:${userId}:${orderId}`;
    const lockOwner = `repurchase:${userId}:${orderId}`;

    // 命中幂等缓存时仅复用 items[] 结果，cart 字段重查最新，避免 60s 窗口内购物车被
    // 其它操作（手动删项、加购等）改动导致 replaceFromServer 把过期 cart 写回去。
    const cached = await this.redisCoord.get(resultKey);
    if (cached) {
      const cachedResult = JSON.parse(cached) as RepurchaseResult;
      const freshCart = await this.cartService.getCart(userId);
      return { ...cachedResult, cart: freshCart };
    }

    // acquireLock 返回 null 表示 Redis 不可用：fail-closed，直接 409，避免无幂等保护下重复加购。
    const acquired = await this.redisCoord.acquireLock(lockKey, lockOwner, 60_000);
    if (acquired !== true) {
      // acquired === false：有别的请求正在处理；轮询 5s 内能等到结果就复用，否则 409。
      if (acquired === false) {
        for (let wait = 0; wait < 10; wait++) {
          await this.sleep(500);
          const retryCache = await this.redisCoord.get(resultKey);
          if (retryCache) {
            const cachedResult = JSON.parse(retryCache) as RepurchaseResult;
            const freshCart = await this.cartService.getCart(userId);
            return { ...cachedResult, cart: freshCart };
          }
        }
      }
      throw new ConflictException('再次购买处理中，请稍后重试');
    }

    let shouldReleaseLock = true;
    try {
      const cachedAfterLock = await this.redisCoord.get(resultKey);
      if (cachedAfterLock) {
        const cachedResult = JSON.parse(cachedAfterLock) as RepurchaseResult;
        const freshCart = await this.cartService.getCart(userId);
        return { ...cachedResult, cart: freshCart };
      }

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order || order.userId !== userId) {
        throw new NotFoundException('订单未找到');
      }
      if (order.status !== 'RECEIVED') {
        throw new BadRequestException('仅已完成订单支持再次购买');
      }
      if ((order.bizType || 'NORMAL_GOODS') !== 'NORMAL_GOODS') {
        throw new BadRequestException('当前订单类型不支持再次购买');
      }

      const skuIds = [...new Set((order.items || []).map((item: any) => item.skuId).filter(Boolean))];
      const MAX_RETRIES = 3;
      let resultItems: RepurchaseResultItem[] = [];

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          resultItems = await this.prisma.$transaction(async (tx) => {
            let cart = await tx.cart.findUnique({ where: { userId } });
            if (!cart) {
              cart = await tx.cart.create({ data: { userId } });
            }

            const skus = skuIds.length > 0
              ? await tx.productSKU.findMany({
                  where: { id: { in: skuIds } },
                  include: {
                    product: {
                      include: {
                        company: true,
                        media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
                      },
                    },
                  },
                })
              : [];
            const skuMap = new Map(skus.map((sku: any) => [sku.id, sku]));

            const existingItems = await tx.cartItem.findMany({
              where: { cartId: cart.id, isPrize: false, skuId: { in: skuIds } },
              orderBy: { createdAt: 'asc' },
            });
            const existingGroupsBySkuId = new Map<string, any[]>();
            for (const item of existingItems as any[]) {
              const group = existingGroupsBySkuId.get(item.skuId);
              if (group) {
                group.push(item);
              } else {
                existingGroupsBySkuId.set(item.skuId, [item]);
              }
            }
            const output: RepurchaseResultItem[] = [];
            const purchasableBySkuId = new Map<string, { sku: any; items: any[]; totalQuantity: number }>();

            for (const item of order.items as any[]) {
              if (item.isPrize) {
                output.push(this.repurchaseSkipped(item, 'PRIZE_ITEM', '奖品不支持再次购买'));
                continue;
              }

              const sku = skuMap.get(item.skuId) as any;
              if (!sku) {
                output.push(this.repurchaseSkipped(item, 'SKU_MISSING', '商品规格不存在'));
                continue;
              }
              if (sku.status !== 'ACTIVE') {
                output.push(this.repurchaseSkipped(item, 'SKU_INACTIVE', '商品规格已下架'));
                continue;
              }
              if (sku.product?.status !== 'ACTIVE') {
                output.push(this.repurchaseSkipped(item, 'PRODUCT_INACTIVE', '商品已下架'));
                continue;
              }
              if (sku.product?.company?.status !== 'ACTIVE') {
                output.push(this.repurchaseSkipped(item, 'COMPANY_INACTIVE', '商家当前不可售'));
                continue;
              }
              if (sku.product?.company?.isPlatform) {
                output.push(this.repurchaseSkipped(item, 'PLATFORM_PRODUCT', '平台奖品商品不支持再次购买'));
                continue;
              }

              const group = purchasableBySkuId.get(item.skuId);
              if (group) {
                group.items.push(item);
                group.totalQuantity += item.quantity;
              } else {
                purchasableBySkuId.set(item.skuId, { sku, items: [item], totalQuantity: item.quantity });
              }
            }

            for (const [skuId, group] of purchasableBySkuId.entries()) {
              const existingRows = existingGroupsBySkuId.get(skuId) ?? [];
              const existing = existingRows[0] as any | undefined;
              const existingQuantity = existingRows.reduce((sum, item) => sum + item.quantity, 0);
              const nextQuantity = existingQuantity + group.totalQuantity;
              if (group.sku.maxPerOrder != null && nextQuantity > group.sku.maxPerOrder) {
                for (const item of group.items) {
                  output.push(this.repurchaseSkipped(
                    item,
                    'MAX_PER_ORDER_EXCEEDED',
                    existing
                      ? `该商品每单限购 ${group.sku.maxPerOrder} 件，购物车已有 ${existingQuantity} 件`
                      : `该商品每单限购 ${group.sku.maxPerOrder} 件`,
                  ));
                }
                continue;
              }

              if (existing) {
                await tx.cartItem.update({
                  where: { id: existing.id },
                  data: { quantity: nextQuantity, isSelected: true },
                });
                const duplicateIds = existingRows.slice(1).map((item) => item.id);
                if (duplicateIds.length > 0) {
                  await tx.cartItem.deleteMany({
                    where: { id: { in: duplicateIds } },
                  });
                }
              } else {
                await tx.cartItem.create({
                  data: { cartId: cart.id, skuId, quantity: group.totalQuantity, isSelected: true },
                });
              }

              for (const item of group.items) {
                const originalPrice = item.unitPrice;
                const currentPrice = group.sku.price;
                const priceChanged = Math.abs(originalPrice - currentPrice) > 0.01;
                output.push({
                  orderItemId: item.id,
                  skuId,
                  title: this.repurchaseTitle(item),
                  quantity: item.quantity,
                  status: 'ADDED',
                  priceChanged,
                  originalPrice,
                  currentPrice,
                  message: priceChanged ? '商品价格已变动，请到购物车确认' : undefined,
                });
              }
            }

            return output;
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
          break;
        } catch (err: any) {
          if ((err?.code === 'P2034' || err?.code === 'P2002') && attempt < MAX_RETRIES - 1) {
            this.logger.warn(`repurchase 事务冲突(${err.code})，第 ${attempt + 1}/${MAX_RETRIES} 次重试`);
            continue;
          }
          throw err;
        }
      }

      const cart = await this.cartService.getCart(userId);
      const result = this.buildRepurchaseSummary(resultItems, cart);
      const cachedResult = await this.redisCoord.set(resultKey, JSON.stringify(result), 60_000);
      if (!cachedResult) {
        shouldReleaseLock = false;
        throw new ConflictException('再次购买结果缓存失败，请稍后查看购物车');
      }
      this.logger.log(JSON.stringify({
        action: 'order_repurchase',
        userId,
        orderId,
        addedQuantity: result.addedQuantity,
        skippedQuantity: result.skippedQuantity,
        priceChangedCount: result.priceChangedCount,
      }));
      return result;
    } finally {
      if (shouldReleaseLock) {
        await this.redisCoord.releaseLock(lockKey, lockOwner);
      }
    }
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
    type PreviewItem = { skuId: string; title: string; image: string; unitPrice: number; quantity: number; companyId: string; companyName: string; isPrize: boolean; prizeType: string | null; cartItemId?: string; prizeRecordId?: string | null };
    const excludedItems: Array<{
      cartItemId?: string;
      skuId: string;
      reason: string;
      isPrize: boolean;
      prizeRecordId?: string | null;
    }> = [];
    const previewItems: PreviewItem[] = [];

    for (const item of dto.items) {
      const sku = skuMap.get(item.skuId);
      if (!sku) throw new BadRequestException(`商品规格 ${item.skuId} 不存在`);

      // 判断是否为奖品项
      let prizeCi: typeof previewPrizeItems[0] | null = null;
      if ((item as any).cartItemId && previewCartItemById.has((item as any).cartItemId)) {
        const c = previewCartItemById.get((item as any).cartItemId)!;
        if (c.isPrize) {
          if (c.skuId !== item.skuId) {
            throw new BadRequestException('购物车项与商品规格不匹配，请刷新购物车后重试');
          }
          if (!previewMatchedIds.has(c.id)) { prizeCi = c; previewMatchedIds.add(c.id); }
        }
      }
      if (!prizeCi && previewPrizeBySkuId.has(item.skuId)) {
        for (const c of previewPrizeBySkuId.get(item.skuId)!) {
          if (!previewMatchedIds.has(c.id)) { prizeCi = c; previewMatchedIds.add(c.id); break; }
        }
      }

      if (sku.status !== 'ACTIVE' || sku.product.status !== 'ACTIVE') {
        if (prizeCi) {
          excludedItems.push({
            cartItemId: prizeCi.id,
            skuId: sku.id,
            reason: sku.status !== 'ACTIVE' ? '商品规格已下架' : '商品已下架',
            isPrize: true,
            prizeRecordId: prizeCi.prizeRecordId ?? null,
          });
          continue;
        }
        if (sku.status !== 'ACTIVE') throw new BadRequestException(`商品规格 ${sku.title} 已下架`);
        throw new BadRequestException(`商品 ${sku.product.title} 已下架`);
      }

      let itemPrice = sku.price;
      let isPrizeItem = false;
      let itemPrizeType: string | null = null;
      let prizeRecordId: string | null = null;
      if (prizeCi && prizeCi.prizeRecordId) {
        const lr = await this.prisma.lotteryRecord.findUnique({
          where: { id: prizeCi.prizeRecordId },
          include: {
            prize: {
              include: {
                sku: { include: { product: true } },
                product: true,
              },
            },
          },
        });
        const unavailableReason = (lr as any)?.prize
          ? getPrizeUnavailableReason((lr as any).prize)
          : null;
        if (unavailableReason) {
          excludedItems.push({
            cartItemId: prizeCi.id,
            skuId: sku.id,
            reason: getUnavailableReasonText(unavailableReason),
            isPrize: true,
            prizeRecordId: prizeCi.prizeRecordId ?? null,
          });
          continue;
        }
        // M1: preview 也需校验状态
        const validPrizeStatuses = ['WON', 'IN_CART'];
        if (lr && validPrizeStatuses.includes(lr.status) && lr.meta) {
          const meta = lr.meta as any;
          isPrizeItem = true;
          itemPrizeType = meta.prizeType || null;
          prizeRecordId = prizeCi.prizeRecordId;
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
        cartItemId: prizeCi?.id,
        prizeRecordId,
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
      excludedItems,
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

    // 旧架构遗留：PENDING_PAYMENT 走原逻辑（创建订单后未付款）
    if (order.status === 'PENDING_PAYMENT') {
      return this.cancelPendingPayment(id, order);
    }
    // 新架构：PAID 未发货取消（付款回调建单架构下买家撤单退款入口）
    if (order.status === 'PAID') {
      if (order.bizType === 'VIP_PACKAGE') {
        throw new BadRequestException('VIP 开通礼包不支持取消退款，请联系客服');
      }
      // Bug 90：多商户 CheckoutSession 检测
      // 共享奖励/红包只挂在 primary order（checkout.service.ts:1485-1489, 1730），
      // 单订单取消会导致非 primary 不恢复 / primary 恢复后其他订单仍在用折扣 → 套利。
      // 方案：sibling 全 PAID 才允许，整 session 一起取消；任一已发货拒绝
      if (order.checkoutSessionId) {
        const siblings = await this.prisma.order.findMany({
          where: { checkoutSessionId: order.checkoutSessionId, id: { not: id } },
          select: { id: true, status: true },
        });
        if (siblings.length > 0) {
          const nonPaid = siblings.filter((s) => s.status !== 'PAID');
          if (nonPaid.length > 0) {
            throw new BadRequestException(
              '该订单含多家商品，部分已发货或已退，无法整单取消，请联系客服',
            );
          }
          // 全部 sibling PAID — 整 session 一起取消
          return this.cancelEntireSessionUnshipped(order.checkoutSessionId, userId);
        }
      }
      return this.cancelPaidUnshipped(id, userId, order);
    }

    throw new BadRequestException('当前订单状态无法取消');
  }

  /** PENDING_PAYMENT → CANCELED（旧架构遗留，保留向后兼容） */
  private async cancelPendingPayment(id: string, order: any) {
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

  /**
   * PAID → CANCELED（买家在卖家发货前取消，原路退款）
   *
   * 关键约束：
   * 1. 卖家已生成 SF 面单（Shipment.waybillNo 非空）→ 拒绝（避免买家撤单/卖家发货撞车）
   * 2. 已有进行中的退款 → 拒绝（防狂点）
   * 3. advisory_xact_lock 与 SellerShippingService.generateWaybill 严格同 namespace + 复合 key
   *    （namespace='seller-waybill-order' / key=`${companyId}:${orderId}`）
   * 4. merchantRefundNo 必须 'AUTO-' 前缀，否则 retryStaleAutoRefunds cron 不兜底
   * 5. 退款金额 = order.totalAmount（含运费，因未发货无快递费产生）
   */
  private async cancelPaidUnshipped(id: string, userId: string, order: any) {
    // Step 1：事务外预检 Shipment（fast fail，避免持锁过长）
    const existingShipments = await this.prisma.shipment.findMany({
      where: { orderId: id, waybillNo: { not: null } },
      select: { id: true, status: true },
    });
    if (existingShipments.length > 0) {
      throw new BadRequestException(
        '卖家已生成发货面单，无法直接取消。请联系卖家撤销面单，或等发货后申请退货',
      );
    }

    // Step 2：Refund 幂等检查（防止狂点）
    const inflightRefund = await this.prisma.refund.findFirst({
      where: {
        orderId: id,
        status: { in: ['REQUESTED', 'APPROVED', 'REFUNDING'] },
      },
    });
    if (inflightRefund) {
      throw new BadRequestException('已有进行中的退款，请勿重复操作');
    }

    // 多商户订单 — 取所有 companyId 用于锁 + 通知（按字典序排序避死锁）
    const companyIds = [
      ...new Set(order.items.map((i: any) => i.companyId).filter(Boolean) as string[]),
    ].sort();

    // Step 3：原子事务（Serializable + 与 SellerShippingService.generateWaybill 严格互斥）
    const refundData = await this.prisma.$transaction(async (tx) => {
      // 严格匹配 seller-shipping.service.ts:25,158,576 的 namespace + 复合 key
      for (const companyId of companyIds) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext('seller-waybill-order'),
            hashtext(${`${companyId}:${id}`})
          )
        `;
      }

      // 锁内再查一次 Shipment，防止"事务外预检通过 → 取锁前卖家生成"的窄窗
      const shipmentCount = await tx.shipment.count({
        where: { orderId: id, waybillNo: { not: null } },
      });
      if (shipmentCount > 0) {
        throw new BadRequestException('卖家已生成面单，请稍后重试或联系卖家');
      }

      // CAS 更新订单 PAID → CANCELED
      const cas = await tx.order.updateMany({
        where: { id, userId, status: 'PAID' },
        data: { status: 'CANCELED' },
      });
      if (cas.count === 0) {
        throw new BadRequestException('订单状态已变更，无法取消');
      }

      // 释放库存
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

      // 恢复奖励账（VOIDED → AVAILABLE）
      await tx.rewardLedger.updateMany({
        where: { refType: 'ORDER', refId: id, status: 'VOIDED' },
        data: { status: 'AVAILABLE', refType: null, refId: null },
      });

      // 恢复红包（USED → AVAILABLE/EXPIRED）— 调 CouponService.restoreCouponsForOrder
      if (this.couponService?.restoreCouponsForOrder) {
        await this.couponService.restoreCouponsForOrder(id, tx);
      }

      // 创建 Refund 行（status=REFUNDING；merchantRefundNo 'AUTO-' 前缀让 cron 兜底重试）
      const refund = await tx.refund.create({
        data: {
          orderId: id,
          amount: order.totalAmount,
          status: 'REFUNDING',
          merchantRefundNo: `AUTO-CANCEL-${id}`,
          reason: '买家未发货取消订单',
        },
      });

      // 写 RefundStatusHistory（首次创建，fromStatus=null）
      await tx.refundStatusHistory.create({
        data: {
          refundId: refund.id,
          toStatus: 'REFUNDING',
          remark: '买家未发货取消订单触发自动退款',
          operatorId: userId,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: 'PAID',
          toStatus: 'CANCELED',
          reason: '买家未发货取消订单',
        },
      });

      return {
        refundId: refund.id,
        refundAmount: order.totalAmount,
        merchantRefundNo: refund.merchantRefundNo,
        affectedCompanyIds: companyIds,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    // Step 4：事务外调支付宝 refund（不持长事务，失败 cron 兜底）
    if (this.paymentService?.initiateRefund) {
      try {
        const result = await this.paymentService.initiateRefund(
          id,
          refundData.refundAmount,
          refundData.merchantRefundNo,
        );
        if (result?.success) {
          await this.prisma.$transaction(async (tx) => {
            await tx.refund.update({
              where: { id: refundData.refundId },
              data: {
                status: 'REFUNDED',
                providerRefundId: result.providerRefundId,
              },
            });
            await tx.refundStatusHistory.create({
              data: {
                refundId: refundData.refundId,
                fromStatus: 'REFUNDING',
                toStatus: 'REFUNDED',
                remark: '渠道退款成功',
                operatorId: userId,
              },
            });
          });
        } else {
          this.logger.warn(
            `退款发起失败，cron 将重试: refundId=${refundData.refundId}, msg=${result?.message ?? 'unknown'}`,
          );
        }
      } catch (e: any) {
        this.logger.error(`退款调用异常（订单已取消，cron 将重试）: ${e?.message ?? e}`);
      }
    } else {
      this.logger.warn(
        `paymentService 未注入，订单 ${id} 已 CANCELED 但未发起退款（cron 将兜底）`,
      );
    }

    // Step 5：通知所有受影响商户的 OWNER（多商户订单逐个通知）
    if (this.inboxService?.send && refundData.affectedCompanyIds.length > 0) {
      try {
        const owners = await this.prisma.companyStaff.findMany({
          where: {
            companyId: { in: refundData.affectedCompanyIds },
            role: 'OWNER',
            status: 'ACTIVE',
          },
          select: { userId: true, companyId: true },
        });
        for (const owner of owners) {
          await this.inboxService.send({
            userId: owner.userId,
            category: 'order',
            type: 'order.canceled.by.buyer',
            title: '买家取消订单',
            content: `订单 ${id} 已被买家在发货前取消，库存已恢复，款项原路退回`,
            target: { route: '/orders/[id]', params: { id } },
          });
        }
      } catch (e: any) {
        this.logger.warn(`通知商户失败（不影响主流程）: ${e?.message ?? e}`);
      }
    }

    const updated = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    return this.mapOrder(updated);
  }

  /**
   * 整 session 取消（多商户 CheckoutSession 拆出 N 个 Order，全部 PAID 才能整批取消）
   * Bug 90 修复：避免单订单取消导致共享奖励/红包错乱套利
   *
   * 同步语义：
   * - 全部 sibling 必须 PAID（调用方已校验，此处仅 TX 内复检）
   * - 任一 Order 已生成 SF 面单 → 拒绝
   * - 全部 Order 一并 CANCELED + 库存全恢复 + 奖励/红包统一恢复（基于真实 refId/orderId 关联）
   * - 每个 Order 创建独立 Refund 行（merchantRefundNo='AUTO-CANCEL-${orderId}'），调 alipay 逐笔退款
   */
  private async cancelEntireSessionUnshipped(sessionId: string, userId: string) {
    // Step 1：拿 session 所有 Order
    const orders = await this.prisma.order.findMany({
      where: { checkoutSessionId: sessionId, userId },
      include: {
        items: { select: { skuId: true, quantity: true, companyId: true } },
      },
    });
    if (orders.length === 0) {
      throw new NotFoundException('订单未找到');
    }

    // 全部必须 PAID
    const nonPaid = orders.filter((o) => o.status !== 'PAID');
    if (nonPaid.length > 0) {
      throw new BadRequestException('该批订单部分已发货或已退，无法整单取消，请联系客服');
    }

    const orderIds = orders.map((o) => o.id);

    // Step 2：事务外预检 Shipment（任一已生成面单 → 拒绝）
    const shipments = await this.prisma.shipment.findMany({
      where: { orderId: { in: orderIds }, waybillNo: { not: null } },
      select: { id: true },
    });
    if (shipments.length > 0) {
      throw new BadRequestException(
        '该批订单部分商品卖家已生成发货面单，无法直接取消，请联系卖家或等发货后申请退货',
      );
    }

    // Step 3：Refund 幂等检查（任一 Order 有 in-flight 退款 → 拒绝）
    const inflightRefund = await this.prisma.refund.findFirst({
      where: {
        orderId: { in: orderIds },
        status: { in: ['REQUESTED', 'APPROVED', 'REFUNDING'] },
      },
    });
    if (inflightRefund) {
      throw new BadRequestException('已有进行中的退款，请勿重复操作');
    }

    // 收集每个 Order 的真实 (companyId, orderId) 对
    // checkout 流（checkout.service.ts:1435 companyGroups 循环）保证一个 Order 的所有 items 共享同一 companyId
    // 所以只需 N 把锁，而非 N² —— 且 key 严格匹配卖家 generateWaybill
    const orderCompanyPairs = orders
      .map((o) => {
        const companyId = o.items[0]?.companyId as string | undefined;
        return companyId ? { companyId, orderId: o.id } : null;
      })
      .filter((p): p is { companyId: string; orderId: string } => p !== null)
      .sort((a, b) =>
        `${a.companyId}:${a.orderId}`.localeCompare(`${b.companyId}:${b.orderId}`),
      );

    // 通知用 — 去重的 companyIds
    const allCompanyIds = [
      ...new Set(orderCompanyPairs.map((p) => p.companyId)),
    ].sort();

    // Step 4：原子事务（Serializable + 与 generateWaybill 严格互斥）
    const refundData = await this.prisma.$transaction(async (tx) => {
      // 对每个 Order 实际的 (companyId, orderId) 取 advisory lock
      // 字典序保证多并发 cancel 互相不死锁；卖家 generateWaybill 单锁本就 subset of 此集合，无死锁
      for (const pair of orderCompanyPairs) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext('seller-waybill-order'),
            hashtext(${`${pair.companyId}:${pair.orderId}`})
          )
        `;
      }

      // 锁内复检 Shipment
      const shipmentCount = await tx.shipment.count({
        where: { orderId: { in: orderIds }, waybillNo: { not: null } },
      });
      if (shipmentCount > 0) {
        throw new BadRequestException('卖家已生成面单，请稍后重试或联系卖家');
      }

      // CAS 批量 PAID → CANCELED（必须全部更新成功）
      const cas = await tx.order.updateMany({
        where: { id: { in: orderIds }, userId, status: 'PAID' },
        data: { status: 'CANCELED' },
      });
      if (cas.count !== orders.length) {
        throw new BadRequestException('订单状态已变更，无法取消');
      }

      // 释放每个 Order 的库存
      for (const o of orders) {
        for (const item of o.items) {
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
              refId: o.id,
            },
          });
        }
      }

      // 恢复奖励账（VOIDED → AVAILABLE）— RewardLedger.refId 仅指 primary，
      // 用 IN 包含所有 orderId 即可命中
      await tx.rewardLedger.updateMany({
        where: { refType: 'ORDER', refId: { in: orderIds }, status: 'VOIDED' },
        data: { status: 'AVAILABLE', refType: null, refId: null },
      });

      // 恢复红包（CouponUsageRecord.orderId = primary，逐 Order 调即可
      // 仅 primary 那次会真正命中，其他 no-op）
      if (this.couponService?.restoreCouponsForOrder) {
        for (const o of orders) {
          await this.couponService.restoreCouponsForOrder(o.id, tx);
        }
      }

      // 每个 Order 创建独立 Refund 行 + 状态历史
      const refunds: Array<{
        refundId: string;
        refundAmount: number;
        merchantRefundNo: string;
        orderId: string;
      }> = [];
      for (const o of orders) {
        const refund = await tx.refund.create({
          data: {
            orderId: o.id,
            amount: o.totalAmount,
            status: 'REFUNDING',
            merchantRefundNo: `AUTO-CANCEL-${o.id}`,
            reason: '买家整 session 未发货取消订单',
          },
        });
        await tx.refundStatusHistory.create({
          data: {
            refundId: refund.id,
            toStatus: 'REFUNDING',
            remark: '买家整 session 取消触发自动退款',
            operatorId: userId,
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: o.id,
            fromStatus: 'PAID',
            toStatus: 'CANCELED',
            reason: '买家整 session 取消未发货订单',
          },
        });
        refunds.push({
          refundId: refund.id,
          refundAmount: o.totalAmount,
          merchantRefundNo: refund.merchantRefundNo,
          orderId: o.id,
        });
      }

      return {
        refunds,
        affectedCompanyIds: allCompanyIds,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    // Step 5：事务外逐笔调 alipay refund（任一失败 cron 兜底，不影响主流程）
    if (this.paymentService?.initiateRefund) {
      for (const r of refundData.refunds) {
        try {
          const result = await this.paymentService.initiateRefund(
            r.orderId,
            r.refundAmount,
            r.merchantRefundNo,
          );
          if (result?.success) {
            await this.prisma.$transaction(async (tx) => {
              await tx.refund.update({
                where: { id: r.refundId },
                data: {
                  status: 'REFUNDED',
                  providerRefundId: result.providerRefundId,
                },
              });
              await tx.refundStatusHistory.create({
                data: {
                  refundId: r.refundId,
                  fromStatus: 'REFUNDING',
                  toStatus: 'REFUNDED',
                  remark: '渠道退款成功',
                  operatorId: userId,
                },
              });
            });
          } else {
            this.logger.warn(
              `整 session 退款发起失败，cron 将重试: refundId=${r.refundId}, msg=${result?.message ?? 'unknown'}`,
            );
          }
        } catch (e: any) {
          this.logger.error(
            `整 session 退款调用异常（订单已取消，cron 将重试）: orderId=${r.orderId}, error=${e?.message ?? e}`,
          );
        }
      }
    } else {
      this.logger.warn(
        `paymentService 未注入，session ${sessionId} 已 CANCELED 但未发起退款（cron 将兜底）`,
      );
    }

    // Step 6：通知所有受影响商户的 OWNER
    if (this.inboxService?.send && refundData.affectedCompanyIds.length > 0) {
      try {
        const owners = await this.prisma.companyStaff.findMany({
          where: {
            companyId: { in: refundData.affectedCompanyIds },
            role: 'OWNER',
            status: 'ACTIVE',
          },
          select: { userId: true, companyId: true },
        });
        for (const owner of owners) {
          // 找该商户对应的 Order
          const ownerOrder = orders.find((o) =>
            o.items.some((i: any) => i.companyId === owner.companyId),
          );
          await this.inboxService.send({
            userId: owner.userId,
            category: 'order',
            type: 'order.canceled.by.buyer',
            title: '买家取消订单',
            content: `订单 ${ownerOrder?.id ?? '(未知)'} 已被买家在发货前取消（多商户整单），库存已恢复，款项原路退回`,
            target: ownerOrder ? { route: '/orders/[id]', params: { id: ownerOrder.id } } : undefined,
          });
        }
      } catch (e: any) {
        this.logger.warn(`通知商户失败（不影响主流程）: ${e?.message ?? e}`);
      }
    }

    // 返回 primary order（idx === 0）作为主响应
    const primary = await this.prisma.order.findUnique({
      where: { id: orders[0].id },
      include: { items: true },
    });
    return this.mapOrder(primary);
  }

  /** 映射为前端 Order 列表项 */
  private mapOrder(order: any, companyMap?: Map<string, { id: string; name: string; logoUrl: string | null }>) {
    const snapshot = (item: any) => {
      const ps = (item.productSnapshot as any) || {};
      const company = companyMap?.get(item.companyId);
      return {
        id: item.id,
        productId: ps.productId || item.skuId,
        skuId: item.skuId,
        title: ps.title || '',
        skuTitle: ps.skuTitle || '',           // 新增：SKU 规格名（用于淘宝展开风卡片）
        image: ps.image || '',
        price: item.unitPrice,
        quantity: item.quantity,
        companyId: item.companyId,             // 新增：商户 ID（多商户跳店铺/售后）
        companyName: company?.name,            // 新增：店铺名称（Phase 2，list() 批量 join）
        companyLogo: company?.logoUrl ?? null, // 新增：店铺 logo（Phase 2）
        isPrize: !!item.isPrize,               // 新增：是否奖品（前端区分样式 + 禁用售后）
        // 注：isPostReplacement 在 AfterSaleRequest 上，不在 OrderItem。
        //     Phase 2 通过反查 afterSaleRequests 派生。
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

    // hasRefundRecord 仍在下文 refund 兼容分支使用
    const hasRefundRecord = order.status === 'REFUNDED';

    // Phase 2 hotfix-3: 不再覆盖 status 为 'afterSale'
    // App 的 OrderStatus 是严格大写枚举（PAID/SHIPPED/.../REFUNDED）, 没有 'afterSale'
    // StatusHero 用 Record<OrderStatus, ...> 索引会拿到 undefined → 渲染崩
    // 售后状态由 afterSaleStatus 字段单独承载（App 已用 afterSaleStatus 路由 CTA）
    // list() 仍保留 'afterSale' 虚拟聚合 tab（仅作为请求 status 入参，不作为返回值）
    const frontStatus = order.status;

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
      refundSummary: this.mapRefundSummary(refund),
      returnWindowExpiresAt: order.returnWindowExpiresAt?.toISOString() || null,
      totalPrice: order.totalAmount,
      goodsAmount: order.goodsAmount,
      shippingFee: order.shippingFee,
      discountAmount: order.discountAmount,
      vipDiscountAmount: order.vipDiscountAmount ?? 0,
      totalCouponDiscount: order.totalCouponDiscount ?? 0,
      createdAt:
        order.createdAt instanceof Date
          ? order.createdAt.toISOString().slice(0, 16).replace('T', ' ')
          : order.createdAt,
      paidAt: order.paidAt?.toISOString() ?? null,
      shippedAt: this.earliestShippedAt(order.shipments) ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      autoReceiveAt: order.autoReceiveAt?.toISOString() ?? null,
      logisticsSummary: this.summarizeLatestEvent(order.shipments),
      repurchasable:
        order.status === 'RECEIVED' &&
        (order.bizType || 'NORMAL_GOODS') === 'NORMAL_GOODS' &&
        (order.items || []).some((item: any) => !item.isPrize),
      items: (order.items || []).map(snapshot),
    };
  }

  /** 映射为前端 Order 详情（含物流/售后/支付信息） */
  private mapOrderDetail(order: any, companyMap?: Map<string, { id: string; name: string; logoUrl: string | null }>) {
    const base = this.mapOrder(order, companyMap);
    const payment = order.payments?.[0];
    const addressSnapshot = decryptJsonValue(order.addressSnapshot);
    const addressSnapshotMasked = maskAddressSnapshot(addressSnapshot);
    const logistics = this.summarizeShipments(order.shipments);

    // 售后相关字段已由 mapOrder() 统一处理（afterSaleStatus/afterSaleReason/afterSaleType）

    // 暴露给前端的结构化 + 已拼接的脱敏地址块（避免前端手动拼 fullAddress）
    const masked: any = addressSnapshotMasked;
    const address = masked
      ? {
          recipientName: masked.recipientName || '',          // 已脱敏 ("张*")
          recipientPhone: masked.phone || '',                 // 已脱敏 ("138****8888")
          fullAddress: [masked.province, masked.city, masked.district, masked.detail]
            .filter(Boolean)
            .join(' '),
        }
      : null;

    return {
      ...base,
      addressSnapshot,
      addressSnapshotMasked,
      address,
      goodsAmount: order.goodsAmount,
      shippingFee: order.shippingFee,
      discountAmount: order.discountAmount,
      vipDiscountAmount: order.vipDiscountAmount ?? 0,
      totalCouponDiscount: order.totalCouponDiscount ?? 0,
      paidAt: order.paidAt?.toISOString() || null,
      paymentMethod: payment
        ? payment.channel === 'WECHAT_PAY'
          ? 'wechat'
          : payment.channel === 'UNIONPAY'
            ? 'bankcard'
            : 'alipay'
        : undefined,
      buyerNote: order.buyerNote ?? null,
      logisticsStatus: logistics.logisticsStatus,
      trackingNo: logistics.trackingNo,
      trackingNoMasked: logistics.trackingNoMasked,
      trackingEvents: logistics.trackingEvents,
      shipments: logistics.shipments,
      statusHistory: (order.statusHistory || []).map((h: any) => ({
        from: h.fromStatus,
        to: h.toStatus,
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
