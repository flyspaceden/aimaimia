import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusConfigService } from '../bonus/engine/bonus-config.service';
import { isWiredGrowthBehaviorCode } from './growth-config.util';
import { GrowthLevelService } from './growth-level.service';

@Injectable()
export class GrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly levelService: GrowthLevelService = new GrowthLevelService(),
    private readonly bonusConfig?: BonusConfigService,
  ) {}

  async getMe(userId: string) {
    const [account, levels, memberProfile, digitalAssetAccount, bonusConfig] = await Promise.all([
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
      (this.prisma as any).memberProfile?.findUnique?.({
        where: { userId },
        select: { tier: true, inviterUserId: true },
      }),
      (this.prisma as any).digitalAssetAccount?.findUnique?.({
        where: { userId },
        select: { cumulativeSpendAmount: true },
      }),
      this.getBonusConfig(),
    ]);

    const pointsBalance = account?.pointsBalance ?? 0;
    const pointsTotalEarned = account?.pointsTotalEarned ?? 0;
    const pointsTotalSpent = account?.pointsTotalSpent ?? 0;
    const growthValue = account?.growthValue ?? 0;
    const levelState = this.levelService.resolveLevel(growthValue, levels);
    const directReferral = await this.getDirectReferralSummary(userId, memberProfile);
    const cumulativeSpendAmount = Number(digitalAssetAccount?.cumulativeSpendAmount ?? 0);
    const autoVipCumulativeSpendThreshold = Number(bonusConfig.autoVipCumulativeSpendThreshold ?? 399);
    const autoVipBySpendEnabled = Boolean(bonusConfig.autoVipBySpendEnabled);
    const autoVipRemainingSpend =
      memberProfile?.tier === 'VIP' || !autoVipBySpendEnabled
        ? null
        : Number(Math.max(0, autoVipCumulativeSpendThreshold - cumulativeSpendAmount).toFixed(2));

    return {
      pointsBalance,
      pointsTotalEarned,
      pointsTotalSpent,
      growthValue,
      ...levelState,
      updatedAt: account?.updatedAt ?? null,
      directReferralStatus: directReferral.status,
      directReferralInviter: directReferral.inviter,
      autoVipBySpendEnabled,
      autoVipCumulativeSpendThreshold,
      autoVipRemainingSpend,
      directReferralPercent:
        memberProfile?.tier === 'VIP'
          ? bonusConfig.vipDirectReferralPercent ?? null
          : bonusConfig.normalDirectReferralPercent ?? null,
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
      .filter((rule: any) => isWiredGrowthBehaviorCode(rule.code))
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

  private async getBonusConfig() {
    if (this.bonusConfig) {
      return this.bonusConfig.getConfig();
    }
    return {
      autoVipBySpendEnabled: true,
      autoVipCumulativeSpendThreshold: 399,
      normalDirectReferralPercent: 0.01,
      vipDirectReferralPercent: 0.05,
    };
  }

  private async getDirectReferralSummary(userId: string, memberProfile: any) {
    const activeInviterUserId = memberProfile?.inviterUserId ?? null;
    const binding = await (this.prisma as any).normalShareBinding?.findUnique?.({
      where: { inviteeUserId: userId },
      select: {
        inviterUserId: true,
        relationStatus: true,
        effectiveInviterUserId: true,
      },
    });
    if (activeInviterUserId) {
      if (
        binding?.inviterUserId === activeInviterUserId &&
        binding.relationStatus &&
        binding.relationStatus !== 'ACTIVE' &&
        binding.relationStatus !== 'SUPERSEDED_BY_VIP_TREE'
      ) {
        return {
          status: binding.relationStatus,
          inviter: null,
        };
      }
      return {
        status: 'ACTIVE',
        inviter: await this.getUserSummary(activeInviterUserId),
      };
    }

    const effectiveInviterUserId = binding?.effectiveInviterUserId ?? null;
    return {
      status: binding?.relationStatus ?? null,
      inviter: effectiveInviterUserId ? await this.getUserSummary(effectiveInviterUserId) : null,
    };
  }

  private async getUserSummary(userId: string) {
    const user = await (this.prisma as any).user?.findUnique?.({
      where: { id: userId },
      select: {
        id: true,
        buyerNo: true,
        profile: { select: { nickname: true } },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      nickname: user.profile?.nickname ?? null,
      buyerNo: user.buyerNo ?? null,
    };
  }
}
