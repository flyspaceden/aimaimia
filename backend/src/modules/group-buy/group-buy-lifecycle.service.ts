import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { generateGroupBuyCode } from './group-buy-code.util';

@Injectable()
export class GroupBuyLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly serializableTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

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

  async abandonCurrent(userId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const instance = await tx.groupBuyInstance.findFirst({
        where: {
          userId,
          status: 'QUALIFICATION_PENDING',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!instance) {
        return { status: 'NOOP' };
      }

      await tx.groupBuyInstance.update({
        where: { id: instance.id },
        data: {
          status: 'QUALIFICATION_ABANDONED',
          abandonedAt: now,
        },
      });
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
        return { status: 'NOOP' };
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
