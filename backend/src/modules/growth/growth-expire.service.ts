import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GrowthExpireService {
  private readonly logger = new Logger(GrowthExpireService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 10 2 * * *')
  async runScheduledExpiration() {
    try {
      await this.expirePoints();
    } catch (err: any) {
      this.logger.error(`普通积分过期任务失败: ${err?.message}`);
    }
  }

  async expirePoints(now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const expiredLedgers = await tx.growthLedger.findMany({
        where: {
          status: 'POSTED',
          pointsDelta: { gt: 0 },
          expiresAt: { lte: now },
        },
        orderBy: { expiresAt: 'asc' },
      });

      let expiredCount = 0;
      let expiredPoints = 0;

      for (const ledger of expiredLedgers) {
        const idempotencyKey = `GROWTH_EXPIRE:${ledger.id}`;
        const existing = await tx.growthLedger.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          continue;
        }

        const account = await tx.growthAccount.findUnique({
          where: { id: ledger.accountId },
        });
        const availablePoints = Math.max(0, account?.pointsBalance ?? 0);
        const pointsToExpire = Math.min(ledger.pointsDelta, availablePoints);
        if (pointsToExpire <= 0) {
          continue;
        }

        await tx.growthAccount.update({
          where: { id: ledger.accountId },
          data: {
            pointsBalance: { decrement: pointsToExpire },
            pointsTotalSpent: { increment: pointsToExpire },
          },
        });

        await tx.growthLedger.create({
          data: {
            userId: ledger.userId,
            accountId: ledger.accountId,
            type: 'POINTS_EXPIRE',
            behaviorCode: ledger.behaviorCode,
            pointsDelta: -pointsToExpire,
            growthDelta: 0,
            status: 'POSTED',
            idempotencyKey,
            refType: ledger.refType,
            refId: ledger.refId,
            meta: {
              expiredLedgerId: ledger.id,
            },
          },
        });

        await tx.userProfile.upsert({
          where: { userId: ledger.userId },
          create: {
            userId: ledger.userId,
            points: -pointsToExpire,
            growthPoints: 0,
          },
          update: {
            points: { decrement: pointsToExpire },
          },
        });

        expiredCount += 1;
        expiredPoints += pointsToExpire;
      }

      return {
        expiredCount,
        expiredPoints,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
