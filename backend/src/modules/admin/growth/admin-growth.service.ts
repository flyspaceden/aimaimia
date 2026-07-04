import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { maskPhone } from '../../../common/security/privacy-mask';
import { resolveBuyerUserId } from '../../../common/utils/buyer-no.util';
import { resolveGrowthLevelCode, syncGrowthAccountLevel } from '../../growth/growth-config.util';
import { GrowthLevelService } from '../../growth/growth-level.service';
import {
  AdminGrowthAccountQueryDto,
  AdminGrowthAdjustDto,
  AdminGrowthExchangeItemDto,
  AdminGrowthLedgerQueryDto,
  AdminGrowthLevelDto,
  AdminGrowthRuleDto,
  AdminGrowthSettingsDto,
  AdminGrowthUpdateExchangeItemDto,
  AdminNormalShareBindingQueryDto,
} from './dto/admin-growth.dto';

const COUPON_EXCHANGE_TYPES = new Set(['COUPON', 'SHIPPING_COUPON', 'VIP_DISCOUNT_COUPON']);
const GROWTH_SETTINGS = [
  { dtoKey: 'growthEnabled', configKey: 'GROWTH_ENABLED', defaultValue: false },
  { dtoKey: 'pointsExpireDays', configKey: 'GROWTH_POINTS_EXPIRE_DAYS', defaultValue: 365 },
  { dtoKey: 'pointsExpireRemindDays', configKey: 'GROWTH_POINTS_EXPIRE_REMIND_DAYS', defaultValue: 30 },
  { dtoKey: 'dailyPointsCap', configKey: 'GROWTH_DAILY_POINTS_CAP', defaultValue: 300 },
  { dtoKey: 'monthlyPointsCap', configKey: 'GROWTH_MONTHLY_POINTS_CAP', defaultValue: 3000 },
  { dtoKey: 'dailyShareRewardUserCap', configKey: 'GROWTH_DAILY_SHARE_REWARD_USER_CAP', defaultValue: 5 },
  { dtoKey: 'monthlyInviteFirstOrderCap', configKey: 'GROWTH_MONTHLY_INVITE_FIRST_ORDER_CAP', defaultValue: 20 },
  { dtoKey: 'refundReversalEnabled', configKey: 'GROWTH_REFUND_REVERSAL_ENABLED', defaultValue: true },
  { dtoKey: 'autoSuspendExchangeRisk', configKey: 'GROWTH_AUTO_SUSPEND_EXCHANGE_RISK', defaultValue: false },
] as const;
const ALLOWED_BEHAVIOR_CODES = new Set([
  'REGISTER',
  'COMPLETE_PROFILE',
  'BIND_PHONE_OR_WECHAT',
  'CHECK_IN',
  'BROWSE_PRODUCTS',
  'FAVORITE_ITEM',
  'SHARE_CONTENT',
  'FIRST_ORDER_RECEIVED',
  'REVIEW_ORDER',
  'REPURCHASE_RECEIVED',
  'NORMAL_INVITE_REGISTER',
  'NORMAL_INVITE_FIRST_ORDER',
  'VIP_PURCHASE',
  'TASK_COMPLETE',
  'ADMIN_ADJUST',
]);

@Injectable()
export class AdminGrowthService {
  private readonly levelService = new GrowthLevelService();

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ordinaryBuyerWhere = this.buildOrdinaryBuyerWhere();
    const ordinaryBuyerRelationWhere = { user: { is: ordinaryBuyerWhere } };

    const [
      ordinaryBuyerCount,
      accountAgg,
      todayLedgerAgg,
      exchangeRecordCount,
      pendingShareRewardCount,
      activeRuleCount,
      activeExchangeItemCount,
    ] = await Promise.all([
      (this.prisma as any).user.count({
        where: ordinaryBuyerWhere,
      }),
      (this.prisma as any).growthAccount.aggregate({
        where: ordinaryBuyerRelationWhere,
        _sum: {
          pointsBalance: true,
          pointsTotalEarned: true,
          pointsTotalSpent: true,
          growthValue: true,
        },
      }),
      (this.prisma as any).growthLedger.aggregate({
        where: {
          ...ordinaryBuyerRelationWhere,
          createdAt: { gte: today },
          status: 'POSTED',
        },
        _sum: {
          pointsDelta: true,
          growthDelta: true,
        },
      }),
      (this.prisma as any).growthExchangeRecord.count({
        where: {
          ...ordinaryBuyerRelationWhere,
          status: 'SUCCESS',
        },
      }),
      (this.prisma as any).normalShareBinding.count({
        where: {
          rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
        },
      }),
      (this.prisma as any).growthBehaviorRule.count({
        where: { enabled: true },
      }),
      (this.prisma as any).growthExchangeItem.count({
        where: { status: 'ACTIVE' },
      }),
    ]);

