import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponEngineService } from '../coupon/coupon-engine.service';

/** 7 天固定奖励表 */
const REWARD_TABLE = [
  { day: 1, label: '第1天', points: 5 },
  { day: 2, label: '第2天', points: 8 },
  { day: 3, label: '第3天', points: 10 },
  { day: 4, label: '第4天', points: 12 },
  { day: 5, label: '第5天', points: 15 },
  { day: 6, label: '第6天', points: 20 },
  { day: 7, label: '第7天', points: 50, highlight: true },
];

@Injectable()
export class CheckInService {
  private readonly logger = new Logger(CheckInService.name);

  constructor(
    private prisma: PrismaService,
    private couponEngine: CouponEngineService,
  ) {}

  /** 签到状态 */
  async getStatus(userId: string) {
    const todayStr = this.getTodayStr();
    const streakDays = await this.calcStreakDays(userId);

    const todayRecord = await this.prisma.checkIn.findUnique({
      where: { userId_date: { userId, date: todayStr } },
    });

    return this.buildStatusResponse(streakDays, !!todayRecord);
  }

  /** 执行签到 — H10修复：Serializable 隔离级别 + P2034 重试 + P2002 幂等 */
  async checkIn(userId: string) {
    const todayStr = this.getTodayStr();

    const currentStreak = await this.calcStreakDays(userId);
    const nextStreak = Math.min(7, currentStreak + 1);

    const reward = REWARD_TABLE.find((r) => r.day === nextStreak);
    const pointsToAdd = reward?.points ?? 5;

    // H10修复：使用 Serializable 隔离级别防止快速双击绕过重复检查
    // CheckIn 表有 @@unique([userId, date])，若并发写入会触发 P2002
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // 在事务内检查是否已签到（Serializable 保证读写一致性）
          const existing = await tx.checkIn.findUnique({
            where: { userId_date: { userId, date: todayStr } },
          });
          if (existing) throw new BadRequestException('今日已签到');

          await tx.checkIn.create({
            data: { userId, date: todayStr },
          });

          await tx.userProfile.upsert({
            where: { userId },
            create: { userId, points: pointsToAdd },
            update: { points: { increment: pointsToAdd } },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        // Phase F: 签到触发红包发放（fire-and-forget，传递连续签到天数）
        this.couponEngine.handleTrigger(userId, 'CHECK_IN', {
          consecutiveDays: nextStreak,
        }).catch((err: any) => {
          this.logger.warn(`CHECK_IN 红包触发失败: userId=${userId}, streakDays=${nextStreak}, error=${err?.message}`);
        });

        return this.buildStatusResponse(nextStreak, true, reward);
      } catch (e: any) {
        // P2034: Serializable 序列化冲突，重试
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(`签到序列化冲突，重试 attempt=${attempt + 1}: userId=${userId}`);
          continue;
        }
        // P2002: 唯一约束冲突（并发双击），视为幂等——今日已签到
        if (e?.code === 'P2002') {
          throw new BadRequestException('今日已签到');
        }
        throw e;
      }
    }

    // 不应到达此处，但作为安全兜底
    throw new BadRequestException('签到失败，请稍后重试');
  }

  /** 重置签到（测试用） */
  async reset(userId: string) {
    await this.prisma.checkIn.deleteMany({ where: { userId } });
    return this.buildStatusResponse(0, false);
  }

  /** 计算连续签到天数 */
  private async calcStreakDays(userId: string): Promise<number> {
    const today = new Date();
    let streak = 0;

    const todayStr = this.formatDate(today);
    const todayRecord = await this.prisma.checkIn.findUnique({
      where: { userId_date: { userId, date: todayStr } },
    });

    if (todayRecord) {
      streak = 1;
      for (let i = 1; i <= 6; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = this.formatDate(d);
        const record = await this.prisma.checkIn.findUnique({
          where: { userId_date: { userId, date: dateStr } },
        });
        if (!record) break;
        streak++;
      }
    } else {
      for (let i = 1; i <= 6; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = this.formatDate(d);
        const record = await this.prisma.checkIn.findUnique({
          where: { userId_date: { userId, date: dateStr } },
        });
        if (!record) break;
        streak++;
      }
    }

    return Math.min(7, streak);
  }

  /** 构建返回格式 */
  private buildStatusResponse(
    streakDays: number,
    todayChecked: boolean,
    lastReward?: typeof REWARD_TABLE[number],
  ) {
    return {
      streakDays,
      todayChecked,
      rewards: REWARD_TABLE.map((r) => ({
        day: r.day,
        label: r.label,
        points: r.points,
        highlight: (r as any).highlight || undefined,
      })),
      lastReward: lastReward
        ? { day: lastReward.day, label: lastReward.label, points: lastReward.points }
        : undefined,
    };
  }

  private getTodayStr(): string {
    return this.formatDate(new Date());
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
