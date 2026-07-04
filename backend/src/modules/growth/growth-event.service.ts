import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  isGrowthEnabled,
  isGrowthRefundReversalEnabled,
  readGrowthConfigInt,
  syncGrowthAccountLevel,
} from './growth-config.util';

export type GrowthEvent = {
  userId: string;
  behaviorCode: string;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
};

export type DirectGrowthGrantEvent = GrowthEvent & {
  pointsReward?: number | null;
  growthReward?: number | null;
  tx?: Prisma.TransactionClient;
};

type LimitScope = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'LIFETIME';

@Injectable()
export class GrowthEventService {
  constructor(private readonly prisma: PrismaService) {}

  async receive(event: GrowthEvent) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.growthLedger.findUnique({
        where: { idempotencyKey: event.idempotencyKey },
      });
      if (existing) {
        return {
          status: 'DUPLICATE',
          ledger: existing,
        };
      }

      if (!(await isGrowthEnabled(tx as any))) {
        return {
          status: 'SKIPPED',
          reason: 'SYSTEM_DISABLED',
        };
      }

      const rule = await tx.growthBehaviorRule.findUnique({
        where: { code: event.behaviorCode },
      });
      if (!rule || !rule.enabled) {
        return {
          status: 'SKIPPED',
          reason: rule ? 'RULE_DISABLED' : 'RULE_NOT_FOUND',
        };
      }

      const now = new Date();
      if ((rule.startAt && rule.startAt > now) || (rule.endAt && rule.endAt <= now)) {
        return {
          status: 'SKIPPED',
          reason: 'RULE_INACTIVE',
        };
      }

      const memberProfile = await tx.memberProfile.findUnique({
        where: { userId: event.userId },
        select: { tier: true },
      });
      const userTier = memberProfile?.tier === 'VIP' ? 'VIP' : 'NORMAL';
      if (rule.applicableUserType !== 'ALL' && rule.applicableUserType !== userTier) {
        return {
          status: 'SKIPPED',
          reason: 'USER_TYPE_NOT_APPLICABLE',
        };
      }

      const limitReason = await this.findLimitReason(tx, event, rule, now);
      if (limitReason) {
        return {
          status: 'SKIPPED',
          reason: limitReason,
        };
      }

      const configLimitReason = await this.findConfigLimitReason(tx, event, now);
      if (configLimitReason) {
        return {
          status: 'SKIPPED',
          reason: configLimitReason,
        };
      }

      let pointsDelta = this.applyMultiplier(
        rule.pointsReward,
        userTier === 'VIP' ? rule.vipPointsMultiplier : null,
      );
      const growthDelta = this.applyMultiplier(
        rule.growthReward,
        userTier === 'VIP' ? rule.vipGrowthMultiplier : null,
      );
      pointsDelta = await this.applyGlobalPointCaps(tx, event.userId, pointsDelta, now);
      if (pointsDelta === 0 && growthDelta === 0) {
        return {
          status: 'SKIPPED',
          reason: 'ZERO_REWARD',
        };
      }

      const account = await tx.growthAccount.upsert({
        where: { userId: event.userId },
        create: {
          userId: event.userId,
          pointsBalance: pointsDelta,
          pointsTotalEarned: Math.max(0, pointsDelta),
          pointsTotalSpent: 0,
          growthValue: growthDelta,
        },
        update: {
          pointsBalance: { increment: pointsDelta },
          pointsTotalEarned: { increment: Math.max(0, pointsDelta) },
          growthValue: { increment: growthDelta },
        },
      });
      await syncGrowthAccountLevel(tx as any, account);

      const expiresAt = pointsDelta > 0 ? await this.resolvePointsExpiresAt(tx, now) : null;
      const ledger = await tx.growthLedger.create({
        data: {
          userId: event.userId,
          accountId: account.id,
          type: pointsDelta !== 0 ? 'POINTS_EARN' : 'GROWTH_EARN',
          behaviorCode: event.behaviorCode,
          pointsDelta,
          growthDelta,
          status: 'POSTED',
          idempotencyKey: event.idempotencyKey,
          refType: event.refType,
          refId: event.refId,
          expiresAt,
          meta: event.meta ? (event.meta as Prisma.InputJsonObject) : Prisma.JsonNull,
        },
      });

      await tx.userProfile.upsert({
        where: { userId: event.userId },
        create: {
          userId: event.userId,
          points: pointsDelta,
          growthPoints: growthDelta,
        },
        update: {
          points: { increment: pointsDelta },
          growthPoints: { increment: growthDelta },
        },
      });

