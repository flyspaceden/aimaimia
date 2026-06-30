import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AfterSaleOperatorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentService } from '../../payment/payment.service';
import { AfterSaleRewardService } from '../../after-sale/after-sale-reward.service';
import { AfterSaleRefundService } from '../../after-sale/after-sale-refund.service';
import { AfterSaleStatusHistoryService } from '../../after-sale/after-sale-status-history.service';
import { SfExpressService } from '../../shipment/sf-express.service';
import { NotificationService } from '../../notification/notification.service';
import { ArbitrateAfterSaleDto } from './dto/arbitrate-after-sale.dto';
import { decryptJsonValue } from '../../../common/security/encryption';
import { normalizeBuyerNo } from '../../../common/utils/buyer-no.util';
import {
  filterContactInfo,
  maskPhone,
  maskAddressSnapshot,
  maskTrackingNo,
} from '../../../common/security/privacy-mask';

/** P2034 序列化冲突重试次数 */
const MAX_RETRIES = 3;

/** 允许管理员仲裁的源状态 */
const ARBITRABLE_STATUSES = [
  'PENDING_ARBITRATION',
  'REQUESTED',
  'UNDER_REVIEW',
  'REJECTED',
  'SELLER_REJECTED_RETURN',
];

function isReturnAfterSaleType(type: string) {
  return type === 'NO_REASON_RETURN' || type === 'QUALITY_RETURN';
}

function isExchangeAfterSaleType(type: string) {
  return type === 'NO_REASON_EXCHANGE' || type === 'QUALITY_EXCHANGE';
}

const ADMIN_REFUND_SUMMARY_SELECT = {
  id: true,
  amount: true,
  status: true,
  merchantRefundNo: true,
  providerRefundId: true,
} as const;

const ADMIN_REFUND_DETAIL_SELECT = {
  ...ADMIN_REFUND_SUMMARY_SELECT,
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      remark: true,
      createdAt: true,
    },
  },
} as const;

@Injectable()
export class AdminAfterSaleService {
  private readonly logger = new Logger(AdminAfterSaleService.name);

  constructor(
    private prisma: PrismaService,
    private paymentService: PaymentService,
    private afterSaleRewardService: AfterSaleRewardService,
    private notificationService: NotificationService,
    private afterSaleRefundService: AfterSaleRefundService,
    private afterSaleStatusHistory: AfterSaleStatusHistoryService,
    private sfExpress: SfExpressService,
  ) {}

  private async emitAfterSaleNotification(
    tx: Prisma.TransactionClient,
    eventType: string,
    suffix: string,
    request: {
      id: string;
      userId?: string | null;
      orderId?: string | null;
      order?: { items?: Array<{ companyId?: string | null }> } | null;
    },
    adminUserId: string,
  ) {
    await this.notificationService.emit(
      {
        eventType,
        aggregateType: 'afterSale',
        aggregateId: request.id,
        idempotencyKey: `after-sale:${request.id}:${suffix}`,
        actor: { kind: 'admin', id: adminUserId },
        payload: {
          afterSaleId: request.id,
          userId: request.userId ?? undefined,
          orderId: request.orderId ?? undefined,
          companyId: request.order?.items?.find((item) => item.companyId)?.companyId,
        },
      },
      tx as any,
    );
  }

  // ========== 列表查询 ==========

  /** 售后申请列表（全平台） */
  async findAll(
    page = 1,
    pageSize = 20,
    status?: string,
    afterSaleType?: string,
    companyId?: string,
    keyword?: string,
    manualReview?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};

    if (status) {
      where.status = status;
    }
    if (afterSaleType) {
      where.afterSaleType = afterSaleType;
    }
    // 按公司筛选（通过订单项的 companyId）
    if (companyId) {
      where.orderItem = { companyId };
    }
    if (keyword) {
      const normalizedKeyword = normalizeBuyerNo(keyword);
      where.OR = [
        { id: keyword },
        { orderId: keyword },
        { user: { buyerNo: normalizedKeyword } },
      ];
    }
    if (manualReview === 'pending') {
      where.manualReviewReason = { not: null };
      where.manualReviewResolvedAt = null;
    }