    return {
      accountCount: ordinaryBuyerCount ?? 0,
      totalPointsBalance: accountAgg?._sum?.pointsBalance ?? 0,
      totalPointsEarned: accountAgg?._sum?.pointsTotalEarned ?? 0,
      totalPointsSpent: accountAgg?._sum?.pointsTotalSpent ?? 0,
      totalGrowthValue: accountAgg?._sum?.growthValue ?? 0,
      todayPointsDelta: todayLedgerAgg?._sum?.pointsDelta ?? 0,
      todayGrowthDelta: todayLedgerAgg?._sum?.growthDelta ?? 0,
      exchangeSuccessCount: exchangeRecordCount,
      pendingShareRewardCount,
      activeRuleCount,
      activeExchangeItemCount,
    };
  }

  listBehaviorRules() {
    return (this.prisma as any).growthBehaviorRule.findMany({
      include: { category: true },
      orderBy: [{ categoryCode: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getSettings() {
    const configs = await (this.prisma as any).ruleConfig.findMany({
      where: { key: { in: GROWTH_SETTINGS.map((item) => item.configKey) } },
    });
    const configMap = new Map(configs.map((item: any) => [item.key, item.value]));
    return GROWTH_SETTINGS.reduce((acc, item) => {
      acc[item.dtoKey] = configMap.has(item.configKey) ? configMap.get(item.configKey) : item.defaultValue;
      return acc;
    }, {} as Record<string, unknown>);
  }

  async updateSettings(dto: AdminGrowthSettingsDto) {
    const updates = GROWTH_SETTINGS
      .filter((item) => (dto as any)[item.dtoKey] !== undefined)
      .map((item) => ({
        key: item.configKey,
        value: (dto as any)[item.dtoKey],
      }));

    if (updates.length === 0) {
      throw new BadRequestException('没有可保存的成长设置');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        await (tx as any).ruleConfig.upsert({
          where: { key: update.key },
          create: update,
          update: { value: update.value },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.getSettings();
  }

  listLevels() {
    return (this.prisma as any).growthLevel.findMany({
      orderBy: [{ threshold: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async upsertBehaviorRule(dto: AdminGrowthRuleDto) {
    this.assertKnownBehaviorCode(dto.code);

    const data = {
      code: dto.code.trim(),
      name: dto.name.trim(),
      categoryCode: dto.categoryCode.trim(),
      pointsReward: dto.pointsReward ?? 0,
      growthReward: dto.growthReward ?? 0,
      grantTiming: dto.grantTiming ?? 'IMMEDIATE',
      dailyLimit: dto.dailyLimit ?? null,
      weeklyLimit: dto.weeklyLimit ?? null,
      monthlyLimit: dto.monthlyLimit ?? null,
      lifetimeLimit: dto.lifetimeLimit ?? null,
      applicableUserType: dto.applicableUserType ?? 'ALL',
      vipPointsMultiplier: dto.vipPointsMultiplier ?? null,
      vipGrowthMultiplier: dto.vipGrowthMultiplier ?? null,
      riskPolicy: this.toJsonOrNull(dto.riskPolicy),
      startAt: dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      enabled: dto.enabled ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };
    this.assertDateRange(data.startAt, data.endAt);

    return (this.prisma as any).growthBehaviorRule.upsert({
      where: { code: data.code },
      create: data,
      update: {
        name: data.name,
        categoryCode: data.categoryCode,
        pointsReward: data.pointsReward,
        growthReward: data.growthReward,
        grantTiming: data.grantTiming,
        dailyLimit: data.dailyLimit,
        weeklyLimit: data.weeklyLimit,
        monthlyLimit: data.monthlyLimit,
        lifetimeLimit: data.lifetimeLimit,
        applicableUserType: data.applicableUserType,
        vipPointsMultiplier: data.vipPointsMultiplier,
        vipGrowthMultiplier: data.vipGrowthMultiplier,
        riskPolicy: data.riskPolicy,
        startAt: data.startAt,
        endAt: data.endAt,
        enabled: data.enabled,
        sortOrder: data.sortOrder,
      },
    });
  }

  async replaceLevels(levels: AdminGrowthLevelDto[]) {
    const normalized = this.normalizeLevels(levels);

    return this.prisma.$transaction(async (tx) => {
      await (tx as any).growthLevel.deleteMany({});
      await (tx as any).growthLevel.createMany({
        data: normalized,
      });
      await this.refreshAllAccountLevelCodes(tx);
      return (tx as any).growthLevel.findMany({
        orderBy: [{ threshold: 'asc' }, { sortOrder: 'asc' }],
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  listExchangeItems() {
    return (this.prisma as any).growthExchangeItem.findMany({
      include: {
        requiredLevel: true,
        couponCampaign: {
          select: {
            id: true,
            name: true,
            status: true,
            triggerType: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createExchangeItem(dto: AdminGrowthExchangeItemDto) {
    const data = this.normalizeExchangeItem(dto);
    return (this.prisma as any).growthExchangeItem.create({ data });
  }

  async updateExchangeItem(id: string, dto: AdminGrowthUpdateExchangeItemDto) {
    const existing = await (this.prisma as any).growthExchangeItem.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('兑换项不存在');
    }
    const data = this.normalizeExchangeItemUpdate(existing, dto);
    return (this.prisma as any).growthExchangeItem.update({
      where: { id },
      data,
    });
  }

  async listUserAccounts(query: AdminGrowthAccountQueryDto = {}) {
    const page = this.page(query.page);
    const pageSize = this.pageSize(query.pageSize);
    const levels = await (this.prisma as any).growthLevel.findMany({
      where: { enabled: true },
      orderBy: [{ threshold: 'asc' }, { sortOrder: 'asc' }],
    });
    const where = this.buildUserAccountWhere(query, levels);
    const orderBy = this.buildUserAccountOrderBy(query);

    const [items, total] = await Promise.all([
      (this.prisma as any).user.findMany({
        where,
        include: this.userAccountInclude(),
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
      }),
      (this.prisma as any).user.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapUserAccount(item, levels)),
      total,
      page,
      pageSize,
    };
  }

  async listLedgers(query: AdminGrowthLedgerQueryDto = {}) {
    const page = this.page(query.page);
    const pageSize = this.pageSize(query.pageSize);
    const where: any = {};
    if (query.userId) {
      where.userId = await resolveBuyerUserId(this.prisma as any, query.userId);
    }
    if (query.behaviorCode) where.behaviorCode = query.behaviorCode;
    if (query.type) where.type = query.type;

    const [items, total] = await Promise.all([
      (this.prisma as any).growthLedger.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true, avatarUrl: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).growthLedger.count({ where }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        user: item.user ? this.mapUser(item.user) : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async listNormalShareBindings(query: AdminNormalShareBindingQueryDto = {}) {
    const page = this.page(query.page);
    const pageSize = this.pageSize(query.pageSize);
    const where: any = {};
    if (query.rewardStatus) where.rewardStatus = query.rewardStatus;
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.OR = [
        { code: { contains: keyword, mode: 'insensitive' } },
        { inviter: { buyerNo: { contains: keyword, mode: 'insensitive' } } },
        { invitee: { buyerNo: { contains: keyword, mode: 'insensitive' } } },
        { inviterUserId: keyword },
        { inviteeUserId: keyword },
      ];
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).normalShareBinding.findMany({
        where,
        include: {
          inviter: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true, avatarUrl: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
          invitee: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true, avatarUrl: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).normalShareBinding.count({ where }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        inviter: item.inviter ? this.mapUser(item.inviter) : null,
        invitee: item.invitee ? this.mapUser(item.invitee) : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async adjustUser(userIdOrBuyerNo: string, dto: AdminGrowthAdjustDto, adminId: string) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('手动调整必须填写原因');
    }

    const pointsDelta = dto.pointsDelta ?? 0;
    const growthDelta = dto.growthDelta ?? 0;
    if (pointsDelta === 0 && growthDelta === 0) {
      throw new BadRequestException('积分或成长值至少调整一项');
    }

    const resolvedUserId = await resolveBuyerUserId(this.prisma as any, userIdOrBuyerNo);
    const user = await (this.prisma as any).user.findUnique({
      where: { id: resolvedUserId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await (tx as any).growthAccount.findUnique({
        where: { userId: resolvedUserId },
      });
      if (!existing && (pointsDelta < 0 || growthDelta < 0)) {
        throw new BadRequestException('账户不存在，不能扣减积分或成长值');
      }
      if (existing && existing.pointsBalance + pointsDelta < 0) {
        throw new BadRequestException('普通积分余额不足，不能扣减');
      }
      if (existing && existing.growthValue + growthDelta < 0) {
        throw new BadRequestException('成长值不足，不能扣减');
      }

      const account = await (tx as any).growthAccount.upsert({
        where: { userId: resolvedUserId },
        create: {
          userId: resolvedUserId,
          pointsBalance: pointsDelta,
          pointsTotalEarned: Math.max(0, pointsDelta),
          pointsTotalSpent: Math.max(0, -pointsDelta),
          growthValue: growthDelta,
        },
        update: {
          pointsBalance: { increment: pointsDelta },
          pointsTotalEarned: { increment: Math.max(0, pointsDelta) },
          ...(pointsDelta < 0
            ? { pointsTotalSpent: { increment: Math.max(0, -pointsDelta) } }
            : {}),
          growthValue: { increment: growthDelta },
        },
      });
      await syncGrowthAccountLevel(tx as any, account);

      await (tx as any).userProfile.upsert({
        where: { userId: resolvedUserId },
        create: {
          userId: resolvedUserId,
          points: pointsDelta,
          growthPoints: growthDelta,
        },
        update: {
          points: { increment: pointsDelta },
          growthPoints: { increment: growthDelta },
        },
      });

      return (tx as any).growthLedger.create({
        data: {
          userId: resolvedUserId,
          accountId: account.id,
          type: 'ADMIN_ADJUST',
          behaviorCode: 'ADMIN_ADJUST',
          pointsDelta,
          growthDelta,
          status: 'POSTED',
          idempotencyKey: `ADMIN_ADJUST:${adminId}:${resolvedUserId}:${Date.now()}:${randomUUID()}`,
          meta: { adminId, reason },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setNormalShareProfileStatus(
    userIdOrBuyerNo: string,
    status: 'ACTIVE' | 'DISABLED',
    reason?: string,
  ) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma as any, userIdOrBuyerNo);
    const profile = await (this.prisma as any).normalShareProfile.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!profile) {
      throw new NotFoundException('普通分享码不存在');
    }

    return (this.prisma as any).normalShareProfile.update({
      where: { userId: resolvedUserId },
      data: {
        status,
        disabledReason: status === 'DISABLED'
          ? (reason?.trim() || '管理员停用')
          : null,
      },
    });
  }

  private assertKnownBehaviorCode(code: string) {
    if (!ALLOWED_BEHAVIOR_CODES.has(code.trim())) {
      throw new BadRequestException(`不支持的成长行为码: ${code}`);
    }
  }

  private normalizeLevels(levels: AdminGrowthLevelDto[]) {
    if (!Array.isArray(levels) || levels.length === 0) {
      throw new BadRequestException('成长等级不能为空');
    }
    const normalized = levels
      .map((level, index) => ({
        code: level.code.trim(),
        name: level.name.trim(),
        threshold: level.threshold,
        benefits: this.toJsonOrNull(level.benefits),
        avatarFrameType: level.avatarFrameType ?? null,
        titleLabel: level.titleLabel ?? null,
        monthlyExchangeLimit: level.monthlyExchangeLimit ?? null,
        sortOrder: level.sortOrder ?? index,
        enabled: level.enabled ?? true,
      }))
      .sort((a, b) => a.threshold - b.threshold);

    if (normalized[0]?.threshold !== 0) {
      throw new BadRequestException('成长等级必须包含 threshold=0 的起始等级');
    }

    const codes = new Set<string>();
    const thresholds = new Set<number>();
    for (let i = 0; i < normalized.length; i += 1) {
      const level = normalized[i];
      if (!level.code || !level.name) {
        throw new BadRequestException('成长等级 code/name 不能为空');
      }
      if (codes.has(level.code)) {
        throw new BadRequestException(`成长等级 code 重复: ${level.code}`);
      }
      if (thresholds.has(level.threshold)) {
        throw new BadRequestException(`成长等级 threshold 重复: ${level.threshold}`);
      }
      if (i > 0 && level.threshold <= normalized[i - 1].threshold) {
        throw new BadRequestException('成长等级 threshold 必须严格递增');
      }
      codes.add(level.code);
      thresholds.add(level.threshold);
    }

    return normalized;
  }

  private normalizeExchangeItem(dto: AdminGrowthExchangeItemDto) {
    this.assertExchangeItem(dto.type, dto.pointsCost, dto.couponCampaignId, dto.startAt, dto.endAt);
    return {
      type: dto.type,
      name: dto.name.trim(),
      description: dto.description ?? null,
      pointsCost: dto.pointsCost,
      couponCampaignId: dto.couponCampaignId ?? null,
      stockTotal: dto.stockTotal ?? null,
      stockDaily: dto.stockDaily ?? null,
      perUserDailyLimit: dto.perUserDailyLimit ?? null,
      perUserMonthlyLimit: dto.perUserMonthlyLimit ?? null,
      requiredLevelCode: dto.requiredLevelCode ?? null,
      startAt: dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      status: dto.status ?? 'ACTIVE',
      sortOrder: dto.sortOrder ?? 0,
    };
  }

  private async refreshAllAccountLevelCodes(tx: Prisma.TransactionClient) {
    const accounts = await (tx as any).growthAccount.findMany({
      select: { id: true, growthValue: true, currentLevelCode: true },
    });
    for (const account of accounts) {
      const nextLevelCode = await resolveGrowthLevelCode(tx as any, account.growthValue);
      if ((account.currentLevelCode ?? null) !== nextLevelCode) {
        await (tx as any).growthAccount.update({
          where: { id: account.id },
          data: { currentLevelCode: nextLevelCode },
        });
      }
    }
  }

  private normalizeExchangeItemUpdate(existing: any, dto: AdminGrowthUpdateExchangeItemDto) {
    const merged = {
      type: dto.type ?? existing.type,
      pointsCost: dto.pointsCost ?? existing.pointsCost,
      couponCampaignId: dto.couponCampaignId === undefined ? existing.couponCampaignId : dto.couponCampaignId,
      startAt: dto.startAt === undefined ? existing.startAt : dto.startAt,
      endAt: dto.endAt === undefined ? existing.endAt : dto.endAt,
    };
    this.assertExchangeItem(
      merged.type,
      merged.pointsCost,
      merged.couponCampaignId,
      merged.startAt instanceof Date ? merged.startAt.toISOString() : merged.startAt,
      merged.endAt instanceof Date ? merged.endAt.toISOString() : merged.endAt,
    );

    const data: Record<string, unknown> = {};
    for (const key of [
      'type',
      'name',
      'description',
      'pointsCost',
      'couponCampaignId',
      'stockTotal',
      'stockDaily',
      'perUserDailyLimit',
      'perUserMonthlyLimit',
      'requiredLevelCode',
      'status',
      'sortOrder',
    ]) {
      if ((dto as any)[key] !== undefined) {
        data[key] = key === 'name' && typeof (dto as any)[key] === 'string'
          ? (dto as any)[key].trim()
          : (dto as any)[key];
      }
    }
    if (dto.startAt !== undefined) data.startAt = dto.startAt ? new Date(dto.startAt) : null;
    if (dto.endAt !== undefined) data.endAt = dto.endAt ? new Date(dto.endAt) : null;
    return data;
  }

  private assertExchangeItem(
    type: string,
    pointsCost: number,
    couponCampaignId?: string | null,
    startAt?: string | null,
    endAt?: string | null,
  ) {
    if (pointsCost <= 0) {
      throw new BadRequestException('兑换积分必须大于 0');
    }
    if (COUPON_EXCHANGE_TYPES.has(type) && !couponCampaignId) {
      throw new BadRequestException('红包类兑换项必须绑定红包活动');
    }
    this.assertDateRange(startAt ? new Date(startAt) : null, endAt ? new Date(endAt) : null);
  }

  private assertDateRange(startAt?: Date | null, endAt?: Date | null) {
    if (startAt && Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('开始时间格式不正确');
    }
    if (endAt && Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('结束时间格式不正确');
    }
    if (startAt && endAt && startAt >= endAt) {
      throw new BadRequestException('开始时间必须早于结束时间');
    }
  }

  private buildOrdinaryBuyerWhere() {
    return {
      buyerNo: { not: null },
      status: 'ACTIVE',
      deletionExecutedAt: null,
      OR: [
        { memberProfile: { is: null } },
        { memberProfile: { is: { tier: { not: 'VIP' } } } },
      ],
    };
  }

  private buildUserAccountWhere(query: AdminGrowthAccountQueryDto, levels: any[]) {
    const where: any = { ...this.buildOrdinaryBuyerWhere() };
    const clauses: any[] = [];
    if (query.levelCode) {
      const levelFilter = this.buildLevelAccountFilter(query.levelCode, levels);
      if (levelFilter) {
        clauses.push(levelFilter);
      }
    }
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      clauses.push({
        OR: [
          { id: keyword },
          { buyerNo: { contains: keyword, mode: 'insensitive' } },
          { profile: { is: { nickname: { contains: keyword, mode: 'insensitive' } } } },
          { authIdentities: { some: { identifier: { contains: keyword } } } },
        ],
      });
    }
    if (clauses.length > 0) {
      where.AND = clauses;
    }
    return where;
  }

  private buildLevelAccountFilter(levelCode: string, levels: any[]) {
    const sortedLevels = [...levels].sort((a, b) => Number(a.threshold ?? 0) - Number(b.threshold ?? 0));
    const selectedIndex = sortedLevels.findIndex((level) => level.code === levelCode);
    if (selectedIndex < 0) {
      return { growthAccount: { is: { currentLevelCode: levelCode } } };
    }

    const selectedLevel = sortedLevels[selectedIndex];
    const nextLevel = sortedLevels[selectedIndex + 1];
    const growthValueRange: any = { gte: Number(selectedLevel.threshold ?? 0) };
    if (nextLevel) {
      growthValueRange.lt = Number(nextLevel.threshold ?? 0);
    }

    const accountLevelMatches: any[] = [
      { growthAccount: { is: { currentLevelCode: levelCode } } },
      {
        growthAccount: {
          is: {
            currentLevelCode: null,
            growthValue: growthValueRange,
          },
        },
      },
    ];
    if (Number(selectedLevel.threshold ?? 0) === 0) {
      accountLevelMatches.unshift({ growthAccount: { is: null } });
    }
    return { OR: accountLevelMatches };
  }

  private buildUserAccountOrderBy(query: AdminGrowthAccountQueryDto) {
    const sortBy = query.sortBy ?? 'updatedAt';
    const direction = query.sortOrder === 'asc' || query.sortOrder === 'ascend' ? 'asc' : 'desc';
    if (sortBy === 'updatedAt') {
      return [
        { growthAccount: { updatedAt: direction } },
        { updatedAt: direction },
        { id: 'asc' },
      ];
    }
    return [
      { growthAccount: { [sortBy]: direction } },
      { updatedAt: 'desc' },
      { id: 'asc' },
    ];
  }

  private userAccountInclude() {
    return {
      profile: { select: { nickname: true, avatarUrl: true } },
      memberProfile: { select: { tier: true } },
      normalShareProfile: { select: { code: true, status: true } },
      growthAccount: {
        include: {
          currentLevel: true,
        },
      },
      authIdentities: {
        where: { provider: 'PHONE' },
        select: { identifier: true },
        take: 1,
      },
    };
  }

  private mapUserAccount(user: any, levels: any[]) {
    const account = user.growthAccount;
    const growthValue = account?.growthValue ?? 0;
    const levelState = this.levelService.resolveLevel(growthValue, levels);
    const currentLevel = account?.currentLevel ?? levelState.level ?? null;
    return {
      id: account?.id ?? `virtual-growth-account:${user.id}`,
      userId: user.id,
      pointsBalance: account?.pointsBalance ?? 0,
      pointsTotalEarned: account?.pointsTotalEarned ?? 0,
      pointsTotalSpent: account?.pointsTotalSpent ?? 0,
      growthValue,
      currentLevelCode: account?.currentLevelCode ?? currentLevel?.code ?? null,
      currentLevel,
      createdAt: account?.createdAt ?? user.createdAt,
      updatedAt: account?.updatedAt ?? user.updatedAt,
      user: this.mapUser(user),
    };
  }

  private mapUser(user: any) {
    return {
      id: user.id,
      buyerNo: user.buyerNo ?? null,
      nickname: user.profile?.nickname ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      phone: maskPhone(user.authIdentities?.[0]?.identifier ?? null),
      status: user.status ?? null,
      vipStatus: user.memberProfile?.tier ?? null,
      normalShareCode: user.normalShareProfile?.code ?? null,
      normalShareStatus: user.normalShareProfile?.status ?? null,
    };
  }

  private page(value?: number) {
    return Math.max(1, Number(value ?? 1));
  }

  private pageSize(value?: number) {
    return Math.min(100, Math.max(1, Number(value ?? 20)));
  }

  private toJsonOrNull(value: unknown) {
    if (value === undefined || value === null) {
      return Prisma.JsonNull;
    }
    return value as Prisma.InputJsonValue;
  }
}