      return {
        status: 'GRANTED',
        pointsDelta,
        growthDelta,
        ledger,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async grantDirect(event: DirectGrowthGrantEvent) {
    if (event.tx) {
      return this.grantDirectInTx(event.tx, event);
    }

    return this.prisma.$transaction(
      (tx) => this.grantDirectInTx(tx, event),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async grantDirectInTx(
    tx: Prisma.TransactionClient,
    event: DirectGrowthGrantEvent,
  ) {
    const existing = await tx.growthLedger.findUnique({
      where: { idempotencyKey: event.idempotencyKey },
    });
    if (existing) {
      return {
        status: 'DUPLICATE',
        ledger: existing,
      };
    }

    if (!(await isGrowthEnabled(tx as any))) {
      return {
        status: 'SKIPPED',
        reason: 'SYSTEM_DISABLED',
      };
    }

    const now = new Date();
    let pointsDelta = event.pointsReward ?? 0;
    const growthDelta = event.growthReward ?? 0;
    pointsDelta = await this.applyGlobalPointCaps(tx, event.userId, pointsDelta, now);
    if (pointsDelta === 0 && growthDelta === 0) {
      return {
        status: 'SKIPPED',
        reason: 'ZERO_REWARD',
      };
    }

    const account = await tx.growthAccount.upsert({
      where: { userId: event.userId },
      create: {
        userId: event.userId,
        pointsBalance: pointsDelta,
        pointsTotalEarned: Math.max(0, pointsDelta),
        pointsTotalSpent: 0,
        growthValue: growthDelta,
      },
      update: {
        pointsBalance: { increment: pointsDelta },
        pointsTotalEarned: { increment: Math.max(0, pointsDelta) },
        growthValue: { increment: growthDelta },
      },
    });
    await syncGrowthAccountLevel(tx as any, account);

    const expiresAt = pointsDelta > 0 ? await this.resolvePointsExpiresAt(tx, now) : null;
    const ledger = await tx.growthLedger.create({
      data: {
        userId: event.userId,
        accountId: account.id,
        type: pointsDelta !== 0 ? 'POINTS_EARN' : 'GROWTH_EARN',
        behaviorCode: event.behaviorCode,
        pointsDelta,
        growthDelta,
        status: 'POSTED',
        idempotencyKey: event.idempotencyKey,
        refType: event.refType,
        refId: event.refId,
        expiresAt,
        meta: event.meta ? (event.meta as Prisma.InputJsonObject) : Prisma.JsonNull,
      },
    });

    await tx.userProfile.upsert({
      where: { userId: event.userId },
      create: {
        userId: event.userId,
        points: pointsDelta,
        growthPoints: growthDelta,
      },
      update: {
        points: { increment: pointsDelta },
        growthPoints: { increment: growthDelta },
      },
    });

    return {
      status: 'GRANTED',
      pointsDelta,
      growthDelta,
      ledger,
    };
  }

  async reverseByRef(refType: string, refId: string) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await isGrowthRefundReversalEnabled(tx as any))) {
        return {
          reversedCount: 0,
          reversedPoints: 0,
          reversedGrowth: 0,
          skippedReason: 'REVERSAL_DISABLED',
        };
      }

      const ledgers = await tx.growthLedger.findMany({
        where: {
          refType,
          refId,
          status: 'POSTED',
        },
      });

      let reversedCount = 0;
      let reversedPoints = 0;
      let reversedGrowth = 0;

      for (const ledger of ledgers) {
        if (ledger.pointsDelta === 0 && ledger.growthDelta === 0) {
          continue;
        }

        const idempotencyKey = `GROWTH_REVERSE:${ledger.id}`;
        const existing = await tx.growthLedger.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          continue;
        }

        const account = await tx.growthAccount.update({
          where: { id: ledger.accountId },
          data: {
            pointsBalance: { decrement: ledger.pointsDelta },
            growthValue: { decrement: ledger.growthDelta },
          },
        });
        await syncGrowthAccountLevel(tx as any, account);

        await tx.userProfile.upsert({
          where: { userId: ledger.userId },
          create: {
            userId: ledger.userId,
            points: -ledger.pointsDelta,
            growthPoints: -ledger.growthDelta,
          },
          update: {
            points: { decrement: ledger.pointsDelta },
            growthPoints: { decrement: ledger.growthDelta },
          },
        });

        await tx.growthLedger.create({
          data: {
            userId: ledger.userId,
            accountId: ledger.accountId,
            type: ledger.pointsDelta !== 0 ? 'POINTS_REVERSE' : 'GROWTH_REVERSE',
            behaviorCode: ledger.behaviorCode,
            pointsDelta: -ledger.pointsDelta,
            growthDelta: -ledger.growthDelta,
            status: 'POSTED',
            idempotencyKey,
            refType,
            refId,
            meta: {
              reversedLedgerId: ledger.id,
            },
          },
        });

        await tx.growthLedger.update({
          where: { id: ledger.id },
          data: { status: 'REVERSED' },
        });

        reversedCount += 1;
        reversedPoints += ledger.pointsDelta;
        reversedGrowth += ledger.growthDelta;
      }