    const [items, total] = await Promise.all([
      this.prisma.afterSaleRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              totalAmount: true,
              addressSnapshot: true,
              items: {
                select: {
                  id: true,
                  companyId: true,
                },
              },
            },
          },
          orderItem: {
            select: {
              id: true,
              productSnapshot: true,
              quantity: true,
              unitPrice: true,
              companyId: true,
              sku: {
                select: {
                  product: {
                    select: {
                      company: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
          user: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
          refundByAfterSaleId: { select: ADMIN_REFUND_SUMMARY_SELECT },
          refundByRefundId: { select: ADMIN_REFUND_SUMMARY_SELECT },
        },
      }),
      this.prisma.afterSaleRequest.count({ where }),
    ]);

    return {
      items: items.map((r) => this.maskListItem(r)),
      total,
      page,
      pageSize,
    };
  }

  // ========== 详情查询 ==========

  /** 售后详情 */
  async findById(id: string) {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            goodsAmount: true,
            addressSnapshot: true,
            items: {
              select: {
                id: true,
                companyId: true,
                productSnapshot: true,
                quantity: true,
                unitPrice: true,
              },
            },
          },
        },
        orderItem: {
          select: {
            id: true,
            productSnapshot: true,
            quantity: true,
            unitPrice: true,
            companyId: true,
            sku: {
              select: {
                product: {
                  select: {
                    company: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            buyerNo: true,
            profile: { select: { nickname: true } },
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
        refundByAfterSaleId: { select: ADMIN_REFUND_DETAIL_SELECT },
        refundByRefundId: { select: ADMIN_REFUND_DETAIL_SELECT },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            operatorType: true,
            createdAt: true,
          },
        },
      },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

    // 物流轨迹优先用 DB 里推送落库的（callback fallback 写入），没有再 fallback
    // 到主动查询 SEARCH_ROUTES（生产兜底/沙箱缓存窗口期补救）
    const buildFromDb = (events: any): { status: string; rawOpCode: string; events: any[] } | null => {
      const arr = Array.isArray(events) ? events : null;
      if (!arr || arr.length === 0) return null;
      // status/rawOpCode 取最新一条
      const latest = arr[arr.length - 1] ?? {};
      return {
        status: String(latest.statusCode ?? 'IN_TRANSIT'),
        rawOpCode: String(latest.opCode ?? ''),
        events: arr,
      };
    };
    const dbReturn = buildFromDb((request as any).returnTrackingEvents);
    const dbSellerReturn = buildFromDb((request as any).sellerReturnTrackingEvents);
    const dbReplacement = buildFromDb((request as any).replacementTrackingEvents);

    const [returnRoute, sellerReturnRoute, replacementRoute] = await Promise.all([
      dbReturn
        ? Promise.resolve(dbReturn)
        : request.returnWaybillNo
          ? this.sfExpress.queryRoutes(request.returnWaybillNo).catch(() => null)
          : Promise.resolve(null),
      dbSellerReturn
        ? Promise.resolve(dbSellerReturn)
        : request.sellerReturnWaybillNo
          ? this.sfExpress.queryRoutes(request.sellerReturnWaybillNo).catch(() => null)
          : Promise.resolve(null),
      dbReplacement
        ? Promise.resolve(dbReplacement)
        : request.replacementWaybillNo
          ? this.sfExpress.queryRoutes(request.replacementWaybillNo).catch(() => null)
          : Promise.resolve(null),
    ]);

    // 顺丰沙箱"全流程调测"会把所有 mailNo 都返回相同的样例轨迹（杭州萧山转运
    // 中心 → 上海华新 → 已签收，时间多在 2025-10），跟当前售后单的真实时间
    // 完全无关。必须按基准时间过滤掉早于面单生成的事件，避免污染管理端展示。
    // 1 小时容差覆盖 SF 服务器时钟偏差。
    const filterStaleEvents = (route: typeof returnRoute, referenceTime: Date | null) => {
      if (!route || !route.events?.length || !referenceTime) return route;
      const earliestAllowed = referenceTime.getTime() - 60 * 60 * 1000;
      const freshEvents = route.events.filter((e: any) => {
        const t = new Date(e.time).getTime();
        return Number.isFinite(t) ? t >= earliestAllowed : true;
      });
      if (freshEvents.length !== route.events.length) {
        this.logger.warn(
          `过滤 SF 沙箱旧路由: afterSaleId=${request.id}, dropped=${route.events.length - freshEvents.length}, kept=${freshEvents.length}`,
        );
      }
      return { ...route, events: freshEvents };
    };

    // 基准时间：用面单生成时间最准；fallback 到售后单创建时间
    const returnRefTime = request.returnShippedAt ?? request.approvedAt ?? request.createdAt;
    const replacementRefTime = request.updatedAt ?? request.createdAt;
    const sellerReturnRefTime = request.updatedAt ?? request.createdAt;
    const filteredReturn = filterStaleEvents(returnRoute, returnRefTime);
    const filteredSellerReturn = filterStaleEvents(sellerReturnRoute, sellerReturnRefTime);
    const filteredReplacement = filterStaleEvents(replacementRoute, replacementRefTime);

    // 解密地址快照（管理员可查看完整信息）
    const phone = request.user?.authIdentities?.[0]?.identifier ?? null;
    const refund = request.refundByAfterSaleId ?? request.refundByRefundId;
    const {
      refundByAfterSaleId,
      refundByRefundId,
      statusHistory,
      ...requestData
    } = request as any;
    void refundByAfterSaleId;
    void refundByRefundId;
    return {
      ...requestData,
      order: request.order
        ? {
            ...request.order,
            addressSnapshot: decryptJsonValue(request.order.addressSnapshot),
          }
        : request.order,
      company: request.orderItem?.sku?.product?.company || null,
      user: {
        id: request.user?.id,
        buyerNo: request.user?.buyerNo ?? null,
        nickname: request.user?.profile?.nickname,
        phone: maskPhone(phone),
      },
      // 退货物流（管理员可看完整单号辅助仲裁）
      returnWaybillNo: request.returnWaybillNo,
      replacementWaybillNo: request.replacementWaybillNo,
      // 实时查询的顺丰物流轨迹（推送通道无法路由到售后单，主动查询补充；
      // 已按面单生成时间过滤沙箱旧路由样例污染）
      returnTracking: filteredReturn,
      sellerReturnTracking: filteredSellerReturn,
      replacementTracking: filteredReplacement,
      refund: this.mapRefund(refund),
      refundHistory: this.mapRefundHistory(refund),
      statusHistory: this.mapStatusHistory(statusHistory),
    };
  }

  /** 售后状态时间线（管理员可查看全平台售后单） */
  async getTimeline(id: string) {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

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

  // ========== 状态统计 ==========

  /** 售后状态统计（按状态 + 按类型） */
  async getStats() {
    const [statusCounts, typeCounts] = await Promise.all([
      this.prisma.afterSaleRequest.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.afterSaleRequest.groupBy({
        by: ['afterSaleType'],
        _count: true,
      }),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const c of statusCounts) {
      byStatus[c.status] = c._count;
      total += c._count;
    }
    byStatus.ALL = total;

    const byType: Record<string, number> = {};
    for (const c of typeCounts) {
      byType[c.afterSaleType] = c._count;
    }

    return { byStatus, byType };
  }

  // ========== 仲裁 ==========

  /**
   * 管理员仲裁售后申请
   *
   * 允许仲裁的源状态：
   * - PENDING_ARBITRATION（主要场景：买家升级仲裁）
   * - REQUESTED / UNDER_REVIEW（管理员主动介入覆盖）
   *
   * 审批通过时，根据 arbitrationSourceStatus（仲裁前状态）决定后续流程：
   *
   * 场景1: 源 PENDING_ARBITRATION，且之前是 REJECTED（卖家审核驳回 → 买家升级）
   *   → 按正常审批流程：检查 requiresReturn + afterSaleType
   *   → 退货退款 + 无需退回 → 自动触发退款
   *   → 换货 + 无需退回 → APPROVED（等卖家发货）
   *   → 需要退回 → APPROVED（等买家寄回）
   *
   * 场景2: 源 PENDING_ARBITRATION，且之前是 SELLER_REJECTED_RETURN（卖家验收退货不合格）
   *   → 货物已在卖家手中
   *   → 退货退款类型 → 直接触发退款（→ REFUNDING）
   *   → 换货类型 → RECEIVED_BY_SELLER（卖家需要生成换货面单/发货）
   *
   * 场景3: 源 REQUESTED / UNDER_REVIEW（管理员主动介入）
   *   → 同场景1
   */
  async arbitrate(
    id: string,
    dto: ArbitrateAfterSaleDto,
    adminUserId: string,
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

            if (!ARBITRABLE_STATUSES.includes(request.status)) {
              throw new BadRequestException(
                `该申请当前状态 ${request.status} 不允许仲裁`,
              );
            }

            // 记录仲裁来源（当前状态）
            const currentStatus = request.status;

            if (dto.status === 'REJECTED') {
              // 驳回仲裁
              const cas = await tx.afterSaleRequest.updateMany({
                where: { id, status: currentStatus },
                data: {
                  status: 'REJECTED',
                  arbitrationSource: currentStatus,
                  reviewerId: adminUserId,
                  reviewNote: dto.reason,
                  reviewedAt: new Date(),
                },
              });
              if (cas.count === 0) {
                throw new BadRequestException('该申请状态已变更，请刷新后重试');
              }
              await this.afterSaleStatusHistory.create(tx, {
                afterSaleId: id,
                fromStatus: currentStatus,
                toStatus: 'REJECTED',
                reason: dto.reason,
                operatorType: AfterSaleOperatorType.ADMIN,
                operatorId: adminUserId,
              });
              await this.emitAfterSaleNotification(
                tx,
                'afterSale.arbitrationResolved',
                'arbitration-resolved',
                request,
                adminUserId,
              );
              return tx.afterSaleRequest.findUnique({ where: { id } });
            }

            // === 审批通过 ===

            // 判断仲裁前来源，决定后续流程
            const fromSellerRejectedReturn =
              currentStatus === 'SELLER_REJECTED_RETURN' ||
              (currentStatus === 'PENDING_ARBITRATION' &&
              (
                request.arbitrationSourceStatus === 'SELLER_REJECTED_RETURN' ||
                request.arbitrationSource === 'SELLER_REJECTED_RETURN'
              ));

            if (fromSellerRejectedReturn) {
              // 场景2: 卖家验收退货不合格后买家升级仲裁
              // 货物已在卖家手中
              if (isReturnAfterSaleType(request.afterSaleType)) {
                // 退货退款：货物已在卖家，直接触发退款（跳过 APPROVED 中间态）
                const cas = await tx.afterSaleRequest.updateMany({
                  where: { id, status: currentStatus },
                  data: {
                    status: 'REFUNDING',
                    arbitrationSource: currentStatus,
                    reviewerId: adminUserId,
                    reviewNote: dto.reason,
                    reviewedAt: new Date(),
                    approvedAt: new Date(),
                  },
                });
                if (cas.count === 0) {
                  throw new BadRequestException('该申请状态已变更，请刷新后重试');
                }
                await this.afterSaleStatusHistory.create(tx, {
                  afterSaleId: id,
                  fromStatus: currentStatus,
                  toStatus: 'REFUNDING',
                  reason: dto.reason,
                  operatorType: AfterSaleOperatorType.ADMIN,
                  operatorId: adminUserId,
                });
                await this.emitAfterSaleNotification(
                  tx,
                  'afterSale.arbitrationResolved',
                  'arbitration-resolved',
                  request,
                  adminUserId,
                );
                shouldStartRefund = true;
              } else if (isExchangeAfterSaleType(request.afterSaleType)) {
                // 换货：货物已在卖家，恢复到已收货，等卖家生成换货面单/发货
                const cas = await tx.afterSaleRequest.updateMany({
                  where: { id, status: currentStatus },
                  data: {
                    status: 'RECEIVED_BY_SELLER',
                    arbitrationSource: currentStatus,
                    reviewerId: adminUserId,
                    reviewNote: dto.reason,
                    reviewedAt: new Date(),
                    approvedAt: new Date(),
                  },
                });
                if (cas.count === 0) {
                  throw new BadRequestException('该申请状态已变更，请刷新后重试');
                }
                await this.afterSaleStatusHistory.create(tx, {
                  afterSaleId: id,
                  fromStatus: currentStatus,
                  toStatus: 'RECEIVED_BY_SELLER',
                  reason: dto.reason,
                  operatorType: AfterSaleOperatorType.ADMIN,
                  operatorId: adminUserId,
                });
                await this.emitAfterSaleNotification(
                  tx,
                  'afterSale.arbitrationResolved',
                  'arbitration-resolved',
                  request,
                  adminUserId,
                );
              } else {
                throw new BadRequestException('该售后类型不支持卖家拒收退货仲裁通过');
              }
            } else {
              // 场景1 & 场景3: 正常审批流程
              const cas = await tx.afterSaleRequest.updateMany({
                where: { id, status: currentStatus },
                data: {
                  status: 'APPROVED',
                  arbitrationSource: currentStatus,
                  reviewerId: adminUserId,
                  reviewNote: dto.reason,
                  reviewedAt: new Date(),
                  approvedAt: new Date(),
                },
              });
              if (cas.count === 0) {
                throw new BadRequestException('该申请状态已变更，请刷新后重试');
              }
              await this.afterSaleStatusHistory.create(tx, {
                afterSaleId: id,
                fromStatus: currentStatus,
                toStatus: 'APPROVED',
                reason: dto.reason,
                operatorType: AfterSaleOperatorType.ADMIN,
                operatorId: adminUserId,
              });
              await this.emitAfterSaleNotification(
                tx,
                'afterSale.arbitrationResolved',
                'arbitration-resolved',
                request,
                adminUserId,
              );

              // 无需退回 + 退货退款类型 → 自动触发退款
              if (!request.requiresReturn && isReturnAfterSaleType(request.afterSaleType)) {
                shouldStartRefund = true;
              }
              // 无需退回 + 换货：停留在 APPROVED，等卖家发货
              // 需要退回：停留在 APPROVED，等买家寄回退货
            }

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (shouldStartRefund) {
          await this.afterSaleRefundService.startRefund(id, {
            type: 'ADMIN',
            id: adminUserId,
          });
          return this.prisma.afterSaleRequest.findUnique({ where: { id } });
        }
        return result;
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `arbitrate 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${id}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new BadRequestException('操作失败，请稍后重试');
  }

  async retryRefund(id: string, refundId: string, adminUserId: string) {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      select: {
        id: true,
        refundId: true,
        refundByAfterSaleId: { select: { id: true } },
      },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

    const linkedRefundIds = [
      request.refundId,
      request.refundByAfterSaleId?.id,
    ].filter(Boolean);
    if (!linkedRefundIds.includes(refundId)) {
      throw new BadRequestException('退款单不属于该售后申请');
    }

    await this.afterSaleRefundService.retryRefund(refundId, {
      type: 'ADMIN',
      id: adminUserId,
    });

    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      select: ADMIN_REFUND_SUMMARY_SELECT,
    });
    if (!refund) throw new NotFoundException('退款单不存在');
    return this.mapRefund(refund);
  }

  /** 列表项隐私脱敏 */
  private maskListItem(r: any) {
    const phone = r.user?.authIdentities?.[0]?.identifier ?? null;
    const {
      refundByAfterSaleId,
      refundByRefundId,
      statusHistory,
      ...row
    } = r;
    void statusHistory;
    return {
      ...row,
      order: r.order
        ? {
            ...r.order,
            addressSnapshot: maskAddressSnapshot(r.order.addressSnapshot),
          }
        : r.order,
      company: r.orderItem?.sku?.product?.company || null,
      user: {
        id: r.user?.id,
        buyerNo: r.user?.buyerNo ?? null,
        nickname: r.user?.profile?.nickname,
        phone: maskPhone(phone),
      },
      // 隐私脱敏
      reason: r.reason ? filterContactInfo(r.reason) : r.reason,
      reviewNote: r.reviewNote ? filterContactInfo(r.reviewNote) : undefined,
      returnWaybillNo: r.returnWaybillNo
        ? maskTrackingNo(r.returnWaybillNo)
        : undefined,
      replacementWaybillNo: r.replacementWaybillNo
        ? maskTrackingNo(r.replacementWaybillNo)
        : undefined,
      refund: this.mapRefund(refundByAfterSaleId ?? refundByRefundId),
    };
  }

  private mapRefund(refund: any) {
    if (!refund) return null;
    return {
      id: refund.id,
      amount: refund.amount,
      status: refund.status,
      merchantRefundNo: refund.merchantRefundNo,
      providerRefundId: refund.providerRefundId ?? null,
    };
  }

  private mapRefundHistory(refund: any) {
    return (refund?.statusHistory ?? []).map((row: any) => ({
      id: row.id,
      fromStatus: row.fromStatus ?? null,
      toStatus: row.toStatus,
      remark: row.remark ?? null,
      createdAt: row.createdAt,
    }));
  }

  private mapStatusHistory(rows: any[] | undefined) {
    return (rows ?? []).map((row) => ({
      id: row.id,
      fromStatus: row.fromStatus ?? null,
      toStatus: row.toStatus,
      reason: row.reason ?? null,
      operatorType: row.operatorType ?? null,
      createdAt: row.createdAt,
    }));
  }
}
