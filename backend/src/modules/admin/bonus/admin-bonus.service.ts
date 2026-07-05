import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { AlipayService } from '../../payment/alipay.service';
import { WithdrawPayoutService } from '../../bonus/withdraw-payout.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import {
  UpdateWithdrawRulesDto,
  WithdrawRules,
} from './dto/update-withdraw-rules.dto';
import { normalizeBuyerNo, resolveBuyerUserId } from '../../../common/utils/buyer-no.util';

type VipNodeStatus = 'active' | 'silent' | 'frozen' | 'exited';

const NORMAL_TREE_ROOT_VIEW_ID = '__NORMAL_TREE_ROOT__';

const WITHDRAW_RULE_DEFINITIONS: {
  [K in keyof WithdrawRules]: {
    key: string;
    defaultValue: WithdrawRules[K];
    description: string;
    min?: number;
    max?: number;
    integer?: boolean;
  };
} = {
  withdrawTaxRate: {
    key: 'WITHDRAW_TAX_RATE',
    defaultValue: 0.20,
    description: '提现代扣个税比例',
    min: 0,
    max: 0.5,
  },
  withdrawMinAmount: {
    key: 'WITHDRAW_MIN_AMOUNT',
    defaultValue: 10,
    description: '提现单笔最低（元）',
    min: 0,
  },
  withdrawMaxAmount: {
    key: 'WITHDRAW_MAX_AMOUNT',
    defaultValue: 10000,
    description: '提现单笔最高（元）',
    min: 0,
  },
  withdrawDailyMaxCount: {
    key: 'WITHDRAW_DAILY_MAX_COUNT',
    defaultValue: 3,
    description: '提现每日最多次数',
    min: 1,
    max: 100,
    integer: true,
  },
  withdrawCooldownSeconds: {
    key: 'WITHDRAW_COOLDOWN_SECONDS',
    defaultValue: 60,
    description: '提现间冷却时间（秒）',
    min: 0,
    max: 86400,
    integer: true,
  },
  withdrawYearlyMaxAmount: {
    key: 'WITHDRAW_YEARLY_MAX_AMOUNT',
    defaultValue: 50000,
    description: '单用户年累计提现上限（元）',
    min: 0,
  },
  deductionRatioNormal: {
    key: 'DEDUCTION_RATIO_NORMAL',
    defaultValue: 0.10,
    description: '普通用户抵扣比例上限',
    min: 0,
    max: 1,
  },
  deductionRatioVip: {
    key: 'DEDUCTION_RATIO_VIP',
    defaultValue: 0.15,
    description: 'VIP 用户抵扣比例上限',
    min: 0,
    max: 1,
  },
  deductionMinOrderAmount: {
    key: 'DEDUCTION_MIN_ORDER_AMOUNT',
    defaultValue: 0,
    description: '最低订单门槛（元）',
    min: 0,
  },
  deductionAllowCouponStack: {
    key: 'DEDUCTION_ALLOW_COUPON_STACK',
    defaultValue: true,
    description: '是否允许与平台红包叠加',
  },
  withdrawProviderFeeAmount: {
    key: 'WITHDRAW_PROVIDER_FEE_AMOUNT',
    defaultValue: 0,
    description: '单笔通道手续费（元，v1.0=0）',
    min: 0,
  },
  withdrawYearlyAlertThreshold: {
    key: 'WITHDRAW_YEARLY_ALERT_THRESHOLD',
    defaultValue: 0.80,
    description: '年累计达到上限百分之多少时告警',
    min: 0,
    max: 1,
  },
};

@Injectable()
export class AdminBonusService {
  private readonly logger = new Logger(AdminBonusService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private moduleRef: ModuleRef,
    private bonusConfig: BonusConfigService,
  ) {}

  /**
   * 计算"已实际解锁的下级分润层级"用于前端展示。
   *
   * 背景：VipProgress.unlockedLevel 字段的实际语义是
   * "上次有 VIP_UPSTREAM FROZEN 流水被释放时记录的层级戳"
   * （见 vip-upstream.service.ts `unlockFrozenRewards`）。
   * 如果用户自购充足、下级买东西时永远 AVAILABLE 直接到账、
   * 从未积累过 FROZEN VIP_UPSTREAM 流水，则该字段永远为 0，
   * 与"已解锁层级"的直觉语义不符。
   *
   * 真正的"已解锁层级"取决于 selfPurchaseCount 与 vipMaxLayers 上限。
   */
  private computeUnlockedLevel(selfPurchaseCount: number, vipMaxLayers: number): number {
    // 防御异常配置（如 vipMaxLayers=0 或负数），避免输出负值
    const safeMax = Math.max(vipMaxLayers, 0);
    const safeCount = Math.max(selfPurchaseCount, 0);
    return Math.min(safeCount, safeMax);
  }

  /**
   * VIP 会员统计：总数、今日/本周/本月新增。
   * "新增"按 vipPurchasedAt 计算（成为 VIP 的时间，非 profile 创建时间），
   * "本周"按周一起算，"本月"按月初 1 号起算。
   * 时间均用服务器本地时间（与 app-users.getStats 保持一致）。
   */
  async getMembersStats() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    // 周一为一周开始（getDay: 0=周日, 1=周一, ..., 6=周六）
    const startOfWeek = new Date(startOfDay);
    const dayOfWeek = startOfDay.getDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfWeek.setDate(startOfDay.getDate() - daysSinceMonday);

    const startOfMonth = new Date(startOfDay);
    startOfMonth.setDate(1);

    const vipWhere = { tier: 'VIP' as const };
    const [totalVips, newToday, newThisWeek, newThisMonth] = await Promise.all([
      this.prisma.memberProfile.count({ where: vipWhere }),
      this.prisma.memberProfile.count({
        where: { ...vipWhere, vipPurchasedAt: { gte: startOfDay } },
      }),
      this.prisma.memberProfile.count({
        where: { ...vipWhere, vipPurchasedAt: { gte: startOfWeek } },
      }),
      this.prisma.memberProfile.count({
        where: { ...vipWhere, vipPurchasedAt: { gte: startOfMonth } },
      }),
    ]);

