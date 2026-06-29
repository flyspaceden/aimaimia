import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  GroupBuyActivityStatus,
  GroupBuyCodeStatus,
  GroupBuyInstanceStatus,
  GroupBuyReferralStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { generateUniqueGroupBuyCode } from './group-buy-code.util';
import { GroupBuyRebateService } from './group-buy-rebate.service';

const IMMEDIATE_ACTIVATION_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.PAID,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.RECEIVED,
]);

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
          activity: {
            select: {
              id: true,
              status: true,
              startAt: true,
              endAt: true,
              deletedAt: true,
            },
          },
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

      if (this.hasActivityEnded(instance.activity, now)) {
        await tx.groupBuyInstance.update({
          where: { id: instance.id },
          data: {
            status: GroupBuyInstanceStatus.EXPIRED,
            expiredAt: now,
            invalidReason: 'ACTIVITY_ENDED',
          },
        });
        if (instance.code?.status === GroupBuyCodeStatus.ACTIVE) {
          await tx.groupBuyCode.update({
            where: { id: instance.code.id },
            data: {
              status: GroupBuyCodeStatus.EXPIRED,
              expiredAt: now,
            },
          });
        }
        return { status: 'EXPIRED' };
      }
      if (!this.isActivityActive(instance.activity, now)) {
        return { status: 'WAITING_ACTIVITY_ACTIVE' };
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

      if (!IMMEDIATE_ACTIVATION_ORDER_STATUSES.has(order.status)) {
        return { status: 'SKIPPED' };
      }

      const code = instance.code?.code ?? await generateUniqueGroupBuyCode(tx);
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

  @Cron(CronExpression.EVERY_MINUTE)
  async expireEndedActivities(now = new Date(), limit = 200) {
    return this.prisma.$transaction(async (tx) => {
      const activities = await tx.groupBuyActivity.findMany({
        where: {
          status: {
            in: [
              GroupBuyActivityStatus.ACTIVE,
              GroupBuyActivityStatus.PAUSED,
            ],
          },
          deletedAt: null,
          endAt: { lte: now },
        },
        select: { id: true },
        orderBy: { endAt: 'asc' },
        take: limit,
      });
      const activityIds = activities.map((activity) => activity.id);
      if (activityIds.length === 0) {
        return this.emptyExpiryResult();
      }

      return this.expireActivitiesInTransaction(tx, activityIds, now, {
        markActivityEnded: true,
        onlyActiveActivities: false,
      });
    }, this.serializableTransactionOptions);
  }

  async expireActivitiesByIds(
    activityIds: string[],
    now = new Date(),
    options: {
      markActivityEnded?: boolean;
      onlyActiveActivities?: boolean;
    } = {},
  ) {
    const uniqueActivityIds = Array.from(new Set(activityIds.filter(Boolean)));
    if (uniqueActivityIds.length === 0) {
      return this.emptyExpiryResult();
    }
    return this.prisma.$transaction(
      (tx) => this.expireActivitiesInTransaction(tx, uniqueActivityIds, now, {
        markActivityEnded: options.markActivityEnded ?? true,
        onlyActiveActivities: options.onlyActiveActivities ?? false,
      }),
      this.serializableTransactionOptions,
    );
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

      const candidateReferrals = await tx.groupBuyReferral.findMany({
        where: {
          instanceId: instance.id,
          status: GroupBuyReferralStatus.CANDIDATE,
        },
        select: { id: true },
      });
      let referralsInvalidated = 0;
      if (candidateReferrals.length > 0) {
        const referralResult = await tx.groupBuyReferral.updateMany({
          where: {
            id: { in: candidateReferrals.map((referral) => referral.id) },
            status: GroupBuyReferralStatus.CANDIDATE,
          },
          data: {
            status: GroupBuyReferralStatus.INVALID,
            invalidReason: 'USER_TERMINATED',
            invalidatedAt: now,
          },
        });
        referralsInvalidated = referralResult.count;
      }

      await tx.groupBuyInstance.update({
        where: { id: instance.id },
        data: {
          status: 'TERMINATED',
          terminatedAt: now,
          candidateCount: 0,
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

      return { status: 'TERMINATED', referralsInvalidated };
    }, this.serializableTransactionOptions);
  }
  async expireActivitiesInTransaction(
    tx: Prisma.TransactionClient,
    activityIds: string[],
    now: Date,
    options: {
      markActivityEnded: boolean;
      onlyActiveActivities: boolean;
    },
  ) {
    if (activityIds.length === 0) {
      return this.emptyExpiryResult();
    }

    const candidateReferrals = await tx.groupBuyReferral.findMany({
      where: {
        status: GroupBuyReferralStatus.CANDIDATE,
        instance: { activityId: { in: activityIds } },
      },
      select: {
        id: true,
        instanceId: true,
      },
    });
    const referralIds = candidateReferrals.map((referral) => referral.id);

    const activityResult = options.markActivityEnded
      ? await tx.groupBuyActivity.updateMany({
        where: {
          id: { in: activityIds },
          ...(options.onlyActiveActivities ? { status: GroupBuyActivityStatus.ACTIVE } : {}),
        },
        data: {
          status: GroupBuyActivityStatus.ENDED,
          updatedAt: now,
        },
      })
      : { count: 0 };
    const codeResult = await tx.groupBuyCode.updateMany({
      where: {
        status: GroupBuyCodeStatus.ACTIVE,
        instance: { activityId: { in: activityIds } },
      },
      data: {
        status: GroupBuyCodeStatus.EXPIRED,
        expiredAt: now,
      },
    });
    const instanceResult = await tx.groupBuyInstance.updateMany({
      where: {
        activityId: { in: activityIds },
        status: {
          in: [
            GroupBuyInstanceStatus.QUALIFICATION_PENDING,
            GroupBuyInstanceStatus.SHARING,
          ],
        },
      },
      data: {
        status: GroupBuyInstanceStatus.EXPIRED,
        expiredAt: now,
        invalidReason: 'ACTIVITY_ENDED',
      },
    });

    let referralsInvalidated = 0;
    if (referralIds.length > 0) {
      const referralResult = await tx.groupBuyReferral.updateMany({
        where: {
          id: { in: referralIds },
          status: GroupBuyReferralStatus.CANDIDATE,
        },
        data: {
          status: GroupBuyReferralStatus.INVALID,
          invalidReason: 'ACTIVITY_ENDED',
          invalidatedAt: now,
        },
      });
      referralsInvalidated = referralResult.count;

      const decrementByInstance = new Map<string, number>();
      for (const referral of candidateReferrals) {
        decrementByInstance.set(
          referral.instanceId,
          (decrementByInstance.get(referral.instanceId) ?? 0) + 1,
        );
      }
      for (const [instanceId, count] of decrementByInstance) {
        await tx.groupBuyInstance.update({
          where: { id: instanceId },
          data: { candidateCount: { decrement: count } },
        });
      }
    }

    return {
      activitiesExpired: activityResult.count,
      codesExpired: codeResult.count,
      instancesExpired: instanceResult.count,
      referralsInvalidated,
    };
  }

  private emptyExpiryResult() {
    return {
      activitiesExpired: 0,
      codesExpired: 0,
      instancesExpired: 0,
      referralsInvalidated: 0,
    };
  }

  private hasActivityEnded(
    activity: {
      status: GroupBuyActivityStatus;
      startAt: Date | null;
      endAt: Date | null;
      deletedAt: Date | null;
    },
    now: Date,
  ) {
    return activity.status === GroupBuyActivityStatus.ENDED
      || Boolean(activity.deletedAt)
      || !activity.endAt
      || activity.endAt <= now;
  }

  private isActivityActive(
    activity: {
      status: GroupBuyActivityStatus;
      startAt: Date | null;
      endAt: Date | null;
      deletedAt: Date | null;
    },
    now: Date,
  ) {
    return activity.status === GroupBuyActivityStatus.ACTIVE
      && !activity.deletedAt
      && (!activity.startAt || activity.startAt <= now)
      && !this.hasActivityEnded(activity, now);
  }
}
