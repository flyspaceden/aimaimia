import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

      const pointsDelta = this.applyMultiplier(
        rule.pointsReward,
        userTier === 'VIP' ? rule.vipPointsMultiplier : null,
      );
      const growthDelta = this.applyMultiplier(
        rule.growthReward,
        userTier === 'VIP' ? rule.vipGrowthMultiplier : null,
      );
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

    const pointsDelta = event.pointsReward ?? 0;
    const growthDelta = event.growthReward ?? 0;
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

        await tx.growthAccount.update({
          where: { id: ledger.accountId },
          data: {
            pointsBalance: { decrement: ledger.pointsDelta },
            growthValue: { decrement: ledger.growthDelta },
          },
        });

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
