import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthCouponAdapterService } from './growth-coupon-adapter.service';

const BUSINESS_TIME_ZONE = 'Asia/Shanghai';
const COUPON_EXCHANGE_TYPES = new Set([
  'COUPON',
  'SHIPPING_COUPON',
  'VIP_DISCOUNT_COUPON',
]);

type ExchangeInput = {
  idempotencyKey: string;
};

@Injectable()
export class GrowthExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly couponAdapter: GrowthCouponAdapterService,
  ) {}

  async listItems(userId: string) {
    const now = new Date();
    const [account, items] = await Promise.all([
      this.prisma.growthAccount.findUnique({ where: { userId } }),
      this.prisma.growthExchangeItem.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { startAt: null },
            { startAt: { lte: now } },
          ],
          AND: [
            {
              OR: [
                { endAt: null },
                { endAt: { gte: now } },
              ],
            },
          ],
        },
        include: { requiredLevel: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    const pointsBalance = account?.pointsBalance ?? 0;
    const growthValue = account?.growthValue ?? 0;

    return items.map((item) => {
      const requiredThreshold = item.requiredLevel?.threshold ?? 0;
      return {
        ...item,
        canExchange:
          pointsBalance >= item.pointsCost &&
          growthValue >= requiredThreshold &&
          !this.isSoldOutForDisplay(item),
      };
    });
  }

  async exchange(userId: string, itemId: string, input: ExchangeInput) {
    const requestKey = input.idempotencyKey?.trim();
    if (!requestKey) {
      throw new BadRequestException('缺少兑换幂等键');
    }
    const idempotencyKey = `GROWTH_EXCHANGE:${userId}:${requestKey}`;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.growthExchangeRecord.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return existing;
      }

      const now = new Date();
      const day = this.businessDay(now);
      const item = await tx.growthExchangeItem.findUnique({
        where: { id: itemId },
        include: { requiredLevel: true },
      });
      if (!item) {
        throw new NotFoundException('兑换项不存在');
      }
      this.assertItemExchangeable(item, now, day);

      const account = await tx.growthAccount.findUnique({
        where: { userId },
      });
      if (!account) {
        throw new BadRequestException('积分账户不存在');
      }
      if (account.pointsBalance < item.pointsCost) {
        throw new BadRequestException('普通积分不足');
      }
      if (item.requiredLevel && account.growthValue < item.requiredLevel.threshold) {
        throw new BadRequestException(`成长值不足，需达到${item.requiredLevel.name}`);
      }

      await this.assertUserLimits(tx, userId, item, now);

      const record = await tx.growthExchangeRecord.create({
        data: {
          userId,
          accountId: account.id,
          itemId: item.id,
          pointsCost: item.pointsCost,
          status: 'PENDING',
          idempotencyKey,
          meta: Prisma.JsonNull,
        },
      });

      await tx.growthAccount.update({
        where: { id: account.id },
        data: {
          pointsBalance: { decrement: item.pointsCost },
          pointsTotalSpent: { increment: item.pointsCost },
        },
      });

      await tx.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          points: -item.pointsCost,
          growthPoints: account.growthValue,
        },
        update: {
          points: { decrement: item.pointsCost },
        },
      });

      await tx.growthLedger.create({
        data: {
          userId,
          accountId: account.id,
          type: 'POINTS_SPEND',
          pointsDelta: -item.pointsCost,
          growthDelta: 0,
          status: 'POSTED',
          idempotencyKey: `${idempotencyKey}:LEDGER`,
          refType: 'GROWTH_EXCHANGE',
          refId: record.id,
          meta: {
            itemId: item.id,
            itemName: item.name,
            exchangeRecordId: record.id,
          },
        },
      });

      const coupon = await this.issueCouponIfNeeded(tx, userId, item, record.id);

      await tx.growthExchangeItem.update({
        where: { id: item.id },
        data: {
          issuedTotal: { increment: 1 },
          issuedToday: item.issuedTodayDate === day ? { increment: 1 } : 1,
          issuedTodayDate: day,
        },
      });

      return tx.growthExchangeRecord.update({
        where: { id: record.id },
        data: {
          status: 'SUCCESS',
          couponInstanceId: coupon?.id ?? null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listRecords(userId: string) {
    return this.prisma.growthExchangeRecord.findMany({
      where: { userId },
      include: {
        item: true,
        couponInstance: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private assertItemExchangeable(item: any, now: Date, day: string) {
    if (item.status !== 'ACTIVE') {
      throw new BadRequestException('兑换项未启用');
    }
    if (item.startAt && now < item.startAt) {
      throw new BadRequestException('兑换项尚未开始');
    }
    if (item.endAt && now > item.endAt) {
      throw new BadRequestException('兑换项已结束');
    }
    if (item.stockTotal !== null && item.issuedTotal >= item.stockTotal) {
      throw new BadRequestException('兑换项库存不足');
    }
    const issuedToday = item.issuedTodayDate === day ? item.issuedToday : 0;
    if (item.stockDaily !== null && issuedToday >= item.stockDaily) {
      throw new BadRequestException('兑换项今日库存不足');
    }
    if (COUPON_EXCHANGE_TYPES.has(item.type) && !item.couponCampaignId) {
      throw new BadRequestException('红包兑换项缺少红包活动配置');
    }
  }

  private async assertUserLimits(
    tx: Prisma.TransactionClient,
    userId: string,
    item: any,
    now: Date,
  ) {
    if (item.perUserDailyLimit !== null) {
      const range = this.businessDayRange(now);
      const count = await tx.growthExchangeRecord.count({
        where: {
          userId,
          itemId: item.id,
          status: 'SUCCESS',
          createdAt: { gte: range.start, lt: range.end },
        },
      });
      if (count >= item.perUserDailyLimit) {
        throw new BadRequestException('今日兑换次数已达上限');
      }
    }

    if (item.perUserMonthlyLimit !== null) {
      const range = this.businessMonthRange(now);
      const count = await tx.growthExchangeRecord.count({
        where: {
          userId,
          itemId: item.id,
          status: 'SUCCESS',
          createdAt: { gte: range.start, lt: range.end },
        },
      });
      if (count >= item.perUserMonthlyLimit) {
        throw new BadRequestException('本月兑换次数已达上限');
      }
    }
  }

  private async issueCouponIfNeeded(
    tx: Prisma.TransactionClient,
    userId: string,
    item: any,
    recordId: string,
  ) {
    if (!COUPON_EXCHANGE_TYPES.has(item.type)) {
      return null;
    }
    return this.couponAdapter.issueExchangeCoupon({
      userId,
      campaignId: item.couponCampaignId,
      tx,
      source: { type: 'GROWTH_EXCHANGE', id: recordId },
    });
  }

  private isSoldOutForDisplay(item: any) {
    if (item.stockTotal !== null && item.issuedTotal >= item.stockTotal) {
      return true;
    }
    const day = this.businessDay(new Date());
    const issuedToday = item.issuedTodayDate === day ? item.issuedToday : 0;
    return item.stockDaily !== null && issuedToday >= item.stockDaily;
  }

  private businessDay(now: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  private businessDayRange(now: Date) {
    const day = this.businessDay(now);
    const start = new Date(`${day}T00:00:00+08:00`);
    return {
      start,
      end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
    };
  }

  private businessMonthRange(now: Date) {
    const day = this.businessDay(now);
    const [year, month] = day.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1) - 8 * 60 * 60 * 1000);
    const nextMonth = month === 12
      ? { year: year + 1, month: 1 }
      : { year, month: month + 1 };
    const end = new Date(Date.UTC(nextMonth.year, nextMonth.month - 1, 1) - 8 * 60 * 60 * 1000);
    return { start, end };
  }
}
