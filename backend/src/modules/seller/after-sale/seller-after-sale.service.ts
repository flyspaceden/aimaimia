import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AfterSaleOperatorType, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { decryptJsonValue } from '../../../common/security/encryption';
import { parseChineseAddress } from '../../../common/utils/parse-region';
import {
  filterContactInfo,
  maskIp,
} from '../../../common/security/privacy-mask';
import {
  CarrierWaybillAddress,
  SellerShippingService,
} from '../shipping/seller-shipping.service';
import { PaymentService } from '../../payment/payment.service';
import { AfterSaleRewardService } from '../../after-sale/after-sale-reward.service';
import { AfterSaleRefundService } from '../../after-sale/after-sale-refund.service';
import { AfterSaleStatusHistoryService } from '../../after-sale/after-sale-status-history.service';
import { SfExpressService } from '../../shipment/sf-express.service';
import { InboxService } from '../../inbox/inbox.service';
import { createHmac, timingSafeEqual } from 'crypto';

/** P2034 序列化冲突重试次数 */
const MAX_RETRIES = 3;

function isExchangeAfterSaleType(type: string) {
  return type === 'QUALITY_EXCHANGE' || type === 'NO_REASON_EXCHANGE';
}

@Injectable()
export class SellerAfterSaleService {
  private readonly logger = new Logger(SellerAfterSaleService.name);
  private readonly apiPrefix: string;
  private readonly hmacSecret: string;
  private static readonly WAYBILL_LOCK_NAMESPACE = 'seller-waybill-after-sale';

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private shippingService: SellerShippingService,
    private paymentService: PaymentService,
    private afterSaleRewardService: AfterSaleRewardService,
    private inboxService: InboxService,
    private afterSaleRefundService: AfterSaleRefundService,
    private afterSaleStatusHistory: AfterSaleStatusHistoryService,
    private sfExpress: SfExpressService,
  ) {
    this.apiPrefix = this.configService.get<string>('API_PREFIX', '/api/v1');
    this.hmacSecret = this.configService.getOrThrow<string>('SELLER_JWT_SECRET');
  }

  // ========== 数据隔离 ==========

  /**
   * 权限校验：确认该售后申请的商品项属于当前公司
   * AfterSaleRequest 必须关联 orderItemId，通过 orderItem.companyId 鉴权
   */
  private assertCompanyOwnsRequest(
    companyId: string,
    request: {
      orderItemId?: string | null;
      order: { items: Array<{ id?: string; companyId: string }> };
    },
  ) {
    if (request.orderItemId) {
      const targetItem = request.order.items.find(
        (i) => i.id === request.orderItemId,
      );
      if (!targetItem || targetItem.companyId !== companyId) {
        throw new ForbiddenException('无权操作该售后申请');
      }
      return;
    }

    // 整单售后（orderItemId=null）
    const hasOwnItem = request.order.items.some(
      (i) => i.companyId === companyId,
    );
    const hasForeignItem = request.order.items.some(
      (i) => i.companyId !== companyId,
    );
    if (!hasOwnItem) {
      throw new ForbiddenException('无权操作该售后申请');
    }
    if (hasForeignItem) {
      throw new ForbiddenException('该售后包含其他企业商品，请联系平台仲裁');
    }
  }

  /**
   * 批量查询买家匿名编号
   */
  private async getBuyerAliasMap(
    userIds: string[],
    companyId: string,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const aliases = await this.prisma.buyerAlias.findMany({
      where: { userId: { in: userIds }, companyId },
      select: { userId: true, alias: true },
    });
    return new Map(aliases.map((a) => [a.userId, a.alias]));
  }

  // ========== 列表查询 ==========

  /** 我公司的售后申请列表（排除 isPostReplacement=true，这类直接进平台仲裁） */
  async findAll(
    companyId: string,
    page = 1,
    pageSize = 20,
    status?: string,
    afterSaleType?: string,
    staffId?: string,
    id?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {
      isPostReplacement: false,
      OR: [
        // 指定商品项：仅返回该商品项属于本公司的申请
        { orderItem: { is: { companyId } } },
        // 整单售后：仅返回整单都属于本公司的申请
        {
          orderItemId: null,
          order: {
            items: {
              some: { companyId },
              none: { companyId: { not: companyId } },
            },
          },
        },
      ],
    };

    // 按售后单号模糊匹配（用户从详情/通知里复制完整或末几位都能搜）
    const idQuery = id?.trim();
    if (idQuery) {
      where.id = { contains: idQuery };
    }

    if (status) {
      const statusList = status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statusList.length === 1) {
        where.status = statusList[0];
      } else if (statusList.length > 1) {
        where.status = { in: statusList };
      }
    }

    if (afterSaleType) {
      where.afterSaleType = afterSaleType;
    }

    const [items, total] = await Promise.all([
      this.prisma.afterSaleRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, status: true, totalAmount: true } },
          orderItem: {
            select: {
              id: true,
              productSnapshot: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      }),
      this.prisma.afterSaleRequest.count({ where }),
    ]);

    // 批量查询买家匿名编号
    const userIds = [...new Set(items.map((r) => r.userId))];
    const aliasMap = await this.getBuyerAliasMap(userIds, companyId);

    return {
      items: items.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        orderItemId: r.orderItemId,
        afterSaleType: r.afterSaleType,
        reasonType: r.reasonType,
        reason:
          !r.reasonType || r.reasonType === 'OTHER'
            ? filterContactInfo(r.reason)
            : undefined,
        photos: r.photos,
        status: r.status,
        requiresReturn: r.requiresReturn,
        refundAmount: r.refundAmount,
        reviewNote: r.reviewNote
          ? filterContactInfo(r.reviewNote)
          : undefined,
        // 退货物流（卖家收件需完整单号去顺丰官网查物流，不脱敏）
        returnCarrierName: r.returnCarrierName,
        returnWaybillNo: r.returnWaybillNo || undefined,
        // 换货物流（卖家自己发出的运单，不脱敏）
        replacementCarrierName: r.replacementCarrierName,
        replacementWaybillNo: r.replacementWaybillNo || undefined,
        replacementWaybillPrintUrl:
          r.replacementWaybillNo && staffId
            ? this.getWaybillPrintUrl(companyId, r.id, staffId)
            : undefined,
        createdAt: r.createdAt,
        buyerAlias: aliasMap.get(r.userId) || '买家',
        order: r.order,
        orderItem: r.orderItem,
      })),
      total,
      page,
      pageSize,
    };
  }

  // ========== 详情查询 ==========

  /** 售后详情 */
  async findById(companyId: string, id: string, staffId?: string) {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            items: { select: { id: true, companyId: true } },
          },
        },
        orderItem: {
          select: {
            id: true,
            productSnapshot: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

    this.assertCompanyOwnsRequest(companyId, request as any);

    // 查询买家匿名编号
    const alias = await this.prisma.buyerAlias.findUnique({
      where: {
        userId_companyId: { userId: request.userId, companyId },
      },
      select: { alias: true },
    });

    // 物流轨迹（仅 requiresReturn=true 时查）：优先用 DB 里推送落库的（callback
    // fallback 写入），没有再 fallback 到主动查询 SEARCH_ROUTES
    const shouldQuery = request.requiresReturn;
    const buildFromDb = (events: any): { status: string; rawOpCode: string; events: any[] } | null => {
      const arr = Array.isArray(events) ? events : null;
      if (!arr || arr.length === 0) return null;
      const latest = arr[arr.length - 1] ?? {};
      return {
        status: String(latest.statusCode ?? 'IN_TRANSIT'),
        rawOpCode: String(latest.opCode ?? ''),
        events: arr,
      };
    };
    const dbReturn = shouldQuery ? buildFromDb((request as any).returnTrackingEvents) : null;
    const dbSellerReturn = shouldQuery ? buildFromDb((request as any).sellerReturnTrackingEvents) : null;
    const dbReplacement = shouldQuery ? buildFromDb((request as any).replacementTrackingEvents) : null;

    const [returnRoute, sellerReturnRoute, replacementRoute] = await Promise.all([
      dbReturn
        ? Promise.resolve(dbReturn)
        : shouldQuery && request.returnWaybillNo
          ? this.sfExpress.queryRoutes(request.returnWaybillNo).catch(() => null)
          : Promise.resolve(null),
      dbSellerReturn
        ? Promise.resolve(dbSellerReturn)
        : shouldQuery && request.sellerReturnWaybillNo
          ? this.sfExpress.queryRoutes(request.sellerReturnWaybillNo).catch(() => null)
          : Promise.resolve(null),
      dbReplacement
        ? Promise.resolve(dbReplacement)
        : shouldQuery && request.replacementWaybillNo
          ? this.sfExpress.queryRoutes(request.replacementWaybillNo).catch(() => null)
          : Promise.resolve(null),
    ]);

    // 顺丰 UAT 沙箱"全流程调测"对所有 mailNo 返回相同样例轨迹（多在 2025-10），
    // 必须按面单生成时间过滤掉早于基准时间的事件防止污染卖家展示。
    const filterStaleEvents = (
      route: typeof returnRoute,
      referenceTime: Date | null,
    ) => {
      if (!route || !route.events?.length || !referenceTime) return route;
      const earliestAllowed = referenceTime.getTime() - 60 * 60 * 1000;
      const freshEvents = route.events.filter((e: any) => {
        const t = new Date(e.time).getTime();
        return Number.isFinite(t) ? t >= earliestAllowed : true;
      });
      if (freshEvents.length !== route.events.length) {
        this.logger.warn(
          `过滤 SF 沙箱旧路由(seller): afterSaleId=${request.id}, dropped=${route.events.length - freshEvents.length}, kept=${freshEvents.length}`,
        );
      }
      return { ...route, events: freshEvents };
    };

    const returnRefTime = request.returnShippedAt ?? request.approvedAt ?? request.createdAt;
    const refTimeFallback = request.updatedAt ?? request.createdAt;
    const filteredReturn = filterStaleEvents(returnRoute, returnRefTime);
    const filteredSellerReturn = filterStaleEvents(sellerReturnRoute, refTimeFallback);
    const filteredReplacement = filterStaleEvents(replacementRoute, refTimeFallback);

    return {
      id: request.id,
      orderId: request.orderId,
      orderItemId: request.orderItemId,
      afterSaleType: request.afterSaleType,
      reasonType: request.reasonType,
      reason:
        !request.reasonType || request.reasonType === 'OTHER'
          ? filterContactInfo(request.reason)
          : undefined,
      photos: request.photos,
      status: request.status,
      isPostReplacement: request.isPostReplacement,
      requiresReturn: request.requiresReturn,
      refundAmount: request.refundAmount,
      reviewerId: request.reviewerId,
      reviewNote: request.reviewNote
        ? filterContactInfo(request.reviewNote)
        : undefined,
      reviewedAt: request.reviewedAt,
      approvedAt: request.approvedAt,
      sellerReceivedAt: request.sellerReceivedAt,
      // 卖家拒收信息
      sellerRejectReason: request.sellerRejectReason,
      sellerRejectPhotos: request.sellerRejectPhotos,
      sellerReturnCarrierName: request.sellerReturnCarrierName,
      sellerReturnWaybillNo: request.sellerReturnWaybillNo || undefined,
      sellerReturnWaybillUrl: request.sellerReturnWaybillUrl,
      // 退货物流（卖家需完整单号查物流，不脱敏）
      returnCarrierName: request.returnCarrierName,
      returnWaybillNo: request.returnWaybillNo || undefined,
      returnShippedAt: request.returnShippedAt,
      // 顺丰实时轨迹（已过滤沙箱旧路由污染；requiresReturn=false 时为 null）
      returnTracking: filteredReturn,
      sellerReturnTracking: filteredSellerReturn,
      replacementTracking: filteredReplacement,
      // 换货物流（卖家自己发出的，不脱敏）
      replacementCarrierName: request.replacementCarrierName,
      replacementWaybillNo: request.replacementWaybillNo || undefined,
      replacementWaybillPrintUrl:
        request.replacementWaybillNo && staffId
          ? this.getWaybillPrintUrl(companyId, id, staffId)
          : undefined,
      replacementShipmentId: request.replacementShipmentId,
      createdAt: request.createdAt,
      buyerAlias: alias?.alias || '买家',
      order: request.order
        ? {
            id: request.order.id,
            status: request.order.status,
            totalAmount: request.order.totalAmount,
          }
        : null,
      orderItem: request.orderItem,
    };
  }

  /** 售后状态时间线（校验企业归属） */
  async getTimeline(companyId: string, id: string) {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            items: { select: { id: true, companyId: true } },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

    this.assertCompanyOwnsRequest(companyId, request as any);

    const rows = await this.prisma.afterSaleStatusHistory.findMany({
      where: { afterSaleId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        operatorType: true,
        createdAt: true,
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        reason: row.reason,
        operatorType: row.operatorType,
        createdAt: row.createdAt,
      })),
    };
  }

  // ========== 开始审核 ==========

  /** 开始审核（REQUESTED → UNDER_REVIEW） */
  async startReview(
    companyId: string,
    staffId: string,
    id: string,
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const request = await tx.afterSaleRequest.findUnique({
              where: { id },
              include: {
                order: {
                  include: {
                    items: { select: { id: true, companyId: true } },
                  },
                },
              },
            });
            if (!request) throw new NotFoundException('售后申请不存在');

            this.assertCompanyOwnsRequest(companyId, request as any);

            if (request.status !== 'REQUESTED') {
              throw new BadRequestException('仅待处理申请可标记为审核中');
            }

            const cas = await tx.afterSaleRequest.updateMany({
              where: { id, status: 'REQUESTED' },
              data: {
                status: 'UNDER_REVIEW',
                reviewerId: staffId,
                reviewedAt: new Date(),
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }
            await this.afterSaleStatusHistory.create(tx, {
              afterSaleId: id,
              fromStatus: request.status,
              toStatus: 'UNDER_REVIEW',
              reason: '卖家开始审核',
              operatorType: AfterSaleOperatorType.SELLER_STAFF,
              operatorId: staffId,
            });

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return result;
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `startReview 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${id}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new BadRequestException('操作失败，请稍后重试');
  }

  // ========== 审核通过 ==========

  /**
   * 审核通过（REQUESTED/UNDER_REVIEW → APPROVED）
   *
   * 如果 requiresReturn=false 且为退货类型（NO_REASON_RETURN / QUALITY_RETURN）：
   *   → 自动触发退款：创建 Refund 记录 + 调用 PaymentService.initiateRefund()
   *   → 退款成功则 status → REFUNDED，失败则 status → REFUNDING（等待补偿任务重试）
   *
   * 如果 requiresReturn=false 且为换货类型（NO_REASON_EXCHANGE / QUALITY_EXCHANGE）：
   *   → 停留在 APPROVED，等待卖家发货
   */
  async approve(
    companyId: string,
    staffId: string,
    id: string,
    note?: string,
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        let shouldStartRefund = false;
        const result = await this.prisma.$transaction(
          async (tx) => {
            const request = await tx.afterSaleRequest.findUnique({
              where: { id },
              include: {
                order: {
                  include: {
                    items: { select: { id: true, companyId: true } },
                  },
                },
              },
            });
            if (!request) throw new NotFoundException('售后申请不存在');

            this.assertCompanyOwnsRequest(companyId, request as any);

            if (
              request.status !== 'REQUESTED' &&
              request.status !== 'UNDER_REVIEW'
            ) {
              throw new BadRequestException('该申请状态不允许审核');
            }

            // CAS 原子更新
            const cas = await tx.afterSaleRequest.updateMany({
              where: {
                id,
                status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
              },
              data: {
                status: 'APPROVED',
                reviewerId: staffId,
                reviewNote: note,
                reviewedAt: new Date(),
                approvedAt: new Date(),
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }
            await this.afterSaleStatusHistory.create(tx, {
              afterSaleId: id,
              fromStatus: request.status,
              toStatus: 'APPROVED',
              reason: note || '卖家审核通过',
              operatorType: AfterSaleOperatorType.SELLER_STAFF,
              operatorId: staffId,
            });

            // 无需退回商品 + 退货退款类型 → 自动触发退款
            if (
              !request.requiresReturn &&
              (request.afterSaleType === 'NO_REASON_RETURN' ||
                request.afterSaleType === 'QUALITY_RETURN')
            ) {
              shouldStartRefund = true;
            }
            // 无需退回 + 换货：停留在 APPROVED，等卖家发货

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (shouldStartRefund) {
          await this.afterSaleRefundService.startRefund(id, {
            type: 'SELLER_STAFF',
            id: staffId,
          });
          return this.prisma.afterSaleRequest.findUnique({ where: { id } });
        }
        return result;
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `approve 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${id}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new BadRequestException('操作失败，请稍后重试');
  }

  // ========== 驳回 ==========

  /** 驳回（REQUESTED/UNDER_REVIEW → REJECTED） */
  async reject(
    companyId: string,
    staffId: string,
    id: string,
    reason: string,
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const request = await tx.afterSaleRequest.findUnique({
              where: { id },
              include: {
                order: {
                  include: {
                    items: { select: { id: true, companyId: true } },
                  },
                },
              },
            });
            if (!request) throw new NotFoundException('售后申请不存在');

            this.assertCompanyOwnsRequest(companyId, request as any);

            if (
              request.status !== 'REQUESTED' &&
              request.status !== 'UNDER_REVIEW'
            ) {
              throw new BadRequestException('该申请状态不允许驳回');
            }

            const cas = await tx.afterSaleRequest.updateMany({
              where: {
                id,
                status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
              },
              data: {
                status: 'REJECTED',
                reviewerId: staffId,
                reviewNote: reason,
                reviewedAt: new Date(),
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }
            await this.afterSaleStatusHistory.create(tx, {
              afterSaleId: id,
              fromStatus: request.status,
              toStatus: 'REJECTED',
              reason,
              operatorType: AfterSaleOperatorType.SELLER_STAFF,
              operatorId: staffId,
            });

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return result;
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `reject 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${id}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new BadRequestException('操作失败，请稍后重试');
  }

  // ========== 确认收到退货 ==========

  /**
   * 卖家确认收到退货（RETURN_SHIPPING → RECEIVED_BY_SELLER）
   *
   * 如果 afterSaleType 是退货退款（NO_REASON_RETURN / QUALITY_RETURN）：
   *   → 自动触发退款流程
   *
   * 如果 afterSaleType 是换货（NO_REASON_EXCHANGE / QUALITY_EXCHANGE）：
   *   → 停留在 RECEIVED_BY_SELLER，等待卖家发货
   */
  async confirmReceiveReturn(
    companyId: string,
    staffId: string,
    id: string,
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        let shouldStartRefund = false;
        const result = await this.prisma.$transaction(
          async (tx) => {
            const request = await tx.afterSaleRequest.findUnique({
              where: { id },
              include: {
                order: {
                  include: {
                    items: { select: { id: true, companyId: true } },
                  },
                },
              },
            });
            if (!request) throw new NotFoundException('售后申请不存在');

            this.assertCompanyOwnsRequest(companyId, request as any);

            if (request.status !== 'RETURN_SHIPPING') {
              throw new BadRequestException('仅退货寄回中的申请可确认收货');
            }

            const cas = await tx.afterSaleRequest.updateMany({
              where: { id, status: 'RETURN_SHIPPING' },
              data: {
                status: 'RECEIVED_BY_SELLER',
                sellerReceivedAt: new Date(),
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }
            await this.afterSaleStatusHistory.create(tx, {
              afterSaleId: id,
              fromStatus: request.status,
              toStatus: 'RECEIVED_BY_SELLER',
              reason: '卖家确认收到退货',
              operatorType: AfterSaleOperatorType.SELLER_STAFF,
              operatorId: staffId,
            });

            // 退货退款类型 → 自动触发退款
            if (
              request.afterSaleType === 'NO_REASON_RETURN' ||
              request.afterSaleType === 'QUALITY_RETURN'
            ) {
              shouldStartRefund = true;
            }
            // 换货：停留在 RECEIVED_BY_SELLER，等卖家发货

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (shouldStartRefund) {
          await this.afterSaleRefundService.startRefund(id, {
            type: 'SELLER_STAFF',
            id: staffId,
          });
          return this.prisma.afterSaleRequest.findUnique({ where: { id } });
        }
        return result;
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `confirmReceiveReturn 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${id}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new BadRequestException('操作失败，请稍后重试');
  }

  // ========== 拒收退货 ==========

  /** 卖家验收退货不合格（RECEIVED_BY_SELLER → SELLER_REJECTED_RETURN） */
  async rejectReturn(
    companyId: string,
    staffId: string,
    id: string,
    reason: string,
    photos: string[],
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const request = await tx.afterSaleRequest.findUnique({
              where: { id },
              include: {
                order: {
                  include: {
                    items: { select: { id: true, companyId: true } },
                  },
                },
              },
            });
            if (!request) throw new NotFoundException('售后申请不存在');

            this.assertCompanyOwnsRequest(companyId, request as any);

            if (request.status !== 'RECEIVED_BY_SELLER') {
              throw new BadRequestException(
                '仅已收到退货的申请可驳回退货',
              );
            }

            const cas = await tx.afterSaleRequest.updateMany({
              where: { id, status: 'RECEIVED_BY_SELLER' },
              data: {
                status: 'SELLER_REJECTED_RETURN',
                sellerRejectReason: reason,
                sellerRejectPhotos: photos,
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }
            await this.afterSaleStatusHistory.create(tx, {
              afterSaleId: id,
              fromStatus: request.status,
              toStatus: 'SELLER_REJECTED_RETURN',
              reason,
              operatorType: AfterSaleOperatorType.SELLER_STAFF,
              operatorId: staffId,
            });

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `rejectReturn 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${id}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new BadRequestException('操作失败，请稍后重试');
  }

  // ========== 换货发货 ==========

  /** 卖家发出换货商品（APPROVED/RECEIVED_BY_SELLER → REPLACEMENT_SHIPPED） */
  async ship(companyId: string, staffId: string, id: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const request = await tx.afterSaleRequest.findUnique({
              where: { id },
              include: {
                order: {
                  include: {
                    items: { select: { id: true, companyId: true } },
                  },
                },
              },
            });
            if (!request) throw new NotFoundException('售后申请不存在');

            this.assertCompanyOwnsRequest(companyId, request as any);

            if (!isExchangeAfterSaleType(request.afterSaleType)) {
              throw new BadRequestException('仅换货类型的售后可执行发货操作');
            }

            if (
              request.status !== 'APPROVED' &&
              request.status !== 'RECEIVED_BY_SELLER'
            ) {
              throw new BadRequestException(
                '仅已审批通过或已收到退货的换货可发货',
              );
            }

            // 防呆：APPROVED + 需寄回 → 必须等买家寄回并卖家确认收到才能发货，
            // 否则会出现"卖家发了新货但买家不寄回旧货"的资金风险
            if (request.status === 'APPROVED' && request.requiresReturn) {
              throw new BadRequestException(
                '需要等买家寄回退货并确认收到后才能发换货',
              );
            }

            if (!request.replacementWaybillNo) {
              throw new BadRequestException(
                '请先生成换货电子面单后再确认发货',
              );
            }

            // CAS 确保状态安全
            const cas = await tx.afterSaleRequest.updateMany({
              where: {
                id,
                status: { in: ['APPROVED', 'RECEIVED_BY_SELLER'] },
                afterSaleType: { in: ['QUALITY_EXCHANGE', 'NO_REASON_EXCHANGE'] },
              },
              data: {
                status: 'REPLACEMENT_SHIPPED',
                replacementShipmentId: request.replacementWaybillNo,
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }
            await this.afterSaleStatusHistory.create(tx, {
              afterSaleId: id,
              fromStatus: request.status,
              toStatus: 'REPLACEMENT_SHIPPED',
              reason: '卖家发出换货商品',
              operatorType: AfterSaleOperatorType.SELLER_STAFF,
              operatorId: staffId,
              meta: { replacementWaybillNo: request.replacementWaybillNo },
            });

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `ship 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${id}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new BadRequestException('操作失败，请稍后重试');
  }

  // ========== 电子面单 ==========

  /** 生成换货电子面单 */
  async generateWaybill(
    companyId: string,
    staffId: string,
    id: string,
    carrierCode: string,
  ) {
    let createdWaybill: { carrierCode: string; waybillNo: string; sfOrderId?: string } | null =
      null;

    const context = await this.prisma.$transaction(
      async (tx) => {
        await this.acquireWaybillGenerationLock(tx, `${companyId}:${id}`);

        const request = await tx.afterSaleRequest.findUnique({
          where: { id },
          include: {
            order: {
              include: {
                items: {
                  include: {
                    sku: {
                      include: {
                        product: { select: { title: true } },
                      },
                    },
                  },
                },
              },
            },
            orderItem: {
              include: {
                sku: {
                  include: {
                    product: { select: { title: true } },
                  },
                },
              },
            },
          },
        });
        if (!request) throw new NotFoundException('售后申请不存在');

        this.assertCompanyOwnsRequest(companyId, request as any);

        if (!isExchangeAfterSaleType(request.afterSaleType)) {
          throw new BadRequestException('仅换货类型的售后可生成面单');
        }

        if (
          request.status !== 'APPROVED' &&
          request.status !== 'RECEIVED_BY_SELLER'
        ) {
          throw new BadRequestException(
            '仅审核通过或已收到退货的换货可生成面单',
          );
        }

        // 防呆：APPROVED + 需寄回 → 必须等买家寄回并卖家确认收到才能生成换货面单
        if (request.status === 'APPROVED' && request.requiresReturn) {
          throw new BadRequestException(
            '需要等买家寄回退货并确认收到后才能生成换货面单',
          );
        }

        if (request.replacementWaybillNo) {
          throw new BadRequestException(
            '该售后已生成面单，请勿重复操作',
          );
        }

        const items = this.resolveWaybillItems(request as any, companyId);
        if (items.length === 0) {
          throw new BadRequestException('未找到可生成面单的商品');
        }

        return {
          addressSnapshot: request.order.addressSnapshot,
          items,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    try {
      const waybill = await this.shippingService.createCarrierWaybill(
        companyId,
        `AS_${id}`,
        carrierCode,
        context.addressSnapshot,
        context.items,
      );
      createdWaybill = {
        carrierCode: waybill.carrierCode,
        waybillNo: waybill.waybillNo,
        sfOrderId: waybill.sfOrderId,
      };

      const persisted = await this.prisma.$transaction(
        async (tx) => {
          await this.acquireWaybillGenerationLock(tx, `${companyId}:${id}`);

          const cas = await tx.afterSaleRequest.updateMany({
            where: {
              id,
              status: { in: ['APPROVED', 'RECEIVED_BY_SELLER'] },
              replacementWaybillNo: null,
            },
            data: {
              replacementCarrierCode: waybill.carrierCode,
              replacementCarrierName: waybill.carrierName,
              replacementWaybillNo: waybill.waybillNo,
              replacementWaybillUrl: waybill.waybillUrl,
              replacementSfOrderId: waybill.sfOrderId,
            },
          });

          if (cas.count === 0) {
            const existing = await tx.afterSaleRequest.findUnique({
              where: { id },
              select: {
                replacementCarrierCode: true,
                replacementCarrierName: true,
                replacementWaybillNo: true,
                replacementWaybillUrl: true,
              },
            });
            if (existing?.replacementWaybillNo === waybill.waybillNo) {
              return existing;
            }
            throw new BadRequestException('该售后已生成面单，请勿重复操作');
          }

          return {
            replacementCarrierCode: waybill.carrierCode,
            replacementCarrierName: waybill.carrierName,
            replacementWaybillNo: waybill.waybillNo,
            replacementWaybillUrl: waybill.waybillUrl,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      createdWaybill = null;

      return {
        ok: true,
        // 卖家自己生成的换货面单，需完整单号查物流，不脱敏
        waybillNo: persisted.replacementWaybillNo,
        waybillPrintUrl: this.getWaybillPrintUrl(
          companyId,
          id,
          staffId,
        ),
        carrierCode: persisted.replacementCarrierCode,
        carrierName: persisted.replacementCarrierName,
      };
    } catch (error) {
      await this.rollbackCreatedWaybill(createdWaybill);
      throw error;
    }
  }

  /** 生成卖家拒收退货后的回寄电子面单（卖家 → 买家） */
  async generateSellerReturnWaybill(
    companyId: string,
    staffId: string,
    id: string,
    carrierCode = 'SF',
  ) {
    let createdWaybill: { carrierCode: string; waybillNo: string; sfOrderId?: string } | null =
      null;

    const context = await this.prisma.$transaction(
      async (tx) => {
        await this.acquireWaybillGenerationLock(tx, `seller-return:${companyId}:${id}`);

        const request = await tx.afterSaleRequest.findUnique({
          where: { id },
          include: {
            order: {
              include: {
                items: {
                  include: {
                    sku: {
                      include: {
                        product: {
                          include: {
                            company: {
                              select: {
                                id: true,
                                name: true,
                                servicePhone: true,
                                address: true,
                                contact: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            orderItem: {
              include: {
                sku: {
                  include: {
                    product: {
                      include: {
                        company: {
                          select: {
                            id: true,
                            name: true,
                            servicePhone: true,
                            address: true,
                            contact: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        if (!request) throw new NotFoundException('售后申请不存在');

        this.assertCompanyOwnsRequest(companyId, request as any);

        if (request.status !== 'SELLER_REJECTED_RETURN') {
          throw new BadRequestException('仅卖家验收退货不合格的申请可生成回寄面单');
        }
        if (request.sellerReturnWaybillNo) {
          throw new BadRequestException('该售后已生成卖家回寄面单，请勿重复操作');
        }

        const items = this.resolveWaybillItems(request as any, companyId);
        if (items.length === 0) {
          throw new BadRequestException('未找到可生成面单的商品');
        }

        const company =
          request.orderItem?.sku?.product?.company ||
          request.order.items.find((item: any) => item.companyId === companyId)
            ?.sku?.product?.company;
        if (!company) {
          throw new BadRequestException('未找到商家退货地址信息');
        }

        return {
          sender: this.buildCompanyWaybillAddress(company),
          receiver: this.parseBuyerAddress(request.order.addressSnapshot),
          items,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    try {
      const waybill = await this.shippingService.createCarrierWaybillWithAddresses({
        companyId,
        bizNo: `AS_REJECT_RETURN_${id}`,
        carrierCode,
        sender: context.sender,
        receiver: context.receiver,
        items: context.items,
      });
      createdWaybill = {
        carrierCode: waybill.carrierCode,
        waybillNo: waybill.waybillNo,
        sfOrderId: waybill.sfOrderId,
      };

      const persisted = await this.prisma.$transaction(
        async (tx) => {
          await this.acquireWaybillGenerationLock(tx, `seller-return:${companyId}:${id}`);

          const cas = await tx.afterSaleRequest.updateMany({
            where: {
              id,
              status: 'SELLER_REJECTED_RETURN',
              sellerReturnWaybillNo: null,
            },
            data: {
              sellerReturnCarrierCode: waybill.carrierCode,
              sellerReturnCarrierName: waybill.carrierName,
              sellerReturnWaybillNo: waybill.waybillNo,
              sellerReturnWaybillUrl: waybill.waybillUrl,
              sellerReturnSfOrderId: waybill.sfOrderId,
            },
          });

          if (cas.count === 0) {
            const existing = await tx.afterSaleRequest.findUnique({
              where: { id },
              select: {
                sellerReturnCarrierCode: true,
                sellerReturnCarrierName: true,
                sellerReturnWaybillNo: true,
                sellerReturnWaybillUrl: true,
              },
            });
            if (existing?.sellerReturnWaybillNo === waybill.waybillNo) {
              return existing;
            }
            throw new BadRequestException('该售后已生成卖家回寄面单，请勿重复操作');
          }

          return {
            sellerReturnCarrierCode: waybill.carrierCode,
            sellerReturnCarrierName: waybill.carrierName,
            sellerReturnWaybillNo: waybill.waybillNo,
            sellerReturnWaybillUrl: waybill.waybillUrl,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      createdWaybill = null;

      return {
        ok: true,
        // 卖家拒收回寄面单，需完整单号查物流，不脱敏
        waybillNo: persisted.sellerReturnWaybillNo,
        waybillUrl: persisted.sellerReturnWaybillUrl,
        carrierCode: persisted.sellerReturnCarrierCode,
        carrierName: persisted.sellerReturnCarrierName,
      };
    } catch (error) {
      await this.rollbackCreatedWaybill(createdWaybill);
      throw error;
    }
  }

  /** 获取面单打印数据 */
  async getWaybillPrintData(companyId: string, id: string) {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: { items: { select: { id: true, companyId: true } } },
        },
      },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

    this.assertCompanyOwnsRequest(companyId, request as any);

    if (!request.replacementWaybillNo || !request.replacementWaybillUrl) {
      throw new NotFoundException('该售后未生成电子面单');
    }

    return {
      replacementWaybillNo: request.replacementWaybillNo,
      replacementWaybillUrl: request.replacementWaybillUrl,
    };
  }

  /** 取消面单 */
  async cancelWaybill(companyId: string, id: string) {
    // 1. 读取售后申请信息（事务外，用于远端取消）
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            items: { select: { id: true, companyId: true } },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

    this.assertCompanyOwnsRequest(companyId, request as any);

    if (
      request.status !== 'APPROVED' &&
      request.status !== 'RECEIVED_BY_SELLER'
    ) {
      throw new BadRequestException('当前状态不可取消面单');
    }
    if (!request.replacementWaybillNo) {
      throw new BadRequestException('该售后未生成面单，无法取消');
    }

    // 2. 先调顺丰取消（best-effort）
    await this.shippingService.cancelCarrierWaybill(
      request.replacementSfOrderId || '',
      request.replacementWaybillNo,
    );

    // 3. 远端取消后，清空本地记录
    await this.prisma.$transaction(
      async (tx) => {
        const cas = await tx.afterSaleRequest.updateMany({
          where: {
            id,
            status: { in: ['APPROVED', 'RECEIVED_BY_SELLER'] },
            replacementWaybillNo: request.replacementWaybillNo,
          },
          data: {
            replacementCarrierCode: null,
            replacementCarrierName: null,
            replacementWaybillNo: null,
            replacementWaybillUrl: null,
            replacementSfOrderId: null,
          },
        });

        if (cas.count === 0) {
          throw new BadRequestException(
            '该售后面单状态已变更，请刷新后重试',
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { ok: true };
  }

  // ========== 统计 ==========

  /** 按状态统计售后数量（排除 isPostReplacement） */
  async getStats(companyId: string) {
    const baseWhere: any = {
      isPostReplacement: false,
      OR: [
        { orderItem: { is: { companyId } } },
        {
          orderItemId: null,
          order: {
            items: {
              some: { companyId },
              none: { companyId: { not: companyId } },
            },
          },
        },
      ],
    };

    // 使用 groupBy 一次性查询所有状态的计数
    const groups = await this.prisma.afterSaleRequest.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { status: true },
    });

    const stats: Record<string, number> = {};
    for (const g of groups) {
      stats[g.status] = g._count.status;
    }

    return stats;
  }

  // ========== 面单签名 / 审计 ==========

  getWaybillPrintUrl(
    companyId: string,
    afterSaleId: string,
    staffId: string,
  ) {
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const payload = `${companyId}:${afterSaleId}:${staffId}:${expiresAt}`;
    const signature = createHmac('sha256', this.hmacSecret)
      .update(payload)
      .digest('hex');
    return `${this.apiPrefix}/seller/after-sale/${afterSaleId}/waybill/print?companyId=${encodeURIComponent(companyId)}&staffId=${encodeURIComponent(staffId)}&expires=${expiresAt}&sig=${signature}`;
  }

  verifyWaybillPrintSignature(
    companyId: string,
    afterSaleId: string,
    staffId: string,
    expires: string,
    signature: string,
  ) {
    const expiresAt = parseInt(expires, 10);
    const payload = `${companyId}:${afterSaleId}:${staffId}:${expiresAt}`;
    const expectedSig = createHmac('sha256', this.hmacSecret)
      .update(payload)
      .digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    const comparableBuf =
      actualBuf.length === expectedBuf.length
        ? actualBuf
        : Buffer.alloc(expectedBuf.length);
    const signatureValid =
      timingSafeEqual(expectedBuf, comparableBuf) &&
      actualBuf.length === expectedBuf.length;

    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return false;
    }

    return signatureValid;
  }

  async recordWaybillPrintAccess(
    companyId: string,
    staffId: string,
    afterSaleId: string,
    ip?: string,
    userAgent?: string,
  ) {
    try {
      await this.prisma.sellerAuditLog.create({
        data: {
          staffId,
          companyId,
          action: 'PRINT_AFTER_SALE_WAYBILL',
          module: 'after-sale',
          targetType: 'AfterSaleRequest',
          targetId: afterSaleId,
          ip: maskIp(ip),
          userAgent,
        },
      });
    } catch (err) {
      this.logger.error(
        `售后面单打印审计日志写入失败: ${(err as Error).message}`,
      );
    }
  }

  private async acquireWaybillGenerationLock(
    tx: Prisma.TransactionClient,
    resourceKey: string,
  ) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${SellerAfterSaleService.WAYBILL_LOCK_NAMESPACE}),
        hashtext(${resourceKey})
      )
    `;
  }

  private async rollbackCreatedWaybill(
    waybill: { carrierCode: string; waybillNo: string; sfOrderId?: string } | null,
  ) {
    if (!waybill) return;
    await this.shippingService.cancelCarrierWaybill(waybill.sfOrderId ?? '', waybill.waybillNo);
  }

  private resolveWaybillItems(
    request: {
      orderItem?: any;
      order: { items: any[] };
    },
    companyId: string,
  ) {
    return request.orderItem
      ? [
          {
            name:
              request.orderItem.sku?.product?.title ||
              request.orderItem.productSnapshot?.title ||
              '商品',
            quantity: request.orderItem.quantity,
          },
        ]
      : request.order.items
          .filter((item) => item.companyId === companyId)
          .map((item) => ({
            name:
              item.sku?.product?.title ||
              item.productSnapshot?.title ||
              '商品',
            quantity: item.quantity,
          }));
  }

  private parseBuyerAddress(addressSnapshot: unknown): CarrierWaybillAddress {
    if (!addressSnapshot) {
      throw new BadRequestException('订单地址信息缺失，无法生成卖家回寄面单');
    }

    let addr: any;
    try {
      addr = decryptJsonValue(
        typeof addressSnapshot === 'string'
          ? JSON.parse(addressSnapshot)
          : addressSnapshot,
      );
    } catch {
      throw new BadRequestException('订单地址信息格式错误，无法生成卖家回寄面单');
    }
    if (!addr || typeof addr !== 'object' || Array.isArray(addr)) {
      throw new BadRequestException('订单地址信息格式错误，无法生成卖家回寄面单');
    }

    const name = addr.recipientName || addr.receiverName || addr.name || '';
    const tel = addr.phone || addr.recipientPhone || addr.receiverPhone || '';
    let province = addr.province || '';
    let city = addr.city || '';
    let district = addr.district || '';
    const detail = addr.detail || '';

    if (!province && addr.regionText) {
      const parsed = parseChineseAddress(addr.regionText);
      province = parsed.province;
      city = parsed.city;
      district = parsed.district;
    }

    const receiver = { name, tel, province, city, district, detail };
    this.assertAddressReady(receiver, '买家收货地址不完整，无法生成卖家回寄面单');
    return receiver;
  }

  private buildCompanyWaybillAddress(company: {
    name: string;
    servicePhone: string | null;
    address: Prisma.JsonValue | null;
    contact: Prisma.JsonValue | null;
  }): CarrierWaybillAddress {
    const address = (company.address ?? {}) as Record<string, any>;
    const contact = (company.contact ?? {}) as Record<string, any>;
    const sender = {
      name: contact?.name || company.name,
      tel: contact?.phone || company.servicePhone || '',
      province: address?.province || '',
      city: address?.city || '',
      district: address?.district || '',
      detail: address?.detail || address?.text || '',
    };

    this.assertAddressReady(
      sender,
      '商家售后寄件地址不完整，请先补充省市和详细地址',
    );
    return sender;
  }

  private assertAddressReady(address: CarrierWaybillAddress, message: string): void {
    if (!address.name || !address.tel || !address.province || !address.city || !address.detail) {
      throw new BadRequestException(message);
    }
  }
}
