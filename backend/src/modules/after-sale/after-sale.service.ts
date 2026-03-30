import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { AfterSaleType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAfterSaleDto } from './dto/create-after-sale.dto';
import { ReturnShippingDto } from './dto/return-shipping.dto';
import { filterContactInfo } from '../../common/security/privacy-mask';
import {
  resolveReturnPolicy,
  isWithinReturnWindow,
  calculateRefundAmount,
  requiresReturnShipping,
  getConfigValue,
} from './after-sale.utils';
import {
  AFTER_SALE_CONFIG_KEYS,
  ACTIVE_STATUSES,
} from './after-sale.constants';
import { AfterSaleRewardService } from './after-sale-reward.service';

// 允许申请售后的订单状态
const AFTER_SALE_ELIGIBLE_STATUSES = ['SHIPPED', 'DELIVERED', 'RECEIVED'];

// 标准化理由标签
const REASON_LABELS: Record<string, string> = {
  QUALITY_ISSUE: '质量问题',
  WRONG_ITEM: '发错商品',
  DAMAGED: '运输损坏',
  NOT_AS_DESCRIBED: '与描述不符',
  SIZE_ISSUE: '规格不符',
  EXPIRED: '临期/过期',
  OTHER: '其他',
};

/** P2034 序列化冲突重试次数 */
const MAX_RETRIES = 3;

@Injectable()
export class AfterSaleService {
  private readonly logger = new Logger(AfterSaleService.name);

  constructor(
    private prisma: PrismaService,
    private afterSaleRewardService: AfterSaleRewardService,
  ) {}

  /**
   * 构造理由文本（与 replacement.service.ts 保持一致）
   * OTHER 类型时过滤联系方式，其他类型取标准化标签
   */
  private buildReasonText(dto: CreateAfterSaleDto): string {
    if (dto.reasonType === 'OTHER') {
      return filterContactInfo(dto.reason?.trim() || REASON_LABELS.OTHER);
    }
    if (dto.reasonType) {
      return REASON_LABELS[dto.reasonType] || dto.reasonType;
    }
    // 无理由退货场景，reasonType 为空
    return dto.reason ? filterContactInfo(dto.reason.trim()) : '七天无理由退货';
  }

  // ========== 申请售后 ==========

