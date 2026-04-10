import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  filterContactInfo,
  maskIp,
  maskTrackingNo,
} from '../../../common/security/privacy-mask';
import { SellerShippingService } from '../shipping/seller-shipping.service';
import { PaymentService } from '../../payment/payment.service';
import { AfterSaleRewardService } from '../../after-sale/after-sale-reward.service';
import { createHmac, timingSafeEqual } from 'crypto';

/** P2034 序列化冲突重试次数 */
const MAX_RETRIES = 3;

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
        // 退货物流（遮罩）
        returnCarrierName: r.returnCarrierName,
        returnWaybillNo: r.returnWaybillNo
          ? maskTrackingNo(r.returnWaybillNo) || r.returnWaybillNo
          : undefined,
        // 换货物流（遮罩）
        replacementCarrierName: r.replacementCarrierName,
        replacementWaybillNo: r.replacementWaybillNo
          ? maskTrackingNo(r.replacementWaybillNo) || r.replacementWaybillNo
          : undefined,
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
      sellerReturnWaybillNo: request.sellerReturnWaybillNo
        ? maskTrackingNo(request.sellerReturnWaybillNo) ||
          request.sellerReturnWaybillNo
        : undefined,
      // 退货物流
      returnCarrierName: request.returnCarrierName,
      returnWaybillNo: request.returnWaybillNo
        ? maskTrackingNo(request.returnWaybillNo) || request.returnWaybillNo
        : undefined,
      returnShippedAt: request.returnShippedAt,
      // 换货物流
      replacementCarrierName: request.replacementCarrierName,
      replacementWaybillNo: request.replacementWaybillNo
        ? maskTrackingNo(request.replacementWaybillNo) ||
          request.replacementWaybillNo
        : undefined,
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

  // ========== 开始审核 ==========

  /** 开始审核（REQUESTED → UNDER_REVIEW） */
  async startReview(
    companyId: string,
    staffId: string,
    id: string,
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

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
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
   * 如果 requiresReturn=false 且为换货类型（QUALITY_EXCHANGE）：
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

            // 无需退回商品 + 退货退款类型 → 自动触发退款
            if (
              !request.requiresReturn &&
              (request.afterSaleType === 'NO_REASON_RETURN' ||
                request.afterSaleType === 'QUALITY_RETURN')
            ) {
              await this.triggerRefund(tx, request as any);
            }
            // 无需退回 + 换货：停留在 APPROVED，等卖家发货

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
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

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
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
   * 如果 afterSaleType 是换货（QUALITY_EXCHANGE）：
   *   → 停留在 RECEIVED_BY_SELLER，等待卖家发货
   */
  async confirmReceiveReturn(
    companyId: string,
    staffId: string,
    id: string,
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

            // 退货退款类型 → 自动触发退款
            if (
              request.afterSaleType === 'NO_REASON_RETURN' ||
              request.afterSaleType === 'QUALITY_RETURN'
            ) {
              await this.triggerRefund(tx, request as any);
            }
            // 换货：停留在 RECEIVED_BY_SELLER，等卖家发货

            return tx.afterSaleRequest.findUnique({ where: { id } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
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
    returnWaybillNo: string,
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
                sellerReturnWaybillNo: returnWaybillNo,
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }

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

  /** 卖家发出换货商品（APPROVED/RECEIVED_BY_SELLER → REPLACEMENT_SHIPPED，仅 QUALITY_EXCHANGE） */
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

            if (request.afterSaleType !== 'QUALITY_EXCHANGE') {
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
                afterSaleType: 'QUALITY_EXCHANGE',
              },
              data: {
                status: 'REPLACEMENT_SHIPPED',
                replacementShipmentId: request.replacementWaybillNo,
              },
            });
            if (cas.count === 0) {
              throw new BadRequestException('该申请状态已变更，请刷新后重试');
            }

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
    let createdWaybill: { carrierCode: string; waybillNo: string; taskId?: string } | null =
      null;

    try {
      return await this.prisma.$transaction(
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

          if (request.afterSaleType !== 'QUALITY_EXCHANGE') {
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

          if (request.replacementWaybillNo) {
            throw new BadRequestException(
              '该售后已生成面单，请勿重复操作',
            );
          }

          const items = request.orderItem
            ? [
                {
                  name:
                    request.orderItem.sku?.product?.title ||
                    (request.orderItem.productSnapshot as any)?.title ||
                    '商品',
                  quantity: request.orderItem.quantity,
                },
              ]
            : request.order.items
                .filter((item) => item.companyId === companyId)
                .map((item) => ({
                  name:
                    item.sku?.product?.title ||
                    (item.productSnapshot as any)?.title ||
                    '商品',
                  quantity: item.quantity,
                }));

          if (items.length === 0) {
            throw new BadRequestException('未找到可生成面单的商品');
          }

          const waybill = await this.shippingService.createCarrierWaybill(
            companyId,
            carrierCode,
            request.order.addressSnapshot,
            items,
          );
          createdWaybill = {
            carrierCode: waybill.carrierCode,
            waybillNo: waybill.waybillNo,
            taskId: waybill.taskId,
          };

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
            },
          });

          if (cas.count === 0) {
            throw new BadRequestException(
              '该售后已生成面单，请勿重复操作',
            );
          }

          return {
            ok: true,
            waybillNo:
              maskTrackingNo(waybill.waybillNo) || waybill.waybillNo,
            waybillPrintUrl: this.getWaybillPrintUrl(
              companyId,
              id,
              staffId,
            ),
            carrierCode: waybill.carrierCode,
            carrierName: waybill.carrierName,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
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
    const cancellation = await this.prisma.$transaction(
      async (tx) => {
        const request = await tx.afterSaleRequest.findUnique({
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
          },
        });

        if (cas.count === 0) {
          throw new BadRequestException(
            '该售后面单状态已变更，请刷新后重试',
          );
        }

        return {
          carrierCode: request.replacementCarrierCode || '',
          waybillNo: request.replacementWaybillNo,
          kuaidi100TaskId: (request as any).replacementKuaidi100TaskId as string | undefined,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.shippingService.cancelCarrierWaybill(
      cancellation.kuaidi100TaskId ?? '',
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

  // ========== 私有辅助 ==========

  /**
   * 触发退款流程
   * 在事务内创建 Refund 记录并更新售后状态为 REFUNDING，
   * 事务外调用 PaymentService.initiateRefund()（占位实现）
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
        reason: `售后退款: ${request.reason}`,
      },
    });

    // 更新售后状态为退款中，关联退款记录
    await tx.afterSaleRequest.update({
      where: { id: request.id },
      data: {
        status: 'REFUNDING',
        refundId: refund.id,
      },
    });

    // 事务提交后异步调用支付退款（占位实现）
    // 注意：PaymentService.initiateRefund 是幂等的占位方法
    // 实际生产中应使用消息队列异步触发
    const capturedOrderId = request.orderId;
    setImmediate(async () => {
      try {
        const result = await this.paymentService.initiateRefund(
          request.orderId,
          request.refundAmount!,
          merchantRefundNo,
        );
        if (result.success) {
          await this.prisma.afterSaleRequest.updateMany({
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
          // 退款成功后触发奖励归平台
          await this.afterSaleRewardService
            .voidRewardsForOrder(capturedOrderId)
            .catch((voidErr: any) => {
              this.logger.error(
                `退款成功后奖励归平台失败: orderId=${capturedOrderId}, error=${voidErr?.message}`,
              );
            });
        }
        // 退款失败则保持 REFUNDING 状态，由补偿任务重试
      } catch (err) {
        this.logger.error(
          `售后退款调用失败: afterSaleId=${request.id}, error=${(err as Error).message}`,
        );
      }
    });
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
    waybill: { carrierCode: string; waybillNo: string; taskId?: string } | null,
  ) {
    if (!waybill) return;
    await this.shippingService.cancelCarrierWaybill(waybill.taskId ?? '');
  }
}
