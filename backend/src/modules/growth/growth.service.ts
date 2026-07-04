import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthLevelService } from './growth-level.service';

@Injectable()
export class GrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly levelService: GrowthLevelService = new GrowthLevelService(),
  ) {}

  async getMe(userId: string) {
    const [account, levels] = await Promise.all([
      this.prisma.growthAccount.upsert({
        where: { userId },
        create: {
          userId,
          pointsBalance: 0,
          pointsTotalEarned: 0,
          pointsTotalSpent: 0,
          growthValue: 0,
        },
        update: {},
      }),
      this.prisma.growthLevel.findMany({
        where: { enabled: true },
        orderBy: { threshold: 'asc' },
      }),
    ]);

    const pointsBalance = account?.pointsBalance ?? 0;
    const pointsTotalEarned = account?.pointsTotalEarned ?? 0;
    const pointsTotalSpent = account?.pointsTotalSpent ?? 0;
    const growthValue = account?.growthValue ?? 0;
    const levelState = this.levelService.resolveLevel(growthValue, levels);

    return {
      pointsBalance,
      pointsTotalEarned,
      pointsTotalSpent,
      growthValue,
      ...levelState,
      updatedAt: account?.updatedAt ?? null,
    };
  }

  async getGuide(userId: string) {
    const memberProfile = await (this.prisma as any).memberProfile?.findUnique?.({
      where: { userId },
      select: { tier: true },
    });
    const userType = memberProfile?.tier === 'VIP' ? 'VIP' : 'NORMAL';
    const applicableTypes = ['ALL', userType];
    const now = new Date();
    const [rules, levels] = await Promise.all([
      (this.prisma as any).growthBehaviorRule.findMany({
        where: {
          enabled: true,
          OR: applicableTypes.map((type) => ({ applicableUserType: type })),
          AND: [
            { OR: [{ startAt: null }, { startAt: { lte: now } }] },
            { OR: [{ endAt: null }, { endAt: { gt: now } }] },
          ],
        },
        orderBy: [{ categoryCode: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.growthLevel.findMany({
        where: { enabled: true },
        orderBy: [{ threshold: 'asc' }, { sortOrder: 'asc' }],
      }),
    ]);

    const publicRules = rules
      .filter((rule: any) => rule.code !== 'ADMIN_ADJUST')
      .filter((rule: any) => Number(rule.pointsReward ?? 0) !== 0 || Number(rule.growthReward ?? 0) !== 0)
      .map((rule: any) => this.toPublicRule(rule));
    const inviteCodes = new Set(['NORMAL_INVITE_REGISTER', 'NORMAL_INVITE_FIRST_ORDER']);

    return {
      inviteRules: publicRules.filter((rule: any) => inviteCodes.has(rule.code)),
      earningRules: publicRules.filter((rule: any) => !inviteCodes.has(rule.code)),
      levels: levels.map((level: any) => this.toPublicLevel(level)),
      pointsNote: '普通积分用于兑换红包和权益，兑换时会消耗。',
      growthNote: '成长值用于升级，不会因为积分兑换而减少。',
    };
  }

  private toPublicRule(rule: any) {
    return {
      code: rule.code,
      name: rule.name,
      categoryCode: rule.categoryCode,
      pointsReward: rule.pointsReward ?? 0,
      growthReward: rule.growthReward ?? 0,
      grantTiming: rule.grantTiming,
      dailyLimit: rule.dailyLimit ?? null,
      weeklyLimit: rule.weeklyLimit ?? null,
      monthlyLimit: rule.monthlyLimit ?? null,
      lifetimeLimit: rule.lifetimeLimit ?? null,
      sortOrder: rule.sortOrder ?? 0,
    };
  }

  private toPublicLevel(level: any) {
    return {
      code: level.code,
      name: level.name,
      threshold: level.threshold,
      benefits: level.benefits ?? null,
      avatarFrameType: level.avatarFrameType ?? null,
      titleLabel: level.titleLabel ?? null,
      monthlyExchangeLimit: level.monthlyExchangeLimit ?? null,
    };
  }
}
