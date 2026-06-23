import { ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { generateGroupBuyCode } from './group-buy-code.util';
import { GroupBuyRebateService } from './group-buy-rebate.service';

@Injectable()
export class GroupBuyLifecycleService {
  private readonly logger = new Logger(GroupBuyLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rebateService: GroupBuyRebateService,
  ) {}

  private readonly serializableTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  async evaluateOrderAfterReceive(orderId: string, now = new Date()) {
    const initiator = await this.evaluateInitiatorOrder(orderId, now);
    const referral = await this.rebateService.releaseReferralByOrderIfValid(orderId, now);
    return { initiator, referral };
  }

  async evaluateInitiatorOrder(orderId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const instance = await tx.groupBuyInstance.findUnique({
        where: { initiatorOrderId: orderId },
        include: {
          code: true,
          initiatorOrder: {
            select: {
              id: true,
              status: true,
              returnWindowExpiresAt: true,
              afterSaleRequests: { select: { id: true }, take: 1 },
              refunds: { select: { id: true }, take: 1 },
            },
          },
        },
      });
      if (!instance) {
        return { status: 'NOT_FOUND' };
      }
      if (instance.status !== 'QUALIFICATION_PENDING') {
        return { status: 'SKIPPED' };
      }

      const order = instance.initiatorOrder;
      if (
        order.status === 'REFUNDED'
        || order.afterSaleRequests.length > 0
        || order.refunds.length > 0
      ) {
        await tx.groupBuyInstance.update({
          where: { id: instance.id },
          data: {
            status: 'QUALIFICATION_INVALID',
            invalidatedAt: now,
            invalidReason: 'OWN_ORDER_AFTER_SALE_OR_REFUND',
          },
        });
        return { status: 'INVALIDATED' };
      }

      if (order.status !== 'RECEIVED') {
        return { status: 'WAITING_RECEIVE' };
      }
      if (!order.returnWindowExpiresAt || order.returnWindowExpiresAt > now) {
        return { status: 'WAITING_RETURN_WINDOW' };
      }

      const code = instance.code?.code ?? await this.generateUniqueCode(tx);
      if (!instance.code) {
        await tx.groupBuyCode.create({
          data: {
            instanceId: instance.id,
            code,
            status: 'ACTIVE',
            activatedAt: now,
          },
        });
      }
      await tx.groupBuyInstance.update({
        where: { id: instance.id },
        data: {
          status: 'SHARING',
          activatedAt: now,
        },
      });

      return { status: 'ACTIVATED', code };
    }, this.serializableTransactionOptions);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async processMaturedOrders(now = new Date(), limit = 200) {
    const maturedOrInvalidOrderWhere: Prisma.OrderWhereInput = {
      OR: [
        {
          status: OrderStatus.RECEIVED,
          returnWindowExpiresAt: { lte: now },
        },
        { status: { in: [OrderStatus.REFUNDED, OrderStatus.CANCELED] } },
        { afterSaleRequests: { some: {} } },
        { refunds: { some: {} } },
      ],
    };

    const [initiatorInstances, candidateReferrals] = await Promise.all([
      this.prisma.groupBuyInstance.findMany({
        where: {
          status: 'QUALIFICATION_PENDING',
          initiatorOrder: { is: maturedOrInvalidOrderWhere },
        },
        select: { initiatorOrderId: true },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      }),
      this.prisma.groupBuyReferral.findMany({
        where: {
          status: 'CANDIDATE',
          referredOrder: { is: maturedOrInvalidOrderWhere },
        },
        select: { referredOrderId: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
    ]);

    for (const instance of initiatorInstances) {
      try {
        await this.evaluateInitiatorOrder(instance.initiatorOrderId, now);
      } catch (err: any) {
        this.logger.warn(
          `团购发起资格补偿评估失败: orderId=${instance.initiatorOrderId}; error=${err?.message ?? err}`,
        );
      }
    }

    for (const referral of candidateReferrals) {
      try {
        await this.rebateService.releaseReferralByOrderIfValid(referral.referredOrderId, now);
      } catch (err: any) {
        this.logger.warn(
          `团购推荐订单补偿评估失败: orderId=${referral.referredOrderId}; error=${err?.message ?? err}`,
        );
      }
    }

    return {
      initiatorScanned: initiatorInstances.length,
      referralScanned: candidateReferrals.length,
    };
  }

  async abandonCurrent(userId: string, instanceId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const instance = await tx.groupBuyInstance.findFirst({
        where: {
          id: instanceId,
          userId,
          status: 'QUALIFICATION_PENDING',
        },
        select: { id: true },
      });
      if (!instance) {
        throw new ConflictException('团购状态已变化，请刷新后重试');
      }

      await tx.groupBuyInstance.update({
        where: { id: instance.id },
        data: {
          status: 'QUALIFICATION_ABANDONED',
          abandonedAt: now,
        },
      });
      this.logger.log(`团购资格已放弃: userId=${userId}; instanceId=${instance.id}`);
      return { status: 'ABANDONED' };
    }, this.serializableTransactionOptions);
  }

  async terminateCurrent(userId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const instance = await tx.groupBuyInstance.findFirst({
        where: {
          userId,
          status: 'SHARING',
        },
        orderBy: { updatedAt: 'desc' },
        include: { code: true },
      });
      if (!instance) {
        throw new ConflictException('当前没有进行中的团购分享，请刷新后重试');
      }

      await tx.groupBuyInstance.update({
        where: { id: instance.id },
        data: {
          status: 'TERMINATED',
          terminatedAt: now,
        },
      });
      if (instance.code && instance.code.status === 'ACTIVE') {
        await tx.groupBuyCode.update({
          where: { id: instance.code.id },
          data: {
            status: 'DISABLED',
            disabledAt: now,
          },
        });
      }

      return { status: 'TERMINATED' };
    }, this.serializableTransactionOptions);
  }

  private async generateUniqueCode(tx: Prisma.TransactionClient) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateGroupBuyCode();
      const existing = await tx.groupBuyCode.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new InternalServerErrorException('团购推荐码生成失败');
  }
}