    return { totalVips, newToday, newThisWeek, newThisMonth };
  }

  /** VIP 会员列表 */
  async findMembers(
    page = 1,
    pageSize = 20,
    tier?: string,
    keyword?: string,
    sortField?: string,
    sortOrder?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: Prisma.MemberProfileWhereInput = {};
    if (tier) where.tier = tier as any;
    const orderBy = this.buildMemberOrderBy(sortField, sortOrder);

    const trimmedKeyword = keyword?.trim();
    if (trimmedKeyword) {
      const normalizedKeyword = normalizeBuyerNo(trimmedKeyword);
      where.OR = [
        { referralCode: { contains: trimmedKeyword, mode: 'insensitive' } },
        { user: { buyerNo: normalizedKeyword } },
        { user: { profile: { nickname: { contains: trimmedKeyword } } } },
        // 手机号或微信 openId/unionId 任意子串命中
        {
          user: {
            authIdentities: {
              some: {
                provider: { in: ['PHONE', 'WECHAT'] },
                OR: [
                  { identifier: { contains: trimmedKeyword } },
                  { unionId: { contains: trimmedKeyword } },
                ],
              },
            },
          },
        },
      ];
    }

    // 用于计算前端展示的"已解锁层级"上限，
    // 见 computeUnlockedLevel 注释
    const config = await this.bonusConfig.getConfig();

    const [profiles, total] = await Promise.all([
      this.prisma.memberProfile.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          user: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true } },
              authIdentities: {
                // 同时取 PHONE 与 WECHAT，前端先优先展示手机号，
                // 没手机号的微信登录用户兜底展示微信 openId
                where: { provider: { in: ['PHONE', 'WECHAT'] } },
                select: { provider: true, identifier: true, unionId: true },
              },
              vipPurchase: {
                select: { amount: true, packageId: true, status: true },
              },
              vipProgress: {
                select: { selfPurchaseCount: true, unlockedLevel: true },
              },
            },
          },
        },
      }),
      this.prisma.memberProfile.count({ where }),
    ]);

    const userIds = profiles.map((p) => p.userId);
    const inviterIds = Array.from(
      new Set(
        profiles
          .map((p) => p.inviterUserId)
          .filter((id): id is string => !!id),
      ),
    );

    const [rewardAccounts, treeNodes, inviterProfiles, inviteeVipCounts] =
      await Promise.all([
        userIds.length
          ? this.prisma.rewardAccount.findMany({
              where: { userId: { in: userIds }, type: 'VIP_REWARD' },
              select: { userId: true, balance: true, frozen: true },
            })
          : Promise.resolve([] as Array<{ userId: string; balance: number; frozen: number }>),
        userIds.length
          ? this.prisma.vipTreeNode.findMany({
              where: { userId: { in: userIds } },
              select: { userId: true, rootId: true, level: true, position: true },
            })
          : Promise.resolve(
              [] as Array<{
                userId: string | null;
                rootId: string;
                level: number;
                position: number;
              }>,
            ),
        inviterIds.length
          ? this.prisma.user.findMany({
              where: { id: { in: inviterIds } },
              select: {
                id: true,
                buyerNo: true,
                profile: { select: { nickname: true } },
              },
            })
          : Promise.resolve(
              [] as Array<{
                id: string;
                profile: { nickname: string | null } | null;
              }>,
            ),
        userIds.length
          ? this.prisma.memberProfile.groupBy({
              by: ['inviterUserId'],
              where: { inviterUserId: { in: userIds }, tier: 'VIP' },
              _count: { inviterUserId: true },
            })
          : Promise.resolve(
              [] as Array<{
                inviterUserId: string | null;
                _count: { inviterUserId: number };
              }>,
            ),
      ]);

    const walletByUser = new Map(
      rewardAccounts.map((a) => [a.userId, { balance: a.balance, frozen: a.frozen }]),
    );
    const treeByUser = new Map(
      treeNodes
        .filter((n): n is typeof n & { userId: string } => !!n.userId)
        .map((n) => [n.userId, { rootId: n.rootId, level: n.level, position: n.position }]),
    );
    const inviterByUser = new Map(
      inviterProfiles.map((u) => [u.id, u.profile?.nickname ?? null]),
    );
    const inviteeCountByUser = new Map(
      inviteeVipCounts
        .filter((g): g is typeof g & { inviterUserId: string } => !!g.inviterUserId)
        .map((g) => [g.inviterUserId, g._count.inviterUserId]),
    );

    const items = profiles.map((p) => {
      const identities = p.user?.authIdentities ?? [];
      const phoneIdentity = identities.find((i) => i.provider === 'PHONE');
      const wechatIdentity = identities.find((i) => i.provider === 'WECHAT');
      const phone = phoneIdentity?.identifier ?? null;
      const wechatOpenId = wechatIdentity?.identifier ?? null;
      const wechatUnionId = wechatIdentity?.unionId ?? null;
      const wallet = walletByUser.get(p.userId) ?? { balance: 0, frozen: 0 };
      const tree = treeByUser.get(p.userId) ?? null;
      const vipPurchase = p.user?.vipPurchase ?? null;
      const progress = p.user?.vipProgress ?? null;
      return {
        id: p.id,
        userId: p.userId,
        buyerNo: p.user?.buyerNo ?? null,
        user: { id: p.userId, buyerNo: p.user?.buyerNo ?? null, profile: { nickname: p.user?.profile?.nickname ?? null } },
        tier: p.tier,
        referralCode: p.referralCode,
        inviterUserId: p.inviterUserId,
        inviterNickname: p.inviterUserId
          ? inviterByUser.get(p.inviterUserId) ?? null
          : null,
        inviteeVipCount: inviteeCountByUser.get(p.userId) ?? 0,
        vipPurchasedAt: p.vipPurchasedAt,
        vipNodeId: p.vipNodeId,
        normalEligible: p.normalEligible,
        phone,
        wechatOpenId,
        wechatUnionId,
        wallet,
        treeRootId: tree?.rootId ?? null,
        treeLevel: tree?.level ?? null,
        treePosition: tree?.position ?? null,
        selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
        // 不直接返回 progress.unlockedLevel：该字段在数据库里实际是
        // "上次有 FROZEN VIP_UPSTREAM 被释放时的层级戳"，对自购充足
        // 的用户永远是 0，会误导后台运营。用 computeUnlockedLevel 修正。
        unlockedLevel: this.computeUnlockedLevel(
          progress?.selfPurchaseCount ?? 0,
          config.vipMaxLayers,
        ),
        vipPurchase: vipPurchase
          ? {
              amount: vipPurchase.amount,
              packageId: vipPurchase.packageId,
              status: vipPurchase.status,
            }
          : null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    return { items, total, page, pageSize };
  }

  private buildMemberOrderBy(sortField?: string, sortOrder?: string) {
    const direction = sortOrder === 'asc' || sortOrder === 'ascend' ? 'asc' : 'desc';
    if (sortField === 'selfPurchaseCount') {
      return [
        { user: { vipProgress: { selfPurchaseCount: direction } } },
        { vipPurchasedAt: 'desc' },
        { id: 'asc' },
      ] as any;
    }
    if (sortField === 'createdAt') {
      return [
        { createdAt: direction },
        { id: 'asc' },
      ] as any;
    }
    return [
      { vipPurchasedAt: direction },
      { createdAt: direction },
      { id: 'asc' },
    ] as any;
  }

  /** 提现审核列表 */
  async findWithdrawals(
    page = 1,
    pageSize = 20,
    status?: string,
    channel?: string,
    accountType?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (accountType) where.accountType = accountType;

    const [items, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getWithdrawRules(): Promise<WithdrawRules> {
    const fields = Object.keys(WITHDRAW_RULE_DEFINITIONS) as Array<keyof WithdrawRules>;
    const configs = await this.prisma.ruleConfig.findMany({
      where: { key: { in: fields.map((field) => WITHDRAW_RULE_DEFINITIONS[field].key) } },
    });
    const byKey = new Map(configs.map((item) => [item.key, item.value]));

    const rules = {} as WithdrawRules;
    for (const field of fields) {
      const def = WITHDRAW_RULE_DEFINITIONS[field];
      const raw = byKey.has(def.key) ? this.extractConfigValue(byKey.get(def.key)) : def.defaultValue;
      (rules as any)[field] = this.coerceRuleValue(raw, def.defaultValue);
    }
    return rules;
  }

  async updateWithdrawRules(dto: UpdateWithdrawRulesDto): Promise<WithdrawRules> {
    const updates = this.normalizeWithdrawRuleUpdates(dto);
    if (updates.length === 0) {
      throw new BadRequestException('至少需要提交一个规则字段');
    }
    const current = await this.getWithdrawRules();
    const next = { ...current, ...dto };
    this.validateWithdrawRules(next);

    await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        await tx.ruleConfig.upsert({
          where: { key: update.key },
          update: { value: update.value as Prisma.InputJsonValue },
          create: { key: update.key, value: update.value as Prisma.InputJsonValue },
        });
      }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return this.getWithdrawRules();
  }

  async getTaxReportSummary(year: number, month: number) {
    const { start, end } = this.resolveMonthWindow(year, month);
    const hasTaxAmount = await this.hasWithdrawColumn('taxAmount');
    const hasNetAmount = await this.hasWithdrawColumn('netAmount');
    const dateColumn = await this.getWithdrawPaidDateColumn();
    const taxAmountExpr = hasTaxAmount ? Prisma.sql`COALESCE("taxAmount", 0)` : Prisma.sql`0`;
    const netAmountExpr = hasNetAmount ? Prisma.sql`COALESCE("netAmount", "amount")` : Prisma.sql`"amount"`;

    const rows = await this.prisma.$queryRaw<Array<{
      count: number | bigint;
      grossTotal: number | null;
      taxTotal: number | null;
      netTotal: number | null;
    }>>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "count",
        COALESCE(SUM("amount"), 0)::float AS "grossTotal",
        COALESCE(SUM(${taxAmountExpr}), 0)::float AS "taxTotal",
        COALESCE(SUM(${netAmountExpr}), 0)::float AS "netTotal"
      FROM "WithdrawRequest"
      WHERE "deletedAt" IS NULL
        AND "status"::text = 'PAID'
        AND ${dateColumn} >= ${start}
        AND ${dateColumn} < ${end}
    `);
    const row = rows[0] ?? { count: 0, grossTotal: 0, taxTotal: 0, netTotal: 0 };

    return {
      year,
      month,
      count: Number(row.count ?? 0),
      grossTotal: this.money(this.toNumber(row.grossTotal)),
      taxTotal: this.money(this.toNumber(row.taxTotal)),
      netTotal: this.money(this.toNumber(row.netTotal)),
    };
  }

  async getTaxReportDetail(year: number, month: number) {
    const { start, end } = this.resolveMonthWindow(year, month);
    const [
      hasTaxAmount,
      hasNetAmount,
      hasTaxRate,
      hasPaidAt,
      hasProviderFundOrderId,
    ] = await Promise.all([
      this.hasWithdrawColumn('taxAmount'),
      this.hasWithdrawColumn('netAmount'),
      this.hasWithdrawColumn('taxRate'),
      this.hasWithdrawColumn('paidAt'),
      this.hasWithdrawColumn('providerFundOrderId'),
    ]);
    const dateColumn = hasPaidAt ? Prisma.sql`"paidAt"` : Prisma.sql`"updatedAt"`;
    const taxAmountExpr = hasTaxAmount ? Prisma.sql`COALESCE("taxAmount", 0)` : Prisma.sql`0`;
    const netAmountExpr = hasNetAmount ? Prisma.sql`COALESCE("netAmount", "amount")` : Prisma.sql`"amount"`;
    const taxRateExpr = hasTaxRate ? Prisma.sql`COALESCE("taxRate", 0)` : Prisma.sql`0`;
    const providerFundOrderIdExpr = hasProviderFundOrderId
      ? Prisma.sql`"providerFundOrderId"`
      : Prisma.sql`NULL::text`;

    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      userId: string;
      amount: number;
      taxAmount: number;
      netAmount: number;
      taxRate: number;
      paidAt: Date | null;
      providerPayoutId: string | null;
      providerFundOrderId: string | null;
    }>>(Prisma.sql`
      SELECT
        "id",
        "userId",
        "amount"::float AS "amount",
        ${taxAmountExpr}::float AS "taxAmount",
        ${netAmountExpr}::float AS "netAmount",
        ${taxRateExpr}::float AS "taxRate",
        ${dateColumn} AS "paidAt",
        "providerPayoutId",
        ${providerFundOrderIdExpr} AS "providerFundOrderId"
      FROM "WithdrawRequest"
      WHERE "deletedAt" IS NULL
        AND "status"::text = 'PAID'
        AND ${dateColumn} >= ${start}
        AND ${dateColumn} < ${end}
      ORDER BY ${dateColumn} ASC
    `);

    return rows.map((row) => ({
      ...row,
      amount: this.money(row.amount),
      taxAmount: this.money(row.taxAmount),
      netAmount: this.money(row.netAmount),
      taxRate: this.toNumber(row.taxRate),
      paidAt: row.paidAt?.toISOString() ?? null,
    }));
  }

  async generateTaxVoucher(year: number, month: number) {
    const [summary, detail] = await Promise.all([
      this.getTaxReportSummary(year, month),
      this.getTaxReportDetail(year, month),
    ]);
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const headers = [
      '提现单号',
      '用户ID',
      '提现总额',
      '代扣个税',
      '实际到账',
      '税率',
      '到账时间',
      '支付宝单号',
      '资金流水号',
    ];
    const rows = detail.map((row) => [
      row.id,
      row.userId,
      row.amount.toFixed(2),
      row.taxAmount.toFixed(2),
      row.netAmount.toFixed(2),
      row.taxRate.toString(),
      row.paidAt ?? '',
      row.providerPayoutId ?? '',
      row.providerFundOrderId ?? '',
    ]);
    const csv = [
      `爱买买提现代扣凭证,${ym}`,
      `提现笔数,${summary.count}`,
      `提现总额,${summary.grossTotal.toFixed(2)}`,
      `代扣总额,${summary.taxTotal.toFixed(2)}`,
      `实际到账,${summary.netTotal.toFixed(2)}`,
      '',
      headers.map((cell) => this.csvCell(cell)).join(','),
      ...rows.map((row) => row.map((cell) => this.csvCell(cell)).join(',')),
    ].join('\n');

    return {
      fileName: `tax-voucher-${ym}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: csv,
      summary,
    };
  }

  async manualQueryWithdrawStatus(withdrawId: string) {
    const hasOutBizNo = await this.hasWithdrawColumn('outBizNo');
    const outBizNoExpr = hasOutBizNo ? Prisma.sql`"outBizNo"` : Prisma.sql`NULL::text`;
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      status: string;
      outBizNo: string | null;
    }>>(Prisma.sql`
      SELECT "id", "status"::text AS "status", ${outBizNoExpr} AS "outBizNo"
      FROM "WithdrawRequest"
      WHERE "id" = ${withdrawId}
      LIMIT 1
    `);
    const withdraw = rows[0];
    if (!withdraw) throw new NotFoundException('提现记录不存在');
    if (withdraw.status !== 'PROCESSING') {
      return {
        ok: true,
        message: `当前状态 ${withdraw.status}，无需查询`,
        newStatus: withdraw.status,
      };
    }
    if (!withdraw.outBizNo) {
      throw new BadRequestException('提现记录缺 outBizNo，无法查询');
    }

    const alipayService = this.resolveAlipayService();
    const queryResult = await alipayService.queryTransfer({ outBizNo: withdraw.outBizNo });
    await this.markWithdrawQueried(withdrawId);

    if (queryResult.status === 'SUCCESS') {
      await this.finalizeWithdrawalPaid(withdrawId, {
        providerOrderId: queryResult.orderId,
        providerFundOrderId: queryResult.payFundOrderId,
      });
      return { ok: true, message: '已确认支付宝转账成功，状态更新为 PAID', newStatus: 'PAID' };
    }
    if (queryResult.status === 'FAIL') {
      await this.finalizeWithdrawalFailed(withdrawId, {
        errorCode: queryResult.errorCode,
        errorMessage: queryResult.errorMessage,
      });
      return { ok: true, message: '支付宝查询返回失败，已退款', newStatus: 'FAILED' };
    }

    return {
      ok: true,
      message: `支付宝侧仍为 ${queryResult.status ?? 'PROCESSING'}，请稍后再查或等 cron 兜底`,
      newStatus: 'PROCESSING',
    };
  }

  private normalizeWithdrawRuleUpdates(dto: UpdateWithdrawRulesDto) {
    const updates: Array<{ key: string; value: { value: unknown; description: string } }> = [];
    const fields = Object.keys(WITHDRAW_RULE_DEFINITIONS) as Array<keyof WithdrawRules>;

    for (const field of fields) {
      const raw = dto[field];
      if (raw === undefined || raw === null) continue;
      const def = WITHDRAW_RULE_DEFINITIONS[field];
      const value = this.coerceRuleValue(raw, def.defaultValue);
      if (typeof def.defaultValue === 'number') {
        const num = value as number;
        if (!Number.isFinite(num)) {
          throw new BadRequestException(`${def.key} 必须是有效数字`);
        }
        if (def.integer && !Number.isInteger(num)) {
          throw new BadRequestException(`${def.key} 必须是整数`);
        }
        if (def.min !== undefined && num < def.min) {
          throw new BadRequestException(`${def.key} 不能小于 ${def.min}`);
        }
        if (def.max !== undefined && num > def.max) {
          throw new BadRequestException(`${def.key} 不能大于 ${def.max}`);
        }
      }
      updates.push({
        key: def.key,
        value: { value, description: def.description },
      });
    }

    const min = updates.find((item) => item.key === 'WITHDRAW_MIN_AMOUNT')?.value.value;
    const max = updates.find((item) => item.key === 'WITHDRAW_MAX_AMOUNT')?.value.value;
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new BadRequestException('提现单笔最低金额不能大于单笔最高金额');
    }

    return updates;
  }

  private validateWithdrawRules(rules: WithdrawRules) {
    if (rules.withdrawMinAmount > rules.withdrawMaxAmount) {
      throw new BadRequestException('提现单笔最低金额不能大于单笔最高金额');
    }
    if (rules.withdrawProviderFeeAmount >= rules.withdrawMinAmount) {
      throw new BadRequestException('提现通道手续费必须低于单笔最低提现金额');
    }
    if (rules.withdrawTaxRate < 0 || rules.withdrawTaxRate > 0.5) {
      throw new BadRequestException('提现个税比例必须在 0-0.5 之间');
    }
    if (rules.deductionRatioNormal < 0 || rules.deductionRatioNormal > 1) {
      throw new BadRequestException('普通用户抵扣比例必须在 0-1 之间');
    }
    if (rules.deductionRatioVip < 0 || rules.deductionRatioVip > 1) {
      throw new BadRequestException('VIP 用户抵扣比例必须在 0-1 之间');
    }
    if (rules.withdrawYearlyAlertThreshold < 0 || rules.withdrawYearlyAlertThreshold > 1) {
      throw new BadRequestException('年累计告警阈值必须在 0-1 之间');
    }
  }

  private extractConfigValue(raw: unknown) {
    if (
      raw !== null &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      'value' in raw
    ) {
      return (raw as { value: unknown }).value;
    }
    return raw;
  }

  private coerceRuleValue<T extends WithdrawRules[keyof WithdrawRules]>(
    value: unknown,
    fallback: T,
  ): T {
    if (typeof fallback === 'boolean') {
      return (typeof value === 'boolean' ? value : fallback) as T;
    }
    const num = typeof value === 'number' ? value : Number(value);
    return (Number.isFinite(num) ? num : fallback) as T;
  }

  private resolveMonthWindow(year: number, month: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('year 参数非法');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month 参数非法');
    }
    return {
      start: new Date(year, month - 1, 1),
      end: new Date(year, month, 1),
    };
  }

  private async getWithdrawPaidDateColumn() {
    return (await this.hasWithdrawColumn('paidAt'))
      ? Prisma.sql`"paidAt"`
      : Prisma.sql`"updatedAt"`;
  }

  private async hasWithdrawColumn(columnName: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'WithdrawRequest'
          AND column_name = ${columnName}
      ) AS "exists"
    `);
    return rows[0]?.exists === true;
  }

  private async markWithdrawQueried(withdrawId: string) {
    const [hasLastQueriedAt, hasQueryAttempts] = await Promise.all([
      this.hasWithdrawColumn('lastQueriedAt'),
      this.hasWithdrawColumn('queryAttempts'),
    ]);
    const assignments: Prisma.Sql[] = [];
    if (hasLastQueriedAt) assignments.push(Prisma.sql`"lastQueriedAt" = NOW()`);
    if (hasQueryAttempts) assignments.push(Prisma.sql`"queryAttempts" = COALESCE("queryAttempts", 0) + 1`);
    if (assignments.length === 0) return;

    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "WithdrawRequest"
      SET ${Prisma.join(assignments, ', ')}
      WHERE "id" = ${withdrawId}
    `);
  }

  private async finalizeWithdrawalPaid(
    withdrawId: string,
    providerResult: { providerOrderId?: string; providerFundOrderId?: string },
  ) {
    await this.resolveWithdrawPayoutService().finalizeWithdrawalPaid(withdrawId, providerResult);
  }

  private async finalizeWithdrawalFailed(
    withdrawId: string,
    providerResult: { errorCode?: string; errorMessage?: string },
  ) {
    await this.resolveWithdrawPayoutService().finalizeWithdrawalFailed(withdrawId, providerResult);
  }

  private resolveAlipayService(): AlipayService & {
    queryTransfer(params: { outBizNo: string }): Promise<any>;
  } {
    try {
      const service = this.moduleRef.get(AlipayService, { strict: false }) as AlipayService & {
        queryTransfer?: (params: { outBizNo: string }) => Promise<any>;
      };
      if (typeof service?.queryTransfer === 'function') {
        return service as AlipayService & {
          queryTransfer(params: { outBizNo: string }): Promise<any>;
        };
      }
    } catch (err) {
      this.logger.warn(`运行时查找 AlipayService 失败: ${(err as Error)?.message}`);
    }
    throw new BadRequestException('支付宝转账查询服务尚未接入，无法手动查询');
  }

  private resolveWithdrawPayoutService(): WithdrawPayoutService {
    try {
      const service = this.moduleRef.get(WithdrawPayoutService, { strict: false });
      if (service) return service;
    } catch (err) {
      this.logger.warn(`运行时查找 WithdrawPayoutService 失败: ${(err as Error)?.message}`);
    }
    throw new BadRequestException('提现出款服务尚未接入，无法完成状态同步');
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return 0;
    return Number(value) || 0;
  }

  private money(value: number | null | undefined): number {
    return Number((value ?? 0).toFixed(2));
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  /** 审批提现：扣减冻结金额（实际打款为占位实现） */
  async approveWithdraw(id: string, adminUserId: string) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!withdraw) throw new NotFoundException('提现申请不存在');
    if (withdraw.status !== 'REQUESTED') {
      throw new BadRequestException('仅待审核的提现可审批');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 状态 CAS：仅允许 REQUESTED -> APPROVED
      const cas = await tx.withdrawRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status: 'APPROVED',
          reviewerAdminId: adminUserId,
        },
      });
      if (cas.count === 0) {
        throw new BadRequestException('该提现申请已被处理，请刷新后重试');
      }

      const updated = await tx.withdrawRequest.findUnique({
        where: { id },
      });
      if (!updated) {
        throw new NotFoundException('提现申请不存在');
      }

      // 扣减冻结金额（CAS 守卫，防止并发审批导致 frozen 变负数）
      // 使用 withdraw.accountType 动态确定账户类型，支持 VIP_REWARD 和 NORMAL_REWARD
      const frozenCas = await tx.rewardAccount.updateMany({
        where: {
          userId: withdraw.userId,
          type: withdraw.accountType as any,
          frozen: { gte: withdraw.amount },
        },
        data: { frozen: { decrement: withdraw.amount } },
      });
      if (frozenCas.count === 0) {
        throw new BadRequestException('冻结余额不足，可能存在并发操作');
      }

      // P0-4: 更新提现流水为已提现
      await tx.rewardLedger.updateMany({
        where: { refType: 'WITHDRAW', refId: id, status: 'FROZEN' },
        data: { status: 'WITHDRAWN' },
      });

      await this.notificationService.emit({
        eventType: 'withdraw.approved',
        aggregateType: 'withdrawRequest',
        aggregateId: id,
        idempotencyKey: `withdraw:${id}:approved`,
        actor: { kind: 'admin', id: adminUserId },
        payload: {
          withdrawId: id,
          userId: withdraw.userId,
          amount: withdraw.amount,
        },
      }, tx as any);

      return updated;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return result;
  }

  /** 会员详情 — 聚合钱包、树位置、收支流水、提现记录 */
  async getMemberDetail(userId: string) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma, userId);
    const [user, member, progress, accounts, node] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: resolvedUserId },
        select: {
          id: true,
          buyerNo: true,
          profile: { select: { nickname: true, avatarUrl: true } },
          authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        },
      }),
      this.prisma.memberProfile.findUnique({ where: { userId: resolvedUserId } }),
      this.prisma.vipProgress.findUnique({ where: { userId: resolvedUserId } }),
      // 三个可提现账户合并算余额（与买家 App 端 BonusService.getWallet 一致）
      this.prisma.rewardAccount.findMany({
        where: { userId: resolvedUserId, type: { in: ['VIP_REWARD', 'NORMAL_REWARD', 'INDUSTRY_FUND'] } },
      }),
      this.prisma.vipTreeNode.findUnique({ where: { userId: resolvedUserId } }),
    ]);
    if (!user) throw new NotFoundException('用户不存在');

    // 累计收入只统计奖励入账流水；提现流水是资金转出，不能二次计入收入。
    const earned = await this.prisma.rewardLedger.aggregate({
      where: {
        userId: resolvedUserId,
        entryType: 'RELEASE',
        status: 'AVAILABLE',
        account: { type: { in: ['VIP_REWARD', 'NORMAL_REWARD', 'INDUSTRY_FUND'] } },
      },
      _sum: { amount: true },
    });

    // 子节点数
    const childCount = node
      ? await this.prisma.vipTreeNode.count({ where: { parentId: node.id } })
      : 0;

    // 上级用户
    let parentUserId: string | null = null;
    if (node?.parentId) {
      const parentNode = await this.prisma.vipTreeNode.findUnique({ where: { id: node.parentId } });
      parentUserId = parentNode?.userId ?? null;
    }

    // 收支流水（最近 20 条）—— join account 拿 account.type 让前端区分 VIP奖励/产业基金/普通分润
    const ledgers = await this.prisma.rewardLedger.findMany({
      where: { userId: resolvedUserId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        entryType: true,
        amount: true,
        status: true,
        refType: true,
        refId: true,
        createdAt: true,
        account: { select: { type: true } },
      },
    });

    // 提现记录（最近 10 条）
    const withdrawals = await this.prisma.withdrawRequest.findMany({
      where: { userId: resolvedUserId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amount: true,
        status: true,
        channel: true,
        createdAt: true,
        reviewerAdminId: true,
      },
    });

    return {
      userId: user.id,
      buyerNo: user.buyerNo ?? null,
      nickname: user.profile?.nickname ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      phone: user.authIdentities?.[0]?.identifier ?? null,
      tier: member?.tier ?? 'NORMAL',
      referralCode: member?.referralCode ?? null,
      inviterUserId: member?.inviterUserId ?? null,
      vipPurchasedAt: member?.vipPurchasedAt?.toISOString() ?? null,
      wallet: {
        // 3 个账户合并：VIP_REWARD + NORMAL_REWARD + INDUSTRY_FUND
        balance: accounts.reduce((s, a) => s + a.balance, 0),
        frozen: accounts.reduce((s, a) => s + a.frozen, 0),
        totalEarned: earned._sum.amount ?? 0,
      },
      tree: node ? await (async () => {
        const config = await this.bonusConfig.getConfig();
        return {
          level: node.level,
          position: node.position,
          parentUserId,
          childCount,
          selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
          // 见 computeUnlockedLevel 注释：不直接用 progress.unlockedLevel
          unlockedLevel: this.computeUnlockedLevel(
            progress?.selfPurchaseCount ?? 0,
            config.vipMaxLayers,
          ),
          exitedAt: progress?.exitedAt?.toISOString() ?? null,
        };
      })() : null,
      ledgers,
      withdrawals,
    };
  }

  // ============ VIP 树可视化 ============

  /** 获取以指定用户为中心的 VIP 树上下文（面包屑 + 父节点 + 当前 + 子节点） */
  async getVipTreeContext(userId: string, descendantDepth = 1) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma, userId);
    // 查找用户的树节点
    let node = await this.prisma.vipTreeNode.findUnique({
      where: { userId: resolvedUserId },
    });
    // 支持通过节点 ID 访问系统根节点（userId 为 null）
    if (!node) {
      node = await this.prisma.vipTreeNode.findUnique({
        where: { id: resolvedUserId },
      });
    }
    if (!node) throw new NotFoundException('该用户不在 VIP 树中');

    // 系统根节点特殊处理（userId 为 null）
    const isSystemRoot = node.userId === null;

    // 构建面包屑（从当前节点沿 parentId 向上遍历至根）
    const breadcrumb: Array<{ userId: string; buyerNo: string | null; nickname: string | null; level: number }> = [];
    let cur = node;
    // H7修复：增加环路保护（visited Set + 最大跳数），避免脏数据导致无限循环
    const visitedNodeIds = new Set<string>([node.id]);
    const maxBreadcrumbHops = 64;
    let hops = 0;
    while (cur.parentId) {
      if (hops >= maxBreadcrumbHops) break;
      if (visitedNodeIds.has(cur.parentId)) break;
      visitedNodeIds.add(cur.parentId);
      hops++;

      const parent = await this.prisma.vipTreeNode.findUnique({
        where: { id: cur.parentId },
      });
      if (!parent || !parent.userId) break;
      // 查昵称
      const parentUser = await this.prisma.user.findUnique({
        where: { id: parent.userId },
        select: { buyerNo: true, profile: { select: { nickname: true } } },
      });
      breadcrumb.unshift({
        userId: parent.userId,
        buyerNo: parentUser?.buyerNo ?? null,
        nickname: parentUser?.profile?.nickname ?? parent.userId,
        level: parent.level,
      });
      cur = parent;
    }

    // 当前节点详情
    const childCount = await this.prisma.vipTreeNode.count({ where: { parentId: node.id } });
    const currentView = isSystemRoot
      ? {
          userId: node.id,
          buyerNo: null,
          nickname: node.rootId ?? node.id,
          phone: null,
          tier: 'VIP' as const,
          selfPurchaseCount: 0,
          totalEarned: 0,
          frozenAmount: 0,
          childCount,
          level: node.level,
          status: 'active' as VipNodeStatus,
          isSystemNode: true,
          joinedTreeAt: node.createdAt?.toISOString() ?? null,
          position: node.position,
          unlockedLevel: 0,
          exitedAt: null,
          rootId: node.rootId,
          referrerUserId: null,
          referrerNickname: null,
          entryMode: 'SYSTEM' as const,
        }
      : await this.buildNodeView(node.userId!);

    // 父节点详情
    let parentView = null;
    if (node.parentId) {
      const parentNode = await this.prisma.vipTreeNode.findUnique({ where: { id: node.parentId } });
      if (parentNode?.userId) parentView = await this.buildNodeView(parentNode.userId);
    }

    // Clamp descendantDepth to 1-5
    const safeDepth = Math.max(1, Math.min(5, descendantDepth));
    const nodeCount = { count: 0 };
    const MAX_NODES = 100;

    // 递归加载子树
    const subtree = await this.buildVipSubtree(node.id, safeDepth, nodeCount, MAX_NODES);

    return { breadcrumb, parent: parentView, current: currentView, children: subtree.nodes, truncated: subtree.truncated };
  }

  /** 懒加载子节点 */
  async getVipTreeChildren(nodeUserId: string) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma, nodeUserId);
    const node = await this.prisma.vipTreeNode.findUnique({ where: { userId: resolvedUserId } });
    if (!node) throw new NotFoundException('节点不存在');

    const childNodes = await this.prisma.vipTreeNode.findMany({
      where: { parentId: node.id },
      orderBy: { position: 'asc' },
    });
    return {
      children: await Promise.all(
        childNodes.filter((c) => c.userId).map((c) => this.buildNodeView(c.userId!)),
      ),
    };
  }

  /** 搜索用户（用于 VIP 树搜索框） */
  async searchUsers(keyword: string, limit = 10) {
    // 搜索手机号、用户ID 或昵称
    const normalizedKeyword = normalizeBuyerNo(keyword);
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: { contains: keyword } },
          { buyerNo: normalizedKeyword },
          { authIdentities: { some: { provider: 'PHONE', identifier: { contains: keyword } } } },
          { profile: { nickname: { contains: keyword } } },
        ],
      },
      take: limit,
      select: {
        id: true,
        buyerNo: true,
        profile: { select: { nickname: true, avatarUrl: true } },
        authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        memberProfile: { select: { tier: true, vipNodeId: true } },
      },
    });

    const userIds = users.map((u) => u.id);
    const [progresses, frozenAccounts] = await Promise.all([
      this.prisma.vipProgress.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, selfPurchaseCount: true, exitedAt: true },
      }),
      this.prisma.rewardAccount.findMany({
        where: { userId: { in: userIds }, type: 'VIP_REWARD' },
        select: { userId: true, frozen: true },
      }),
    ]);
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));
    const frozenMap = new Map(frozenAccounts.map((item) => [item.userId, item.frozen]));

    return users.map((u) => ({
      userId: u.id,
      buyerNo: u.buyerNo ?? null,
      nickname: u.profile?.nickname ?? null,
      phone: u.authIdentities?.[0]?.identifier ?? null,
      avatarUrl: u.profile?.avatarUrl ?? null,
      tier: u.memberProfile?.tier ?? 'NORMAL',
      treeStatus: this.resolveVipNodeStatus(
        !!u.memberProfile?.vipNodeId,
        progressMap.get(u.id)?.selfPurchaseCount ?? 0,
        progressMap.get(u.id)?.exitedAt ?? null,
        frozenMap.get(u.id) ?? 0,
      ),
      hasVipNode: !!u.memberProfile?.vipNodeId,
    }));
  }

  /** 搜索普通树用户（返回所有用户，标注是否已入普通树） */
  async searchNormalTreeUsers(keyword: string, limit = 10) {
    const normalizedKeyword = normalizeBuyerNo(keyword);
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: { contains: keyword } },
          { buyerNo: normalizedKeyword },
          { authIdentities: { some: { provider: 'PHONE', identifier: { contains: keyword } } } },
          { profile: { nickname: { contains: keyword } } },
        ],
      },
      take: Math.max(limit * 3, limit),
      select: {
        id: true,
        buyerNo: true,
        profile: { select: { nickname: true, avatarUrl: true } },
        authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        memberProfile: { select: { tier: true, normalTreeNodeId: true } },
      },
    });

    const userIds = users.map((u) => u.id);
    const progresses = await this.prisma.normalProgress.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, selfPurchaseCount: true, frozenAt: true },
    });
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));

    return users
      .slice(0, limit)
      .map((u) => ({
        userId: u.id,
        buyerNo: u.buyerNo ?? null,
        nickname: u.profile?.nickname ?? null,
        phone: u.authIdentities?.[0]?.identifier ?? null,
        avatarUrl: u.profile?.avatarUrl ?? null,
        tier: u.memberProfile?.tier ?? 'NORMAL',
        treeStatus: this.resolveNormalNodeStatus(
          !!u.memberProfile?.normalTreeNodeId,
          u.memberProfile?.tier ?? 'NORMAL',
          progressMap.get(u.id)?.selfPurchaseCount ?? 0,
          progressMap.get(u.id)?.frozenAt ?? null,
        ),
        hasNormalNode: !!u.memberProfile?.normalTreeNodeId,
      }));
  }

  private resolveVipNodeStatus(
    hasNode: boolean,
    selfPurchaseCount: number,
    exitedAt: Date | null,
    frozenAmount: number,
  ): VipNodeStatus | null {
    if (!hasNode) return null;
    if (exitedAt) return 'exited';
    if (frozenAmount > 0) return 'frozen';
    if (selfPurchaseCount === 0) return 'silent';
    return 'active';
  }

  private resolveNormalNodeStatus(
    hasNode: boolean,
    tier: string,
    selfPurchaseCount: number,
    frozenAt: Date | null,
  ): VipNodeStatus | null {
    if (!hasNode) return null;
    if (tier === 'VIP' || frozenAt) return 'frozen';
    if (selfPurchaseCount === 0) return 'silent';
    return 'active';
  }

  /** 构建节点视图（聚合统计） */
  private async buildNodeView(userId: string) {
    const [node, user, progress, account, frozenAccount, memberProfile] = await Promise.all([
      this.prisma.vipTreeNode.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          buyerNo: true,
          profile: { select: { nickname: true } },
          authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        },
      }),
      this.prisma.vipProgress.findUnique({ where: { userId } }),
      this.prisma.rewardAccount.findUnique({
        where: { userId_type: { userId, type: 'VIP_REWARD' } },
      }),
      this.prisma.rewardAccount.findUnique({
        where: { userId_type: { userId, type: 'VIP_REWARD' } },
        select: { frozen: true },
      }),
      this.prisma.memberProfile.findUnique({
        where: { userId },
        select: { inviterUserId: true, vipPurchasedAt: true },
      }),
    ]);

    // 查询推荐人昵称
    let referrerNickname: string | null = null;
    let referrerBuyerNo: string | null = null;
    if (memberProfile?.inviterUserId) {
      const referrer = await this.prisma.user.findUnique({
        where: { id: memberProfile.inviterUserId },
        select: { buyerNo: true, profile: { select: { nickname: true } } },
      });
      referrerNickname = referrer?.profile?.nickname ?? null;
      referrerBuyerNo = referrer?.buyerNo ?? null;
    }

    // 累计收入只统计奖励入账流水；提现流水是资金转出，不能二次计入收入。
    const earned = await this.prisma.rewardLedger.aggregate({
      where: {
        userId,
        entryType: 'RELEASE',
        status: 'AVAILABLE',
        account: { type: 'VIP_REWARD' },
      },
      _sum: { amount: true },
    });

    // 子节点数
    const childCount = node
      ? await this.prisma.vipTreeNode.count({ where: { parentId: node.id } })
      : 0;

    // 判断状态
    const phone = user?.authIdentities?.[0]?.identifier ?? null;
    const isSystem = userId.startsWith('A') && /^A\d+$/.test(userId);
    let status: VipNodeStatus = 'active';
    if (progress?.exitedAt) {
      status = 'exited';
    } else if ((frozenAccount?.frozen ?? 0) > 0) {
      status = 'frozen';
    } else if ((progress?.selfPurchaseCount ?? 0) === 0 && !isSystem) {
      status = 'silent';
    }

    // 入树方式推断
    // SYSTEM = 高管根节点 A1-A10
    // REFERRAL = 有推荐人，落入推荐人子树（可能直接挂或 BFS 滑落到子树空位）
    // AUTO_PLACE = 无推荐人，由系统 BFS 自动分配到全局空位
    const entryMode = isSystem ? 'SYSTEM' as const
      : memberProfile?.inviterUserId ? 'REFERRAL' as const
      : 'AUTO_PLACE' as const;

    const config = await this.bonusConfig.getConfig();

    return {
      userId,
      buyerNo: user?.buyerNo ?? null,
      nickname: user?.profile?.nickname ?? (isSystem ? userId : null),
      phone: phone ?? null,
      tier: isSystem ? 'VIP' : (progress ? 'VIP' : 'NORMAL'),
      selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
      totalEarned: earned._sum.amount ?? 0,
      frozenAmount: frozenAccount?.frozen ?? 0,
      childCount,
      level: node?.level ?? 0,
      status,
      isSystemNode: isSystem,
      joinedTreeAt: node?.createdAt?.toISOString() ?? null,
      position: node?.position ?? 0,
      // 见 computeUnlockedLevel 注释：不直接用 progress.unlockedLevel
      unlockedLevel: this.computeUnlockedLevel(
        progress?.selfPurchaseCount ?? 0,
        config.vipMaxLayers,
      ),
      exitedAt: progress?.exitedAt?.toISOString() ?? null,
      rootId: node?.rootId ?? null,
      referrerUserId: memberProfile?.inviterUserId ?? null,
      referrerBuyerNo,
      referrerNickname,
      entryMode,
    };
  }

  /**
   * 递归构建 VIP 子树
   * @param nodeId - VipTreeNode.id (not userId)
   * @param remainingDepth - 剩余递归深度
   * @param nodeCount - 引用计数器，用于限制总节点数
   * @param maxNodes - 最大节点数限制
   */
  private async buildVipSubtree(
    nodeId: string,
    remainingDepth: number,
    nodeCount: { count: number },
    maxNodes: number,
  ): Promise<{ nodes: any[]; truncated: boolean }> {
    if (remainingDepth <= 0) return { nodes: [], truncated: false };

    const childTreeNodes = await this.prisma.vipTreeNode.findMany({
      where: { parentId: nodeId },
      orderBy: { position: 'asc' },
    });

    const nodes: any[] = [];
    let truncated = false;

    for (const child of childTreeNodes.filter(c => c.userId)) {
      if (nodeCount.count >= maxNodes) {
        truncated = true;
        break;
      }
      nodeCount.count++;
      const view = await this.buildNodeView(child.userId!);

      // 递归加载更深层级
      if (remainingDepth > 1) {
        const sub = await this.buildVipSubtree(child.id, remainingDepth - 1, nodeCount, maxNodes);
        if (sub.truncated) truncated = true;
        (view as any).children = sub.nodes;
      }

      nodes.push(view);
    }

    return { nodes, truncated };
  }

  // ============ 树根节点统计 ============

  /** VIP 树各根节点统计（A1-A10） */
  async getVipRootStats() {
    // 找到所有系统根节点（userId 为 null 的节点）
    const roots = await this.prisma.vipTreeNode.findMany({
      where: { userId: null },
      select: { id: true, rootId: true },
      orderBy: { rootId: 'asc' },
    });

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const nodes = await this.prisma.vipTreeNode.findMany({
      where: { rootId: { in: roots.map((root) => root.rootId) }, userId: { not: null } },
      select: { rootId: true, userId: true, createdAt: true },
    });
    const userIds = nodes.map((node) => node.userId!).filter(Boolean);
    const [progresses, frozenAccounts] = await Promise.all([
      this.prisma.vipProgress.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, selfPurchaseCount: true, exitedAt: true },
      }),
      this.prisma.rewardAccount.findMany({
        where: { userId: { in: userIds }, type: 'VIP_REWARD' },
        select: { userId: true, frozen: true },
      }),
    ]);
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));
    const frozenMap = new Map(frozenAccounts.map((item) => [item.userId, item.frozen]));
    const bucketMap = new Map<string, { totalNodes: number; weeklyNew: number; activeNodes: number }>();
    for (const root of roots) {
      bucketMap.set(root.rootId, { totalNodes: 0, weeklyNew: 0, activeNodes: 0 });
    }
    for (const node of nodes) {
      if (!node.rootId || !node.userId) continue;
      const bucket = bucketMap.get(node.rootId);
      if (!bucket) continue;
      bucket.totalNodes += 1;
      if (node.createdAt >= oneWeekAgo) bucket.weeklyNew += 1;
      const status = this.resolveVipNodeStatus(
        true,
        progressMap.get(node.userId)?.selfPurchaseCount ?? 0,
        progressMap.get(node.userId)?.exitedAt ?? null,
        frozenMap.get(node.userId) ?? 0,
      );
      if (status === 'active') bucket.activeNodes += 1;
    }

    const stats = roots.map((root) => {
      const bucket = bucketMap.get(root.rootId) ?? { totalNodes: 0, weeklyNew: 0, activeNodes: 0 };
      return {
        rootId: root.rootId,
        rootNodeId: root.id,
        totalNodes: bucket.totalNodes,
        activeNodes: bucket.activeNodes,
        activeRate: bucket.totalNodes > 0 ? Number(((bucket.activeNodes / bucket.totalNodes) * 100).toFixed(1)) : 0,
        weeklyNew: bucket.weeklyNew,
      };
    });

    // 按 rootId 数字部分排序（A1, A2, ..., A10），避免字典序排列
    stats.sort((a, b) => {
      const numA = parseInt(a.rootId.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.rootId.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    return stats;
  }

  /** 普通树根节点统计 */
  async getNormalRootStats() {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const nodes = await this.prisma.normalTreeNode.findMany({
      where: { userId: { not: null } },
      select: { userId: true, createdAt: true },
    });
    const userIds = nodes.map((node) => node.userId!).filter(Boolean);
    const [progresses, memberProfiles] = await Promise.all([
      this.prisma.normalProgress.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, selfPurchaseCount: true, frozenAt: true },
      }),
      this.prisma.memberProfile.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, tier: true },
      }),
    ]);
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));
    const tierMap = new Map(memberProfiles.map((item) => [item.userId, item.tier]));
    let weeklyNew = 0;
    let activeNodes = 0;
    for (const node of nodes) {
      if (!node.userId) continue;
      if (node.createdAt >= oneWeekAgo) weeklyNew += 1;
      const status = this.resolveNormalNodeStatus(
        true,
        tierMap.get(node.userId) ?? 'NORMAL',
        progressMap.get(node.userId)?.selfPurchaseCount ?? 0,
        progressMap.get(node.userId)?.frozenAt ?? null,
      );
      if (status === 'active') activeNodes += 1;
    }
    const totalNodes = nodes.length;

    return {
      rootId: 'ROOT',
      totalNodes,
      activeNodes,
      activeRate: totalNodes > 0 ? Number(((activeNodes / totalNodes) * 100).toFixed(1)) : 0,
      weeklyNew,
    };
  }

  // ============ 普通奖励滑动窗口 ============

  /** 获取所有桶的概览统计 */
  async getBroadcastBuckets() {
    const buckets = await this.prisma.normalBucket.findMany({
      orderBy: { bucketKey: 'asc' },
    });

    const result = await Promise.all(
      buckets.map(async (b) => {
        const stats = await this.prisma.normalQueueMember.aggregate({
          where: { bucketId: b.id, active: true },
          _count: true,
        });
        // 汇总该桶内的分配总额
        const reward = await this.prisma.rewardLedger.aggregate({
          where: {
            meta: { path: ['bucketKey'], equals: b.bucketKey },
            entryType: 'RELEASE',
            status: 'AVAILABLE',
          },
          _sum: { amount: true },
        });

        return {
          bucketKey: b.bucketKey,
          totalOrders: stats._count,
          totalAmount: 0, // 需从队列计算
          totalReward: reward._sum.amount ?? 0,
        };
      }),
    );

    return result;
  }

  /** 获取指定桶的滑动窗口订单列表 */
  async getBroadcastWindow(bucketKey: string, page = 1, pageSize = 30) {
    const bucket = await this.prisma.normalBucket.findUnique({ where: { bucketKey } });
    if (!bucket) throw new NotFoundException('桶不存在');

    const skip = (page - 1) * pageSize;

    const [members, total] = await Promise.all([
      this.prisma.normalQueueMember.findMany({
        where: { bucketId: bucket.id, active: true },
        orderBy: { joinedAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          order: { select: { totalAmount: true } },
          user: { select: { id: true, buyerNo: true, profile: { select: { nickname: true } } } },
        },
      }),
      this.prisma.normalQueueMember.count({ where: { bucketId: bucket.id, active: true } }),
    ]);

    // 查每笔订单分出去的奖励总额
    const orderIds = members.map((m) => m.orderId).filter((id): id is string => id !== null);
    const ledgers = await this.prisma.rewardLedger.groupBy({
      by: ['refId'],
      where: {
        refId: { in: orderIds },
        meta: { path: ['scheme'], equals: 'NORMAL_BROADCAST' },
        entryType: 'RELEASE',
        status: 'AVAILABLE',
      },
      _sum: { amount: true },
    });
    const rewardMap = new Map(ledgers.map((l) => [l.refId, l._sum?.amount ?? 0]));

    const rewardTotal = await this.prisma.rewardLedger.aggregate({
      where: {
        meta: { path: ['bucketKey'], equals: bucketKey },
        entryType: 'RELEASE',
        status: 'AVAILABLE',
      },
      _sum: { amount: true },
    });

    return {
      bucketInfo: {
        bucketKey: bucket.bucketKey,
        totalOrders: total,
        totalAmount: members.reduce((s, m) => s + (m.order?.totalAmount ?? 0), 0),
        totalReward: rewardTotal._sum.amount ?? 0,
      },
      windowOrders: members.map((m) => ({
        orderId: m.orderId,
        userId: m.userId,
        buyerNo: m.user?.buyerNo ?? null,
        nickname: m.user?.profile?.nickname ?? null,
        amount: m.order?.totalAmount ?? 0,
        rewardDistributed: rewardMap.get(m.orderId) ?? 0,
        createdAt: m.joinedAt.toISOString(),
      })),
      pagination: { total, page, pageSize },
    };
  }

  /** 获取某笔订单的奖励分配明细 */
  async getBroadcastDistributions(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalAmount: true,
        userId: true,
        user: { select: { buyerNo: true, profile: { select: { nickname: true } } } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');

    // 查该订单触发的所有普通广播分配
    const ledgers = await this.prisma.rewardLedger.findMany({
      where: {
        refId: orderId,
        meta: { path: ['scheme'], equals: 'NORMAL_BROADCAST' },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        account: { select: { userId: true } },
      },
    });

    // 查受益人昵称
    const userIds = [...new Set(ledgers.map((l) => l.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, buyerNo: true, profile: { select: { nickname: true } } },
    });
    const userMap = new Map(users.map((u) => [u.id, u.profile?.nickname ?? null]));
    const buyerNoMap = new Map(users.map((u) => [u.id, u.buyerNo ?? null]));

    return {
      order: {
        id: order.id,
        amount: order.totalAmount,
        buyerNo: order.user?.buyerNo ?? null,
        buyerName: order.user?.profile?.nickname ?? null,
      },
      distributions: ledgers.map((l, i) => ({
        recipientId: l.userId,
        recipientBuyerNo: buyerNoMap.get(l.userId) ?? null,
        recipientName: userMap.get(l.userId) ?? null,
        amount: l.amount,
        orderIndex: i + 1,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  // ============ 普通用户树可视化 ============

  /** 获取以指定用户为中心的普通树上下文 */
  async getNormalTreeContext(userId: string, descendantDepth = 1) {
    if (userId === NORMAL_TREE_ROOT_VIEW_ID) {
      return this.getNormalPlatformRootContext(descendantDepth);
    }
    const resolvedUserId = await resolveBuyerUserId(this.prisma, userId);

    const node = await this.prisma.normalTreeNode.findUnique({
      where: { userId: resolvedUserId },
    });
    if (!node) throw new NotFoundException('该用户不在普通树中');

    // 面包屑
    const breadcrumb: Array<{ userId: string | null; buyerNo: string | null; nickname: string | null; level: number }> = [];
    let cur = node;
    const visitedNodeIds = new Set<string>([node.id]);
    let hops = 0;
    while (cur.parentId && hops < 64) {
      if (visitedNodeIds.has(cur.parentId)) break;
      visitedNodeIds.add(cur.parentId);
      hops++;

      const parent = await this.prisma.normalTreeNode.findUnique({ where: { id: cur.parentId } });
      if (!parent) break;
      // 系统根节点（userId=null）
      if (!parent.userId) {
        breadcrumb.unshift({ userId: null, buyerNo: null, nickname: '系统根节点', level: parent.level });
        break;
      }
      const parentUser = await this.prisma.user.findUnique({
        where: { id: parent.userId },
        select: { buyerNo: true, profile: { select: { nickname: true } } },
      });
      breadcrumb.unshift({
        userId: parent.userId,
        buyerNo: parentUser?.buyerNo ?? null,
        nickname: parentUser?.profile?.nickname ?? parent.userId,
        level: parent.level,
      });
      cur = parent;
    }

    // 当前节点
    const currentView = await this.buildNormalNodeView(node.userId!);

    // 父节点
    let parentView = null;
    if (node.parentId) {
      const parentNode = await this.prisma.normalTreeNode.findUnique({ where: { id: node.parentId } });
      if (parentNode?.userId) parentView = await this.buildNormalNodeView(parentNode.userId);
    }

    // Clamp descendantDepth to 1-5
    const safeDepth = Math.max(1, Math.min(5, descendantDepth));
    const nodeCount = { count: 0 };
    const MAX_NODES = 100;

    // 递归加载子树
    const subtree = await this.buildNormalSubtree(node.id, safeDepth, nodeCount, MAX_NODES);

    return { breadcrumb, parent: parentView, current: currentView, children: subtree.nodes, truncated: subtree.truncated };
  }

  /** 懒加载普通树子节点 */
  async getNormalTreeChildren(nodeUserId: string) {
    if (nodeUserId === NORMAL_TREE_ROOT_VIEW_ID) {
      const rootNode = await this.prisma.normalTreeNode.findFirst({
        where: { userId: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!rootNode) throw new NotFoundException('普通树平台根节点不存在');

      const childNodes = await this.prisma.normalTreeNode.findMany({
        where: { parentId: rootNode.id },
        orderBy: { position: 'asc' },
      });
      return {
        children: await Promise.all(
          childNodes.filter((c) => c.userId).map((c) => this.buildNormalNodeView(c.userId!)),
        ),
      };
    }

    const resolvedUserId = await resolveBuyerUserId(this.prisma, nodeUserId);
    const node = await this.prisma.normalTreeNode.findUnique({ where: { userId: resolvedUserId } });
    if (!node) throw new NotFoundException('节点不存在');

    const childNodes = await this.prisma.normalTreeNode.findMany({
      where: { parentId: node.id },
      orderBy: { position: 'asc' },
    });
    return {
      children: await Promise.all(
        childNodes.filter((c) => c.userId).map((c) => this.buildNormalNodeView(c.userId!)),
      ),
    };
  }

  /** 构建普通树平台根视图 */
  private async getNormalPlatformRootContext(descendantDepth = 1) {
    const rootNode = await this.prisma.normalTreeNode.findFirst({
      where: { userId: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!rootNode) throw new NotFoundException('普通树平台根节点不存在');

    const childCount = await this.prisma.normalTreeNode.count({
      where: { parentId: rootNode.id },
    });

    const safeDepth = Math.max(1, Math.min(5, descendantDepth));
    const nodeCount = { count: 0 };
    const MAX_NODES = 100;
    const subtree = await this.buildNormalSubtree(rootNode.id, safeDepth, nodeCount, MAX_NODES);

    return {
      breadcrumb: [],
      parent: null,
      current: {
        userId: NORMAL_TREE_ROOT_VIEW_ID,
        buyerNo: null,
        nickname: '平台根节点',
        phone: null,
        tier: 'NORMAL' as const,
        selfPurchaseCount: 0,
        totalEarned: 0,
        frozenAmount: 0,
        balance: 0,
        childCount,
        level: rootNode.level,
        status: 'active' as const,
        isSystemNode: true,
        joinedTreeAt: rootNode.createdAt.toISOString(),
        position: rootNode.position,
        unlockedLevel: 0,
        normalRewardEligible: false,
        upgradedToVipAt: null,
        stoppedReason: null,
      },
      children: subtree.nodes,
      truncated: subtree.truncated,
    };
  }

  /** 构建普通树节点视图 */
  private async buildNormalNodeView(userId: string) {
    const [node, user, progress, account, memberProfile] = await Promise.all([
      this.prisma.normalTreeNode.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          buyerNo: true,
          profile: { select: { nickname: true } },
          authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        },
      }),
      this.prisma.normalProgress.findUnique({ where: { userId } }),
      this.prisma.rewardAccount.findUnique({
        where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
      }),
      this.prisma.memberProfile.findUnique({
        where: { userId },
        select: { tier: true, vipPurchasedAt: true, normalJoinedAt: true, normalEligible: true },
      }),
    ]);

    const earned = await this.prisma.rewardLedger.aggregate({
      where: {
        userId,
        account: { type: 'NORMAL_REWARD' },
        entryType: 'RELEASE',
        status: 'AVAILABLE',
      },
      _sum: { amount: true },
    });

    const childCount = node
      ? await this.prisma.normalTreeNode.count({ where: { parentId: node.id } })
      : 0;

    const phone = user?.authIdentities?.[0]?.identifier ?? null;

    // 计算状态
    const status = memberProfile?.tier === 'VIP' ? 'frozen' as const
      : progress?.frozenAt ? 'frozen' as const
      : progress?.selfPurchaseCount === 0 ? 'silent' as const
      : 'active' as const;

    // 停止原因
    // UPGRADED_VIP = 用户升级为 VIP，停止接收普通奖励
    // FROZEN = 账户被冻结（可能原因：超时未消费/管理员操作/系统规则触发）
    const stoppedReason = memberProfile?.tier === 'VIP' ? 'UPGRADED_VIP' as const
      : progress?.frozenAt ? 'FROZEN' as const
      : null;

    return {
      userId,
      buyerNo: user?.buyerNo ?? null,
      nickname: user?.profile?.nickname ?? null,
      phone: phone ?? null,
      selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
      totalEarned: earned._sum?.amount ?? 0,
      frozenAmount: account?.frozen ?? 0,
      balance: account?.balance ?? 0,
      childCount,
      level: node?.level ?? 0,
      frozenAt: progress?.frozenAt?.toISOString() ?? null,
      tier: memberProfile?.tier ?? 'NORMAL',
      status,
      isSystemNode: !node?.userId,
      joinedTreeAt: memberProfile?.normalJoinedAt?.toISOString() ?? node?.createdAt?.toISOString() ?? null,
      position: node?.position ?? 0,
      unlockedLevel: progress?.selfPurchaseCount ?? 0,
      normalRewardEligible: memberProfile?.tier !== 'VIP' && !progress?.frozenAt,
      upgradedToVipAt: memberProfile?.vipPurchasedAt?.toISOString() ?? null,
      stoppedReason,
    };
  }

  /**
   * 递归构建普通用户子树
   * @param nodeId - NormalTreeNode.id (not userId)
   * @param remainingDepth - 剩余递归深度
   * @param nodeCount - 引用计数器，用于限制总节点数
   * @param maxNodes - 最大节点数限制
   */
  private async buildNormalSubtree(
    nodeId: string,
    remainingDepth: number,
    nodeCount: { count: number },
    maxNodes: number,
  ): Promise<{ nodes: any[]; truncated: boolean }> {
    if (remainingDepth <= 0) return { nodes: [], truncated: false };

    const childTreeNodes = await this.prisma.normalTreeNode.findMany({
      where: { parentId: nodeId },
      orderBy: { position: 'asc' },
    });

    const nodes: any[] = [];
    let truncated = false;

    for (const child of childTreeNodes.filter(c => c.userId)) {
      if (nodeCount.count >= maxNodes) {
        truncated = true;
        break;
      }
      nodeCount.count++;
      const view = await this.buildNormalNodeView(child.userId!);

      // 递归加载更深层级
      if (remainingDepth > 1) {
        const sub = await this.buildNormalSubtree(child.id, remainingDepth - 1, nodeCount, maxNodes);
        if (sub.truncated) truncated = true;
        (view as any).children = sub.nodes;
      }

      nodes.push(view);
    }

    return { nodes, truncated };
  }

  /** 获取用户的树奖励记录 */
  async getTreeRewardRecords(
    userId: string,
    accountType: 'VIP_REWARD' | 'NORMAL_REWARD',
    page = 1,
    pageSize = 20,
  ) {
    const skip = (page - 1) * pageSize;
    const resolvedUserId = await resolveBuyerUserId(this.prisma, userId);

    // Find the user's reward account
    const account = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId: resolvedUserId, type: accountType } },
    });

    if (!account) {
      return { items: [], total: 0, page, pageSize };
    }

    // Query ledger entries
    const where = { accountId: account.id };

    const [ledgers, total] = await Promise.all([
      this.prisma.rewardLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          entryType: true,
          amount: true,
          status: true,
          refType: true,
          refId: true,
          meta: true,
          createdAt: true,
        },
      }),
      this.prisma.rewardLedger.count({ where }),
    ]);

    // Extract sourceUserId from meta and batch-lookup nicknames
    const sourceUserIds = new Set<string>();
    for (const l of ledgers) {
      const meta = l.meta as any;
      if (meta?.sourceUserId) sourceUserIds.add(meta.sourceUserId);
    }

    const sourceUsers = sourceUserIds.size > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: [...sourceUserIds] } },
          select: { id: true, buyerNo: true, profile: { select: { nickname: true } } },
        })
      : [];
    const nicknameMap = new Map(sourceUsers.map((u) => [u.id, u.profile?.nickname ?? null]));
    const buyerNoMap = new Map(sourceUsers.map((u) => [u.id, u.buyerNo ?? null]));

    const items = ledgers.map((l) => {
      const meta = l.meta as any;
      return {
        id: l.id,
        entryType: l.entryType,
        amount: l.amount,
        status: l.status,
        refType: l.refType,
        refId: l.refId,
        sourceUserId: meta?.sourceUserId ?? null,
        sourceBuyerNo: meta?.sourceUserId ? (buyerNoMap.get(meta.sourceUserId) ?? null) : null,
        sourceNickname: meta?.sourceUserId ? (nicknameMap.get(meta.sourceUserId) ?? null) : null,
        layer: meta?.layer ?? meta?.level ?? null,
        createdAt: l.createdAt.toISOString(),
      };
    });

    return { items, total, page, pageSize };
  }

  async getTreeRelatedOrders(
    userId: string,
    accountType: 'VIP_REWARD' | 'NORMAL_REWARD',
    page = 1,
    pageSize = 20,
  ) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma, userId);
    const account = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId: resolvedUserId, type: accountType } },
    });
    if (!account) {
      return { items: [], total: 0, page, pageSize };
    }

    const where = {
      accountId: account.id,
      refType: 'ORDER' as const,
      refId: { not: null },
    };
    const ledgers = await this.prisma.rewardLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        entryType: true,
        amount: true,
        status: true,
        refType: true,
        refId: true,
        meta: true,
        createdAt: true,
      },
    });

    const sourceUserIds = new Set<string>();
    for (const ledger of ledgers) {
      const meta = ledger.meta as any;
      if (meta?.sourceUserId) sourceUserIds.add(meta.sourceUserId);
    }
    const sourceUsers = sourceUserIds.size > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: [...sourceUserIds] } },
          select: { id: true, buyerNo: true, profile: { select: { nickname: true } } },
        })
      : [];
    const nicknameMap = new Map(sourceUsers.map((u) => [u.id, u.profile?.nickname ?? null]));
    const buyerNoMap = new Map(sourceUsers.map((u) => [u.id, u.buyerNo ?? null]));

    const grouped = new Map<string, {
      orderId: string;
      sourceUserId: string | null;
      sourceBuyerNo: string | null;
      sourceNickname: string | null;
      totalReward: number;
      entryCount: number;
      latestStatus: string;
      latestEntryType: string;
      latestLayer: number | null;
      latestCreatedAt: string;
    }>();

    for (const ledger of ledgers) {
      if (!ledger.refId) continue;
      const meta = ledger.meta as any;
      const current = grouped.get(ledger.refId);
      if (!current) {
        grouped.set(ledger.refId, {
          orderId: ledger.refId,
          sourceUserId: meta?.sourceUserId ?? null,
          sourceBuyerNo: meta?.sourceUserId ? (buyerNoMap.get(meta.sourceUserId) ?? null) : null,
          sourceNickname: meta?.sourceUserId ? (nicknameMap.get(meta.sourceUserId) ?? null) : null,
          totalReward: ledger.amount,
          entryCount: 1,
          latestStatus: ledger.status,
          latestEntryType: ledger.entryType,
          latestLayer: meta?.layer ?? meta?.level ?? null,
          latestCreatedAt: ledger.createdAt.toISOString(),
        });
        continue;
      }
      current.totalReward += ledger.amount;
      current.entryCount += 1;
    }

    const aggregated = [...grouped.values()];
    const total = aggregated.length;
    const skip = (page - 1) * pageSize;
    const items = aggregated.slice(skip, skip + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  /** 奖励路径解释：追溯一笔奖励从消费到分配的完整路径 */
  async getPathExplain(
    userId: string,
    ledgerId: string,
    accountType: 'VIP_REWARD' | 'NORMAL_REWARD',
  ) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma, userId);
    // 1. Find the ledger entry（校验归属）
    const ledger = await this.prisma.rewardLedger.findFirst({
      where: { id: ledgerId, userId: resolvedUserId },
    });
    if (!ledger) throw new NotFoundException('奖励记录不存在');

    // 2. Extract meta
    const meta = ledger.meta as any;
    const sourceUserId: string | null = meta?.sourceUserId ?? null;
    const layer: number | null = meta?.layer ?? meta?.level ?? null;

    // 3. Look up source user nickname
    let sourceNickname: string | null = null;
    let sourceBuyerNo: string | null = null;
    if (sourceUserId) {
      const sourceUser = await this.prisma.user.findUnique({
        where: { id: sourceUserId },
        select: { buyerNo: true, profile: { select: { nickname: true } } },
      });
      sourceNickname = sourceUser?.profile?.nickname ?? null;
      sourceBuyerNo = sourceUser?.buyerNo ?? null;
    }

    // 4. Look up recipient nickname
    const recipientUser = await this.prisma.user.findUnique({
      where: { id: ledger.userId },
      select: { buyerNo: true, profile: { select: { nickname: true } } },
    });
    const recipientNickname = recipientUser?.profile?.nickname ?? null;
    const recipientBuyerNo = recipientUser?.buyerNo ?? null;

    // 5. Build path from source to recipient by traversing the tree
    const path: Array<{
      userId: string;
      buyerNo: string | null;
      nickname: string | null;
      level: number;
      isSource: boolean;
      isTarget: boolean;
    }> = [];

    if (sourceUserId) {
      const isVip = accountType === 'VIP_REWARD';
      const TreeModel = isVip ? this.prisma.vipTreeNode : this.prisma.normalTreeNode;

      const sourceNode = await (TreeModel as any).findUnique({ where: { userId: sourceUserId } });
      if (sourceNode) {
        // Add source node to path
        path.push({
          userId: sourceUserId,
          buyerNo: sourceBuyerNo,
          nickname: sourceNickname,
          level: sourceNode.level,
          isSource: true,
          isTarget: sourceUserId === ledger.userId,
        });

        // Walk up the tree from source to find the recipient
        let current = sourceNode;
        const maxHops = Math.min(layer ?? 15, 15);
        const visited = new Set<string>([sourceNode.id]);

        for (let i = 0; i < maxHops; i++) {
          if (!current.parentId) break;
          if (visited.has(current.parentId)) break;
          visited.add(current.parentId);

          const parent = await (TreeModel as any).findUnique({ where: { id: current.parentId } });
          if (!parent) break;

          // Skip system root nodes (userId is null for normal tree root)
          if (!parent.userId) break;

          const parentUser = await this.prisma.user.findUnique({
            where: { id: parent.userId },
            select: { buyerNo: true, profile: { select: { nickname: true } } },
          });

          const isTarget = parent.userId === ledger.userId;
          path.push({
            userId: parent.userId,
            buyerNo: parentUser?.buyerNo ?? null,
            nickname: parentUser?.profile?.nickname ?? null,
            level: parent.level,
            isSource: false,
            isTarget,
          });

          if (isTarget) break; // Found the recipient, stop traversal
          current = parent;
        }
      }
    }

    // 6. Determine hit result
    let hitResult = '命中';
    if (ledger.status === 'RETURN_FROZEN') {
      hitResult = '售后保护冻结中';
    } else if (ledger.status === 'FROZEN') {
      hitResult = '已冻结（等待解冻）';
    } else if (ledger.status === 'VOIDED') {
      hitResult = '已作废';
    } else if (ledger.status === 'AVAILABLE') {
      hitResult = '已到账';
    } else if (ledger.status === 'WITHDRAWN') {
      hitResult = '已提现';
    } else if (ledger.status === 'RESERVED') {
      hitResult = '已预留';
    }

    // Check if recipient was found in path
    const recipientInPath = path.some(p => p.isTarget);
    if (!recipientInPath && sourceUserId) {
      hitResult = '路径外分配（可能经过跳层处理）';
    }

    return {
      sourceUserId,
      sourceBuyerNo,
      sourceNickname,
      consumptionIndex: layer,
      rewardAmount: ledger.amount,
      rewardStatus: ledger.status,
      entryType: ledger.entryType,
      recipientUserId: ledger.userId,
      recipientBuyerNo,
      recipientNickname,
      path,
      hitResult,
    };
  }

  /** 拒绝提现：解冻金额退回可用余额 */
  async rejectWithdraw(id: string, adminUserId: string, reason?: string) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!withdraw) throw new NotFoundException('提现申请不存在');
    if (withdraw.status !== 'REQUESTED') {
      throw new BadRequestException('仅待审核的提现可拒绝');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 状态 CAS：仅允许 REQUESTED -> REJECTED
      const cas = await tx.withdrawRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status: 'REJECTED',
          reviewerAdminId: adminUserId,
          ...(reason ? { rejectReason: reason } : {}),
        },
      });
      if (cas.count === 0) {
        throw new BadRequestException('该提现申请已被处理，请刷新后重试');
      }

      const updated = await tx.withdrawRequest.findUnique({
        where: { id },
      });
      if (!updated) {
        throw new NotFoundException('提现申请不存在');
      }

      // 解冻：frozen → balance（CAS 守卫，防止并发操作导致 frozen 变负数）
      // 使用 withdraw.accountType 动态确定账户类型，支持 VIP_REWARD 和 NORMAL_REWARD
      // 注意：updateMany 不支持同时 decrement+increment，需分两步操作
      const frozenCas = await tx.rewardAccount.updateMany({
        where: {
          userId: withdraw.userId,
          type: withdraw.accountType as any,
          frozen: { gte: withdraw.amount },
        },
        data: { frozen: { decrement: withdraw.amount } },
      });
      if (frozenCas.count === 0) {
        throw new BadRequestException('冻结余额不足，可能存在并发操作');
      }
      // frozen 扣减成功后，将金额退回可用余额
      await tx.rewardAccount.updateMany({
        where: {
          userId: withdraw.userId,
          type: withdraw.accountType as any,
        },
        data: { balance: { increment: withdraw.amount } },
      });

      // P0-4: 作废提现流水
      await tx.rewardLedger.updateMany({
        where: { refType: 'WITHDRAW', refId: id, status: 'FROZEN' },
        data: { status: 'VOIDED', entryType: 'VOID' },
      });

      await this.notificationService.emit({
        eventType: 'withdraw.rejected',
        aggregateType: 'withdrawRequest',
        aggregateId: id,
        idempotencyKey: `withdraw:${id}:rejected`,
        actor: { kind: 'admin', id: adminUserId },
        payload: {
          withdrawId: id,
          userId: withdraw.userId,
          amount: withdraw.amount,
        },
      }, tx as any);

      return updated;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return result;
  }
}