  /** 买家申请售后（退货退款 / 质量退货 / 质量换货） */
  async apply(
    userId: string,
    orderId: string,
    dto: CreateAfterSaleDto,
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // 1. 订单存在且归属当前用户
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: {
              items: {
                include: {
                  sku: { select: { productId: true } },
                },
              },
            },
          }) as any; // 宽松类型以访问 deliveredAt/receivedAt 等全部字段
          if (!order) throw new NotFoundException('订单不存在');
          if (order.userId !== userId) throw new NotFoundException('订单不存在');

          // 订单状态检查
          if (!AFTER_SALE_ELIGIBLE_STATUSES.includes(order.status)) {
            throw new BadRequestException('该订单状态不支持售后申请');
          }

          // 2. VIP 礼包订单不支持售后
          if ((order as any).bizType === 'VIP_PACKAGE') {
            throw new BadRequestException('VIP 礼包订单不支持退款和换货');
          }

          // 3. 校验商品项存在且属于此订单
          const orderItem = order.items.find((i: any) => i.id === dto.orderItemId);
          if (!orderItem) {
            throw new BadRequestException('指定的商品项不存在');
          }

          // 3b. 奖品不可退
          if (orderItem.isPrize) {
            throw new BadRequestException('奖品商品不支持售后');
          }

          // 4. 检查该商品项是否已有进行中的售后
          const existingActive = await tx.afterSaleRequest.findFirst({
            where: {
              orderItemId: dto.orderItemId,
              userId,
              status: { in: [...ACTIVE_STATUSES] },
            },
          });
          if (existingActive) {
            throw new BadRequestException('该商品已有进行中的售后申请');
          }

          // 4b. v1 整件退：退货数量=商品项全部数量（不支持部分退）

          // 5. 时间窗口校验
          const productId = orderItem.sku?.productId;
          if (!productId) {
            throw new BadRequestException('商品数据异常，无法申请售后');
          }

          const returnPolicy = await resolveReturnPolicy(tx as any, productId);

          const returnWindowDays = await getConfigValue(
            tx as any,
            AFTER_SALE_CONFIG_KEYS.RETURN_WINDOW_DAYS,
          );
          const normalReturnDays = await getConfigValue(
            tx as any,
            AFTER_SALE_CONFIG_KEYS.NORMAL_RETURN_DAYS,
          );
          const freshReturnHours = await getConfigValue(
            tx as any,
            AFTER_SALE_CONFIG_KEYS.FRESH_RETURN_HOURS,
          );

          const withinWindow = isWithinReturnWindow(
            order.deliveredAt,
            order.receivedAt,
            returnPolicy,
            dto.afterSaleType,
            returnWindowDays,
            normalReturnDays,
            freshReturnHours,
          );
          if (!withinWindow) {
            throw new BadRequestException('已超出售后申请时间窗口');
          }

          // 6. 换货后二次售后：若商品项有已完成的换货记录，只允许质量退货
          let isPostReplacement = false;

          const completedReplacement = await tx.afterSaleRequest.findFirst({
            where: {
              orderItemId: dto.orderItemId,
              userId,
              afterSaleType: 'QUALITY_EXCHANGE',
              status: 'COMPLETED',
            },
          });

          if (completedReplacement) {
            if (dto.afterSaleType !== AfterSaleType.QUALITY_RETURN) {
              throw new BadRequestException('该商品已完成换货，仅支持质量退货');
            }
            isPostReplacement = true;
          }

          // 7. 照片校验（已在 DTO 层完成，此处为兜底）
          if (!dto.photos || dto.photos.length < 1 || dto.photos.length > 10) {
            throw new BadRequestException('请上传 1-10 张照片');
          }

          // 8. 计算是否需要退回商品
          const itemAmount = orderItem.unitPrice * orderItem.quantity;
          const noShipThreshold = await getConfigValue(
            tx as any,
            AFTER_SALE_CONFIG_KEYS.RETURN_NO_SHIP_THRESHOLD,
          );
          const needsReturn = requiresReturnShipping(
            dto.afterSaleType,
            itemAmount,
            noShipThreshold,
          );

          // 9. 计算退款金额（仅退货类型需要，换货不退款）
          let refundAmount: number | null = null;
          if (
            dto.afterSaleType === AfterSaleType.NO_REASON_RETURN ||
            dto.afterSaleType === AfterSaleType.QUALITY_RETURN
          ) {
            // 判断是否整单退（该订单所有非奖品项是否都在售后中）
            const nonPrizeItems = order.items.filter((i: any) => !i.isPrize);
            // 当前项已算进去，检查其余非奖品项是否都已有终态售后
            const otherNonPrize = nonPrizeItems.filter(
              (i: any) => i.id !== dto.orderItemId,
            );
            let isFullRefund = nonPrizeItems.length === 1; // 仅一个非奖品项则为整单退

            if (otherNonPrize.length > 0) {
              // 检查其余项是否都已有已退款的售后
              const otherRefunded = await tx.afterSaleRequest.count({
                where: {
                  orderItemId: { in: otherNonPrize.map((i: any) => i.id) },
                  status: { in: ['REFUNDED'] },
                },
              });
              isFullRefund = otherRefunded === otherNonPrize.length;
            }

            refundAmount = calculateRefundAmount(
              orderItem.unitPrice,
              orderItem.quantity,
              order.goodsAmount,
              order.totalCouponDiscount ?? 0,
              order.shippingFee,
              dto.afterSaleType,
              isFullRefund,
            );
          }

          // 10. 创建售后申请
          const reasonText = this.buildReasonText(dto);

          // 11. 换货后二次售后直接进入仲裁
          const initialStatus = isPostReplacement
            ? 'PENDING_ARBITRATION'
            : 'REQUESTED';

          const request = await tx.afterSaleRequest.create({
            data: {
              orderId,
              userId,
              orderItemId: dto.orderItemId,
              afterSaleType: dto.afterSaleType,
              reasonType: dto.reasonType ?? null,
              reason: reasonText,
              photos: dto.photos,
              status: initialStatus,
              isPostReplacement,
              requiresReturn: needsReturn,
              refundAmount,
              ...(isPostReplacement
                ? { arbitrationSource: '换货后二次售后自动升级' }
                : {}),
            },
            include: {
              order: {
                select: { id: true, status: true, totalAmount: true },
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

          // 记录售后申请事件（不变更订单状态）
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: order.status,
              toStatus: order.status,
              reason: `买家申请售后: ${reasonText}`,
              meta: {
                type: 'AFTER_SALE_REQUESTED',
                afterSaleId: request.id,
                afterSaleType: dto.afterSaleType,
              },
            },
          });

          return request;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `apply 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: orderId=${orderId}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new ConflictException('售后申请提交失败，请稍后重试');
  }

  // ========== 取消售后 ==========

  /** 买家取消售后申请（REQUESTED / UNDER_REVIEW → CANCELED） */
  async cancel(userId: string, afterSaleId: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const request = await tx.afterSaleRequest.findUnique({
            where: { id: afterSaleId },
          });
          if (!request) throw new NotFoundException('售后申请不存在');
          if (request.userId !== userId) throw new NotFoundException('售后申请不存在');

          if (!['REQUESTED', 'UNDER_REVIEW'].includes(request.status)) {
            throw new BadRequestException('当前状态不支持取消');
          }

          // CAS 原子更新
          const casResult = await tx.afterSaleRequest.updateMany({
            where: {
              id: afterSaleId,
              status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
            },
            data: { status: 'CANCELED' },
          });
          if (casResult.count === 0) {
            throw new ConflictException('售后申请状态已变更，请刷新后重试');
          }

          return tx.afterSaleRequest.findUnique({ where: { id: afterSaleId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `cancel 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${afterSaleId}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new ConflictException('取消失败，请稍后重试');
  }

  // ========== 填写退货物流 ==========

  /** 买家填写退货快递信息（APPROVED + requiresReturn → RETURN_SHIPPING） */
  async fillReturnShipping(
    userId: string,
    afterSaleId: string,
    dto: ReturnShippingDto,
  ) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const request = await tx.afterSaleRequest.findUnique({
            where: { id: afterSaleId },
          });
          if (!request) throw new NotFoundException('售后申请不存在');
          if (request.userId !== userId) throw new NotFoundException('售后申请不存在');

          if (request.status !== 'APPROVED') {
            throw new BadRequestException('仅已审批通过的售后申请可填写物流信息');
          }
          if (!request.requiresReturn) {
            throw new BadRequestException('该售后申请无需退回商品');
          }

          // CAS 原子更新
          const casResult = await tx.afterSaleRequest.updateMany({
            where: { id: afterSaleId, status: 'APPROVED' },
            data: {
              status: 'RETURN_SHIPPING',
              returnCarrierName: dto.returnCarrierName,
              returnWaybillNo: dto.returnWaybillNo,
              returnShippedAt: new Date(),
            },
          });
          if (casResult.count === 0) {
            throw new ConflictException('售后申请状态已变更，请刷新后重试');
          }

          return tx.afterSaleRequest.findUnique({ where: { id: afterSaleId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `fillReturnShipping 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${afterSaleId}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new ConflictException('填写物流信息失败，请稍后重试');
  }

  // ========== 确认收货（换货场景） ==========

  /** 买家确认收到换货商品（REPLACEMENT_SHIPPED → COMPLETED） */
  async confirmReceive(userId: string, afterSaleId: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const request = await tx.afterSaleRequest.findUnique({
            where: { id: afterSaleId },
            include: {
              order: { select: { id: true, status: true } },
            },
          });
          if (!request) throw new NotFoundException('售后申请不存在');
          if (request.userId !== userId) throw new NotFoundException('售后申请不存在');

          if (request.status !== 'REPLACEMENT_SHIPPED') {
            throw new BadRequestException('仅换货已发出的售后可确认收货');
          }

          // CAS 原子更新
          const casResult = await tx.afterSaleRequest.updateMany({
            where: { id: afterSaleId, status: 'REPLACEMENT_SHIPPED' },
            data: { status: 'COMPLETED' },
          });
          if (casResult.count === 0) {
            throw new ConflictException('售后申请状态已变更，请刷新后重试');
          }

          // 记录售后完成事件
          await tx.orderStatusHistory.create({
            data: {
              orderId: request.orderId,
              fromStatus: request.order.status,
              toStatus: request.order.status,
              reason: '买家确认收到换货商品，售后完成',
              meta: {
                type: 'AFTER_SALE_COMPLETED',
                afterSaleId: request.id,
              },
            },
          });

          // 换货完成后异步触发奖励归平台（不阻塞主事务）
          const capturedOrderId = request.orderId;
          setImmediate(() => {
            this.afterSaleRewardService
              .voidRewardsForOrder(capturedOrderId)
              .catch((err: any) => {
                this.logger.error(
                  `换货完成后奖励归平台失败: orderId=${capturedOrderId}, error=${err?.message}`,
                );
              });
          });

          return tx.afterSaleRequest.findUnique({ where: { id: afterSaleId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `confirmReceive 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${afterSaleId}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new ConflictException('确认收货失败，请稍后重试');
  }

  // ========== 申请仲裁 ==========

  /** 买家申请平台仲裁（REJECTED / SELLER_REJECTED_RETURN → PENDING_ARBITRATION） */
  async escalate(userId: string, afterSaleId: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const request = await tx.afterSaleRequest.findUnique({
            where: { id: afterSaleId },
          });
          if (!request) throw new NotFoundException('售后申请不存在');
          if (request.userId !== userId) throw new NotFoundException('售后申请不存在');

          if (
            !['REJECTED', 'SELLER_REJECTED_RETURN'].includes(request.status)
          ) {
            throw new BadRequestException('当前状态不支持申请仲裁');
          }

          // CAS 原子更新
          const casResult = await tx.afterSaleRequest.updateMany({
            where: {
              id: afterSaleId,
              status: { in: ['REJECTED', 'SELLER_REJECTED_RETURN'] },
            },
            data: {
              status: 'PENDING_ARBITRATION',
              arbitrationSource: '买家申请',
            },
          });
          if (casResult.count === 0) {
            throw new ConflictException('售后申请状态已变更，请刷新后重试');
          }

          return tx.afterSaleRequest.findUnique({ where: { id: afterSaleId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `escalate 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${afterSaleId}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new ConflictException('申请仲裁失败，请稍后重试');
  }

  // ========== 接受关闭 ==========

  /** 买家接受卖家驳回，关闭售后（REJECTED / SELLER_REJECTED_RETURN → CLOSED） */
  async acceptClose(userId: string, afterSaleId: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const request = await tx.afterSaleRequest.findUnique({
            where: { id: afterSaleId },
          });
          if (!request) throw new NotFoundException('售后申请不存在');
          if (request.userId !== userId) throw new NotFoundException('售后申请不存在');

          if (
            !['REJECTED', 'SELLER_REJECTED_RETURN'].includes(request.status)
          ) {
            throw new BadRequestException('当前状态不支持关闭');
          }

          // CAS 原子更新
          const casResult = await tx.afterSaleRequest.updateMany({
            where: {
              id: afterSaleId,
              status: { in: ['REJECTED', 'SELLER_REJECTED_RETURN'] },
            },
            data: { status: 'CLOSED' },
          });
          if (casResult.count === 0) {
            throw new ConflictException('售后申请状态已变更，请刷新后重试');
          }

          return tx.afterSaleRequest.findUnique({ where: { id: afterSaleId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `acceptClose 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: afterSaleId=${afterSaleId}`,
          );
          continue;
        }
        throw e;
      }
    }

    throw new ConflictException('关闭失败，请稍后重试');
  }

  // ========== 列表查询 ==========

  /** 我的售后记录（分页） */
  async list(userId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.afterSaleRequest.findMany({
        where: { userId },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: { id: true, status: true, totalAmount: true },
          },
          orderItem: {
            select: { id: true, productSnapshot: true, quantity: true, unitPrice: true },
          },
        },
      }),
      this.prisma.afterSaleRequest.count({ where: { userId } }),
    ]);

    return { items, total, page, pageSize };
  }

  // ========== 详情查询 ==========

  /** 售后详情（校验归属） */
  async findById(userId: string, id: string) {
    const request = await this.prisma.afterSaleRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            goodsAmount: true,
            shippingFee: true,
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
    if (request.userId !== userId) throw new NotFoundException('售后申请不存在');

    return request;
  }

  // ========== 退货政策同意 ==========

  /** 用户同意退货政策 */
  async agreePolicy(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hasAgreedReturnPolicy: true },
    });
    return { success: true };
  }
}