      return {
        reversedCount,
        reversedPoints,
        reversedGrowth,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async findLimitReason(
    tx: Prisma.TransactionClient,
    event: GrowthEvent,
    rule: {
      dailyLimit: number | null;
      weeklyLimit: number | null;
      monthlyLimit: number | null;
      lifetimeLimit: number | null;
    },
    now: Date,
  ): Promise<string | null> {
    if (await this.isLimitReached(tx, event, 'DAILY', rule.dailyLimit, this.startOfDay(now))) {
      return 'DAILY_LIMIT';
    }
    if (await this.isLimitReached(tx, event, 'WEEKLY', rule.weeklyLimit, this.startOfWeek(now))) {
      return 'WEEKLY_LIMIT';
    }
    if (await this.isLimitReached(tx, event, 'MONTHLY', rule.monthlyLimit, this.startOfMonth(now))) {
      return 'MONTHLY_LIMIT';
    }
    if (await this.isLimitReached(tx, event, 'LIFETIME', rule.lifetimeLimit)) {
      return 'LIFETIME_LIMIT';
    }
    return null;
  }

  private async findConfigLimitReason(
    tx: Prisma.TransactionClient,
    event: GrowthEvent,
    now: Date,
  ): Promise<string | null> {
    if (event.behaviorCode === 'NORMAL_INVITE_REGISTER') {
      const dailyLimit = await readGrowthConfigInt(tx as any, 'GROWTH_DAILY_SHARE_REWARD_USER_CAP', 0);
      if (await this.isConfigLimitReached(tx, event, dailyLimit, this.startOfDay(now))) {
        return 'CONFIG_DAILY_SHARE_REWARD_LIMIT';
      }
    }

    if (event.behaviorCode === 'NORMAL_INVITE_FIRST_ORDER') {
      const monthlyLimit = await readGrowthConfigInt(tx as any, 'GROWTH_MONTHLY_INVITE_FIRST_ORDER_CAP', 0);
      if (await this.isConfigLimitReached(tx, event, monthlyLimit, this.startOfMonth(now))) {
        return 'CONFIG_MONTHLY_INVITE_FIRST_ORDER_LIMIT';
      }
    }

    return null;
  }

  private async isLimitReached(
    tx: Prisma.TransactionClient,
    event: GrowthEvent,
    _scope: LimitScope,
    limit?: number | null,
    createdAfter?: Date,
  ) {
    if (!limit || limit <= 0) return false;

    const where: Prisma.GrowthLedgerWhereInput = {
      userId: event.userId,
      behaviorCode: event.behaviorCode,
      status: 'POSTED',
    };
    if (createdAfter) {
      where.createdAt = { gte: createdAfter };
    }

    const count = await tx.growthLedger.count({ where });
    return count >= limit;
  }

  private async isConfigLimitReached(
    tx: Prisma.TransactionClient,
    event: GrowthEvent,
    limit: number,
    createdAfter: Date,
  ) {
    if (!limit || limit <= 0) return false;
    const count = await tx.growthLedger.count({
      where: {
        userId: event.userId,
        behaviorCode: event.behaviorCode,
        status: 'POSTED',
        createdAt: { gte: createdAfter },
      },
    });
    return count >= limit;
  }

  private async applyGlobalPointCaps(
    tx: Prisma.TransactionClient,
    userId: string,
    pointsDelta: number,
    now: Date,
  ) {
    if (pointsDelta <= 0) return pointsDelta;

    let allowed = pointsDelta;
    const dailyCap = await readGrowthConfigInt(tx as any, 'GROWTH_DAILY_POINTS_CAP', 0);
    if (dailyCap > 0) {
      const usedToday = await this.sumEarnedPoints(tx, userId, this.startOfDay(now));
      allowed = Math.min(allowed, Math.max(0, dailyCap - usedToday));
    }

    const monthlyCap = await readGrowthConfigInt(tx as any, 'GROWTH_MONTHLY_POINTS_CAP', 0);
    if (monthlyCap > 0) {
      const usedThisMonth = await this.sumEarnedPoints(tx, userId, this.startOfMonth(now));
      allowed = Math.min(allowed, Math.max(0, monthlyCap - usedThisMonth));
    }

    return Math.max(0, allowed);
  }

  private async sumEarnedPoints(
    tx: Prisma.TransactionClient,
    userId: string,
    createdAfter: Date,
  ) {
    const result = await tx.growthLedger.aggregate({
      where: {
        userId,
        status: 'POSTED',
        pointsDelta: { gt: 0 },
        createdAt: { gte: createdAfter },
      },
      _sum: { pointsDelta: true },
    });
    return result._sum.pointsDelta ?? 0;
  }

  private async resolvePointsExpiresAt(tx: Prisma.TransactionClient, now: Date) {
    const expireDays = await readGrowthConfigInt(tx as any, 'GROWTH_POINTS_EXPIRE_DAYS', 365);
    return addDays(now, Math.max(1, expireDays));
  }

  private applyMultiplier(value: number, multiplier?: number | null) {
    if (!multiplier) return value;
    return Math.round(value * multiplier);
  }

  private startOfDay(now: Date) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private startOfWeek(now: Date) {
    const date = this.startOfDay(now);
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + mondayOffset);
    return date;
  }

  private startOfMonth(now: Date) {
    const date = this.startOfDay(now);
    date.setDate(1);
    return date;
  }
}
