import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentService } from '../../payment/payment.service';
import { AfterSaleRewardService } from '../../after-sale/after-sale-reward.service';
import { InboxService } from '../../inbox/inbox.service';
import { ArbitrateAfterSaleDto } from './dto/arbitrate-after-sale.dto';
import { decryptJsonValue } from '../../../common/security/encryption';
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
];

@Injectable()
export class AdminAfterSaleService {
  private readonly logger = new Logger(AdminAfterSaleService.name);

  constructor(
    private prisma: PrismaService,
    private paymentService: PaymentService,
    private afterSaleRewardService: AfterSaleRewardService,
    private inboxService: InboxService,
  ) {}

  // ========== 列表查询 ==========

  /** 售后申请列表（全平台） */
  async findAll(
    page = 1,
    pageSize = 20,
    status?: string,
    afterSaleType?: string,
    companyId?: string,
    keyword?: string,
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
      where.OR = [
        { id: keyword },
        { orderId: keyword },
      ];
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
              profile: { select: { nickname: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
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
            profile: { select: { nickname: true } },
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('售后申请不存在');

    // 解密地址快照（管理员可查看完整信息）
    const phone = request.user?.authIdentities?.[0]?.identifier ?? null;
    return {
      ...request,
      order: request.order
        ? {
            ...request.order,
            addressSnapshot: decryptJsonValue(request.order.addressSnapshot),
          }
        : request.order,
      company: request.orderItem?.sku?.product?.company || null,
      user: {
        id: request.user?.id,
        nickname: request.user?.profile?.nickname,
        phone: maskPhone(phone),
      },
      // 退货物流（管理员可看完整单号辅助仲裁）
      returnWaybillNo: request.returnWaybillNo,
      replacementWaybillNo: request.replacementWaybillNo,
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
   * 审批通过时，根据 arbitrationSource（仲裁前状态）决定后续流程：
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
   *   → 换货类型 → APPROVED（卖家需要发货）
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
              return tx.afterSaleRequest.findUnique({ where: { id } });
            }

            // === 审批通过 ===

            // 判断仲裁前来源，决定后续流程
            const fromSellerRejectedReturn =
              currentStatus === 'PENDING_ARBITRATION' &&
              request.arbitrationSource === 'SELLER_REJECTED_RETURN';

            if (fromSellerRejectedReturn) {
              // 场景2: 卖家验收退货不合格后买家升级仲裁
              // 货物已在卖家手中
              const isReturnType =
                request.afterSaleType === 'NO_REASON_RETURN' ||
                request.afterSaleType === 'QUALITY_RETURN';

              if (isReturnType) {
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
                await this.triggerRefund(tx, request as any);
              } else {
                // 换货：APPROVED，等卖家发换货
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

              // 无需退回 + 退货退款类型 → 自动触发退款
              const isReturnType =
                request.afterSaleType === 'NO_REASON_RETURN' ||
                request.afterSaleType === 'QUALITY_RETURN';
              if (!request.requiresReturn && isReturnType) {
                await this.triggerRefund(tx, request as any);
              }
              // 无需退回 + 换货：停留在 APPROVED，等卖家发货
              // 需要退回：停留在 APPROVED，等买家寄回退货
            }

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
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

  // ========== 私有方法 ==========

  /**
   * 触发退款（在事务内创建退款记录，事务提交后异步调用支付退款）
   * 与 SellerAfterSaleService.triggerRefund 保持一致
   */
  private async triggerRefund(
    tx: Prisma.TransactionClient,
    request: {
      id: string;
      orderId: string;
      refundAmount: number | null;
      reason: string;
    },
  ) {
    if (!request.refundAmount || request.refundAmount <= 0) {
      this.logger.warn(
        `售后 ${request.id} 退款金额无效: ${request.refundAmount}`,
      );
      return;
    }

    const merchantRefundNo = `AS-${request.id}-${Date.now()}`;

    // 创建退款记录
    const refund = await tx.refund.create({
      data: {
        orderId: request.orderId,
        amount: request.refundAmount,
        status: 'REFUNDING',
        merchantRefundNo,
        reason: `管理员仲裁退款: ${request.reason}`,
      },
    });

    // 关联退款记录；如果调用方已将状态设为 REFUNDING 则只更新 refundId
    const current = await tx.afterSaleRequest.findUnique({
      where: { id: request.id },
      select: { status: true },
    });
    await tx.afterSaleRequest.update({
      where: { id: request.id },
      data: {
        ...(current?.status !== 'REFUNDING' ? { status: 'REFUNDING' } : {}),
        refundId: refund.id,
      },
    });

    // 事务提交后异步调用支付退款（占位实现）
    const capturedOrderId = request.orderId;
    setImmediate(async () => {
      try {
        const result = await this.paymentService.initiateRefund(
          request.orderId,
          request.refundAmount!,
          merchantRefundNo,
        );
        if (result.success) {
          const cas = await this.prisma.afterSaleRequest.updateMany({
            where: { id: request.id, status: 'REFUNDING' },
            data: { status: 'REFUNDED' },
          });
          await this.prisma.refund.updateMany({
            where: { id: refund.id, status: 'REFUNDING' },
            data: {
              status: 'REFUNDED',
              providerRefundId: result.providerRefundId,
            },
          });
          // cas.count === 0 说明已被其他路径处理，跳过后续（防重复通知）
          if (cas.count > 0) {
            await this.afterSaleRewardService
              .voidRewardsForOrder(capturedOrderId)
              .catch((voidErr: any) => {
                this.logger.error(
                  `管理员仲裁退款后奖励归平台失败: orderId=${capturedOrderId}, error=${voidErr?.message}`,
                );
              });
            await this.afterSaleRewardService
              .checkAndMarkOrderRefunded(capturedOrderId)
              .catch((err: any) => {
                this.logger.error(
                  `检查订单全退状态失败: orderId=${capturedOrderId}, error=${err?.message}`,
                );
              });
            const order = await this.prisma.order.findUnique({ where: { id: request.orderId }, select: { userId: true } });
            if (order) {
              this.inboxService.send({
                userId: order.userId,
                category: 'transaction',
                type: 'refund_credited',
                title: '退款已到账',
                content: `您的退款 ${request.refundAmount!.toFixed(2)} 元已原路退回支付宝账户。`,
                target: { route: '/orders' },
              }).catch(() => {});
            }
          }
        }
        // 退款失败则保持 REFUNDING 状态，由补偿任务重试
      } catch (err) {
        this.logger.error(
          `管理员仲裁退款调用失败: afterSaleId=${request.id}, error=${(err as Error).message}`,
        );
      }
    });
  }

  /** 列表项隐私脱敏 */
  private maskListItem(r: any) {
    const phone = r.user?.authIdentities?.[0]?.identifier ?? null;
    return {
      ...r,
      order: r.order
        ? {
            ...r.order,
            addressSnapshot: maskAddressSnapshot(r.order.addressSnapshot),
          }
        : r.order,
      company: r.orderItem?.sku?.product?.company || null,
      user: {
        id: r.user?.id,
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
    };
  }
}
