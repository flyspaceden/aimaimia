import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusAllocationService } from '../../bonus/engine/bonus-allocation.service';
import { PaymentService } from '../../payment/payment.service';
import { AdminRefundQueryDto, ArbitrateRefundDto } from './dto/admin-refund.dto';
import { sanitizeErrorForLog } from '../../../common/logging/log-sanitizer';
import {
  maskAddressSnapshot,
  maskPhone,
  maskTrackingNo,
} from '../../../common/security/privacy-mask';
import { decryptJsonValue } from '../../../common/security/encryption';

@Injectable()
export class AdminRefundsService {
  private readonly logger = new Logger(AdminRefundsService.name);

  constructor(
    private prisma: PrismaService,
    private bonusAllocation: BonusAllocationService,
    private paymentService: PaymentService,
  ) {}

  /** 退款列表（全平台） */
  async findAll(query: AdminRefundQueryDto, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { id: query.keyword },
        { orderId: query.keyword },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.refund.findMany({
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
              goodsAmount: true,
              shippingFee: true,
              discountAmount: true,
              paidAt: true,
              createdAt: true,
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
              items: {
                select: {
                  companyId: true,
                  unitPrice: true,
                  quantity: true,
                  productSnapshot: true,
                  sku: {
                    select: {
                      product: {
                        select: { id: true, title: true, company: { select: { id: true, name: true } } },
                      },
                    },
                  },
                },
              },
              payments: {
                select: {
                  channel: true,
                  status: true,
                  amount: true,
                  paidAt: true,
                },
                take: 1,
              },
            },
          },
          // 退款状态变更历史（含卖家处理记录）
          statusHistory: {
            orderBy: { createdAt: 'asc' },
            select: {
              fromStatus: true,
              toStatus: true,
              remark: true,
              operatorId: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return {
      items: items.map((r) => ({
        ...r,
        order: r.order
          ? {
              ...r.order,
              user: r.order.user
                ? {
                    ...r.order.user,
                    authIdentities: (r.order.user.authIdentities || []).map((identity) => ({
                      ...identity,
                      identifierMasked: maskPhone(identity.identifier || null),
                    })),
                  }
                : r.order.user,
            }
          : r.order,
        buyer: {
          nickname: r.order?.user?.profile?.nickname || null,
          phone: maskPhone(r.order?.user?.authIdentities?.[0]?.identifier || null),
        },
        company: r.order?.items?.[0]?.sku?.product?.company || null,
        paymentChannel: r.order?.payments?.[0]?.channel || null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 退款详情 */
  async findById(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            user: {
              select: {
                id: true,
                profile: { select: { nickname: true, avatarUrl: true } },
                authIdentities: {
                  where: { provider: 'PHONE' },
                  select: { identifier: true },
                  take: 1,
                },
              },
            },
            items: {
              include: {
                sku: {
                  include: {
                    product: {
                      select: { id: true, title: true, company: { select: { id: true, name: true } } },
                    },
                  },
                },
              },
            },
            shipments: true,
          },
        },
      },
    });
    if (!refund) throw new NotFoundException('退款单不存在');

    const buyerPhone = refund.order?.user?.authIdentities?.[0]?.identifier || null;
    const addressSnapshot = refund.order
      ? decryptJsonValue((refund.order as any).addressSnapshot)
      : null;
    return {
      ...refund,
      order: refund.order
        ? {
            ...refund.order,
            addressSnapshot,
            addressMasked: maskAddressSnapshot(addressSnapshot),
            user: refund.order.user
              ? {
                  ...refund.order.user,
                  authIdentities: (refund.order.user.authIdentities || []).map((identity) => ({
                    ...identity,
                    identifierMasked: maskPhone(identity.identifier || null),
                  })),
                  phoneMasked: maskPhone(buyerPhone),
                }
              : refund.order.user,
            shipments: (refund.order.shipments || []).map((shipment) => ({
              ...shipment,
              trackingNoMasked: maskTrackingNo((shipment as any).trackingNo),
            })),
            shipment: refund.order.shipments?.[0]
              ? {
                  ...refund.order.shipments[0],
                  trackingNoMasked: maskTrackingNo((refund.order.shipments[0] as any).trackingNo),
                }
              : null,
          }
        : refund.order,
    };
  }

  /** 管理员仲裁退款（强制同意/拒绝） */
  async arbitrate(refundId: string, dto: ArbitrateRefundDto) {
    if (dto.status === 'APPROVED') {
      return this.arbitrateApprove(refundId, dto.reason);
    } else if (dto.status === 'REJECTED') {
      return this.arbitrateReject(refundId, dto.reason);
    } else {
      throw new BadRequestException('仲裁结果只能是 APPROVED 或 REJECTED');
    }
  }

  /**
   * 仲裁同意 — 强制退款
   * C4修复：Serializable 隔离级别 + CAS 防并发，所有检查移到事务内
   */
  private async arbitrateApprove(
    refundId: string,
    reason?: string,
  ) {
    /** 记录事务内的数据，供事务外异步操作使用 */
    let orderId: string;
    let refundAmount: number;
    let merchantRefundNo: string;
    let previousOrderStatus: string;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // 在事务内读取退款单，确保 Serializable 一致性
          const refund = await tx.refund.findUnique({
            where: { id: refundId },
            include: { order: { include: { items: true } } },
          });
          if (!refund) throw new NotFoundException('退款单不存在');

          // 仲裁只处理待处理或已被卖家拒绝的退款
          if (!['REQUESTED', 'REJECTED'].includes(refund.status)) {
            throw new BadRequestException('当前退款状态不可仲裁');
          }

          const order = refund.order;

          // M07: 校验退款金额不超过订单实付金额
          if (refund.amount > order.totalAmount) {
            throw new BadRequestException(
              `退款金额（${refund.amount}）不能超过订单总额（${order.totalAmount}）`,
            );
          }

          // M07: 检查是否已存在已完成/已通过的退款，防止重复退款（在事务内检查）
          const existingRefunds = await tx.refund.findMany({
            where: {
              orderId: order.id,
              status: { in: ['APPROVED', 'REFUNDING', 'REFUNDED'] },
              id: { not: refund.id }, // 排除当前退款单
            },
          });
          if (existingRefunds.length > 0) {
            throw new BadRequestException(
              '该订单已存在已通过或已完成的退款记录，不可重复退款',
            );
          }

          // 记录供事务外使用的数据
          orderId = order.id;
          refundAmount = refund.amount;
          merchantRefundNo = refund.merchantRefundNo;
          previousOrderStatus = order.status;

          // CAS：用 updateMany + where 条件隐式校验退款状态未被并发修改
          const refundResult = await tx.refund.updateMany({
            where: { id: refund.id, status: { in: ['REQUESTED', 'REJECTED'] } },
            data: {
              status: 'APPROVED',
              reason: reason ? `${refund.reason}（管理员仲裁：${reason}）` : refund.reason,
            },
          });
          if (refundResult.count === 0) {
            throw new ConflictException('退款状态已变更，请刷新后重试');
          }

          // M07/C03修复: 所有可退款状态均恢复库存（PAID/SHIPPED/DELIVERED/RECEIVED）
          if (['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'].includes(order.status)) {
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
                  refId: order.id,
                },
              });
            }
          }

          // N12修复：恢复被使用的奖励
          await tx.rewardLedger.updateMany({
            where: { refType: 'ORDER', refId: order.id, status: 'VOIDED' },
            data: { status: 'AVAILABLE', refType: null, refId: null },
          });

          // CAS：用 updateMany + where 条件隐式校验订单状态未被并发修改
          const orderResult = await tx.order.updateMany({
            where: { id: order.id, status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] } },
            data: { status: 'REFUNDED' },
          });
          if (orderResult.count === 0) {
            throw new ConflictException('订单状态已变更，请刷新后重试');
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: order.status,
              toStatus: 'REFUNDED',
              reason: `管理员仲裁退款${reason ? '：' + reason : ''}`,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        // 事务成功，跳出重试循环
        break;
      } catch (e: any) {
        // P2034: Serializable 事务冲突，重试
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
        throw e;
      }
    }

    // N12修复：发起支付渠道退款（事务外，幂等操作）
    try {
      await this.paymentService.initiateRefund(orderId!, refundAmount!, merchantRefundNo!);
    } catch (err: any) {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(`仲裁退款-渠道退款失败 ${orderId!}: ${safeErr.message}`, safeErr.stack);
    }

    // 异步回滚分润
    if (previousOrderStatus! === 'RECEIVED') {
      this.bonusAllocation.rollbackForOrder(orderId!).catch((err) => {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.error(`仲裁退款-分润回滚失败 ${orderId!}: ${safeErr.message}`, safeErr.stack);
      });
    }

    return { ok: true };
  }

  /** 仲裁拒绝 — 维持卖家决定 */
  private async arbitrateReject(refundId: string, reason?: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
    });
    if (!refund) throw new NotFoundException('退款单不存在');

    // 仲裁只处理待处理或已被卖家拒绝的退款
    if (!['REQUESTED', 'REJECTED'].includes(refund.status)) {
      throw new BadRequestException('当前退款状态不可仲裁');
    }

    await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'REJECTED',
        reason: reason ? `${refund.reason}（管理员仲裁拒绝：${reason}）` : refund.reason,
      },
    });
    return { ok: true };
  }
}
