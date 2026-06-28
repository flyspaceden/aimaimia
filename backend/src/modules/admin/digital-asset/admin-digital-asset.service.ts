import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DigitalAssetService } from '../../digital-asset/digital-asset.service';
import { validateCreditTiers } from '../../digital-asset/digital-asset-credit-calculator';
import {
  DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS,
  normalizeDigitalAssetModuleSettings,
} from '../../digital-asset/digital-asset-module-settings';
import { AdminAdjustDigitalAssetDto } from '../../digital-asset/dto/admin-adjust-digital-asset.dto';
import { UpdateDigitalAssetSettingsDto } from '../../digital-asset/dto/update-digital-asset-settings.dto';
import { UpdateDigitalAssetRulesDto } from '../../digital-asset/dto/update-digital-asset-rules.dto';
import { CreditAssetTier } from '../../digital-asset/digital-asset-v2.types';
import {
  AdminDigitalAssetAccountQueryDto,
  AdminDigitalAssetLedgerQueryDto,
} from './dto/admin-digital-asset.dto';
import { SUPER_ADMIN_ROLE } from '../common/constants';
import { maskPhone } from '../../../common/security/privacy-mask';
import { normalizeBuyerNo, resolveBuyerUserId } from '../../../common/utils/buyer-no.util';

const DIGITAL_ASSET_SETTINGS_KEY = 'DIGITAL_ASSET_MODULE_SETTINGS';
const DIGITAL_ASSET_CREDIT_TIERS_KEY = 'DIGITAL_ASSET_CREDIT_TIERS';
const ACCOUNT_SORT_FIELD_MAP = {
  seedAssetBalance: 'seedAssetBalance',
  creditAssetBalance: 'creditAssetBalance',
  frozenCreditAssetBalance: 'frozenCreditAssetBalance',
  cumulativeSpendAmount: 'cumulativeSpendAmount',
  updatedAt: 'updatedAt',
} as const;
type PersistedAccountSortField = keyof typeof ACCOUNT_SORT_FIELD_MAP;
type AccountSortField = PersistedAccountSortField | 'totalAssetBalance';
type AccountSortDirection = 'asc' | 'desc';
const DEFAULT_CREDIT_TIERS: CreditAssetTier[] = [
  { minAmount: 0, maxAmount: 500, multiplier: 3 },
  { minAmount: 500, maxAmount: 5000, multiplier: 5 },
  { minAmount: 5000, maxAmount: null, multiplier: 10 },
];

@Injectable()
export class AdminDigitalAssetService {
  constructor(
    private prisma: PrismaService,
    private digitalAssetService: DigitalAssetService,
  ) {}

  async getOverview() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [accounts, todayGroups] = await Promise.all([
      (this.prisma as any).digitalAssetAccount.aggregate({
        _count: { _all: true },
        _sum: {
          cumulativeSpendAmount: true,
          seedAssetBalance: true,
          creditAssetBalance: true,
          frozenCreditAssetBalance: true,
        },
      }),
      (this.prisma as any).digitalAssetLedger.groupBy({
        by: ['subjectType', 'direction', 'type'],
        where: { createdAt: { gte: startOfDay } },
        _sum: { amount: true, assetAmount: true },
      }),
    ]);

    const totalSeedAssetBalance = accounts?._sum?.seedAssetBalance ?? 0;
    const totalCreditAssetBalance = accounts?._sum?.creditAssetBalance ?? 0;
    const totalFrozenCreditAssetBalance = accounts?._sum?.frozenCreditAssetBalance ?? 0;
    const sumGroup = (
      subjectType: string,
      direction: 'CREDIT' | 'DEBIT',
      field: 'amount' | 'assetAmount',
      acceptType: (type: string | null | undefined) => boolean = () => true,
    ) => (todayGroups ?? [])
      .filter((item: any) => item.subjectType === subjectType && item.direction === direction && acceptType(item.type))
      .reduce((sum: number, item: any) => sum + (item?._sum?.[field] ?? 0), 0);
    const isFrozenCreditType = (type: string | null | undefined) => type === 'CONSUMPTION_PAID_FROZEN';
    const isFrozenDebitType = (type: string | null | undefined) => type === 'CONSUMPTION_FROZEN_VOIDED';
    const todaySeedAssetCreditAmount = sumGroup('SEED_ASSET', 'CREDIT', 'assetAmount');
    const todayCreditAssetCreditAmount = sumGroup('CREDIT_ASSET', 'CREDIT', 'assetAmount', (type) => !isFrozenCreditType(type));
    const todayFrozenCreditAssetCreditAmount = sumGroup('CREDIT_ASSET', 'CREDIT', 'assetAmount', isFrozenCreditType);
    const todaySeedAssetDebitAmount = sumGroup('SEED_ASSET', 'DEBIT', 'assetAmount');
    const todayCreditAssetDebitAmount = sumGroup('CREDIT_ASSET', 'DEBIT', 'assetAmount', (type) => !isFrozenDebitType(type));

    return {
      accountCount: accounts?._count?._all ?? 0,
      totalCumulativeSpendAmount: accounts?._sum?.cumulativeSpendAmount ?? 0,
      totalSeedAssetBalance,
      totalCreditAssetBalance,
      totalFrozenCreditAssetBalance,
      totalAssetBalance: totalSeedAssetBalance + totalCreditAssetBalance,
      todayCumulativeSpendCreditAmount: sumGroup('CUMULATIVE_SPEND', 'CREDIT', 'amount'),
      todayCumulativeSpendDebitAmount: sumGroup('CUMULATIVE_SPEND', 'DEBIT', 'amount'),
      todaySeedAssetCreditAmount,
      todaySeedAssetDebitAmount,
      todayCreditAssetCreditAmount,
      todayFrozenCreditAssetCreditAmount,
      todayCreditAssetDebitAmount,
      todayAssetCreditAmount: todaySeedAssetCreditAmount + todayCreditAssetCreditAmount,
      todayAssetDebitAmount: todaySeedAssetDebitAmount + todayCreditAssetDebitAmount,
    };
  }

  async findAccounts(query: AdminDigitalAssetAccountQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where = this.buildAccountWhere(query);
    const sort = this.normalizeAccountSort(query);

    if (sort.field === 'totalAssetBalance') {
      const [items, total] = await Promise.all([
        this.findAccountsSortedByTotalAssetBalance(query, where, page, pageSize, sort.direction),
        (this.prisma as any).digitalAssetAccount.count({ where }),
      ]);
      const assetRankByAccountId = await this.getVipAssetRankMap(items);

      return {
        items: items.map((item: any) => this.mapAccount(item, assetRankByAccountId.get(item.id) ?? null)),
        total,
        page,
        pageSize,
      };
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).digitalAssetAccount.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: this.buildAccountOrderBy({ field: sort.field, direction: sort.direction }),
        include: this.accountInclude(),
      }),
      (this.prisma as any).digitalAssetAccount.count({ where }),
    ]);
    const assetRankByAccountId = await this.getVipAssetRankMap(items);

    return {
      items: items.map((item: any) => this.mapAccount(item, assetRankByAccountId.get(item.id) ?? null)),
      total,
      page,
      pageSize,
    };
  }

  async getAccount(userId: string) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma as any, userId);
    const [user, settings] = await Promise.all([
      (this.prisma as any).user.findUnique({
        where: { id: resolvedUserId },
        include: {
          profile: { select: { nickname: true, avatarUrl: true } },
          memberProfile: { select: { tier: true } },
          authIdentities: {
            where: { provider: 'PHONE' },
            select: { identifier: true },
            take: 1,
          },
          digitalAssetAccount: true,
        },
      }),
      this.getSettings(),
    ]) as any;
    if (!user) throw new NotFoundException('用户不存在');
    const seedAssetBalance = (user as any).digitalAssetAccount?.seedAssetBalance ?? 0;
    const creditAssetBalance = (user as any).digitalAssetAccount?.creditAssetBalance ?? 0;
    const frozenCreditAssetBalance = (user as any).digitalAssetAccount?.frozenCreditAssetBalance ?? 0;
    const cumulativeSpendAmount = (user as any).digitalAssetAccount?.cumulativeSpendAmount ?? 0;

    return {
      user: {
        id: user.id,
        buyerNo: user.buyerNo ?? null,
        nickname: user.profile?.nickname ?? null,
        avatarUrl: user.profile?.avatarUrl ?? null,
        phone: maskPhone(user.authIdentities?.[0]?.identifier ?? null),
        status: user.status,
        vipStatus: user.memberProfile?.tier ?? 'NORMAL',
      },
      account: {
        id: (user as any).digitalAssetAccount?.id ?? null,
        totalAssetBalance: seedAssetBalance + creditAssetBalance,
        seedAssetBalance,
        creditAssetBalance,
        frozenCreditAssetBalance,
        cumulativeSpendAmount,
        updatedAt: (user as any).digitalAssetAccount?.updatedAt ?? null,
      },
      modules: settings.modules,
    };
  }

  async listLedgers(userId: string, query: AdminDigitalAssetLedgerQueryDto) {
    const resolvedUserId = await resolveBuyerUserId(this.prisma as any, userId);
    return this.digitalAssetService.listLedgers(resolvedUserId, query);
  }

  async adjustAccount(userId: string, dto: AdminAdjustDigitalAssetDto, admin: any) {
    if (!admin?.roles?.includes(SUPER_ADMIN_ROLE)) {
      throw new ForbiddenException('只有超级管理员可以手动调整数字资产');
    }
    const resolvedUserId = await resolveBuyerUserId(this.prisma as any, userId);
    await this.digitalAssetService.adjustByAdmin({
      targetUserId: resolvedUserId,
      adminUserId: admin.sub,
      subjectType: dto.subjectType,
      direction: dto.direction,
      amount: dto.amount,
      reason: dto.reason,
      clientIdempotencyKey: dto.clientIdempotencyKey,
    });
    return this.getAccount(resolvedUserId);
  }

  async exportAccounts(query: AdminDigitalAssetAccountQueryDto): Promise<string> {
    const where = this.buildAccountWhere(query);
    const sort = this.normalizeAccountSort(query);
    const items = sort.field === 'totalAssetBalance'
      ? await this.findAccountsSortedByTotalAssetBalance(query, where, 1, 5000, sort.direction)
      : await (this.prisma as any).digitalAssetAccount.findMany({
        where,
        take: 5000,
        orderBy: this.buildAccountOrderBy({ field: sort.field, direction: sort.direction }),
        include: this.accountInclude(),
      });
    const rows = [
      ['买家编号', '用户ID', '昵称', '手机号', 'VIP状态', '数字资产总额', '种子资产', '消费资产', '冻结资产', '累计消费', '账户更新时间'],
      ...items.map((item: any) => [
        item.user?.buyerNo ?? '',
        item.userId,
        item.user?.profile?.nickname ?? '',
        maskPhone(item.user?.authIdentities?.[0]?.identifier ?? null) ?? '',
        item.user?.memberProfile?.tier ?? 'NORMAL',
        String((item.seedAssetBalance ?? 0) + (item.creditAssetBalance ?? 0)),
        String(item.seedAssetBalance ?? 0),
        String(item.creditAssetBalance ?? 0),
        String(item.frozenCreditAssetBalance ?? 0),
        String(item.cumulativeSpendAmount ?? 0),
        item.updatedAt ? new Date(item.updatedAt).toISOString() : '',
      ]),
    ];
    return rows
      .map((row: Array<string | number>) => row.map((value: string | number) => this.escapeCsv(String(value))).join(','))
      .join('\n');
  }

  async getSettings() {
    const rules = await this.getRules();
    return { modules: rules.modules };
  }

  async updateSettings(dto: UpdateDigitalAssetSettingsDto) {
    const rules = await this.getRules();
    const nextRules = await this.updateRules({
      tiers: rules.tiers,
      modules: dto.modules,
    });
    return { modules: nextRules.modules };
  }

  async getRules() {
    const [creditConfig, moduleConfig] = await Promise.all([
      this.prisma.ruleConfig.findUnique({
        where: { key: DIGITAL_ASSET_CREDIT_TIERS_KEY },
      }),
      this.prisma.ruleConfig.findUnique({
        where: { key: DIGITAL_ASSET_SETTINGS_KEY },
      }),
    ]);

    return {
      tiers: this.normalizeCreditTiers((creditConfig?.value as any)?.value?.tiers ?? (creditConfig?.value as any)?.tiers),
      modules: this.normalizeSettings(
        (moduleConfig?.value as any)?.modules ?? DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS,
        { allowLegacyKey: true },
      ),
    };
  }

  async updateRules(dto: UpdateDigitalAssetRulesDto) {
    const tiers = this.normalizeCreditTiers(dto.tiers);
    const modules = this.normalizeSettings(dto.modules);
    await this.prisma.$transaction(async (tx) => {
      await tx.ruleConfig.upsert({
        where: { key: DIGITAL_ASSET_CREDIT_TIERS_KEY },
        update: { value: { tiers } },
        create: { key: DIGITAL_ASSET_CREDIT_TIERS_KEY, value: { tiers } },
      });
      await tx.ruleConfig.upsert({
        where: { key: DIGITAL_ASSET_SETTINGS_KEY },
        update: { value: { modules } },
        create: { key: DIGITAL_ASSET_SETTINGS_KEY, value: { modules } },
      });
    });
    return { tiers, modules };
  }

  private buildAccountWhere(query: AdminDigitalAssetAccountQueryDto) {
    const where: any = {};
    if (query.minAmount !== undefined || query.maxAmount !== undefined) {
      where.cumulativeSpendAmount = {};
      if (query.minAmount !== undefined) where.cumulativeSpendAmount.gte = query.minAmount;
      if (query.maxAmount !== undefined) where.cumulativeSpendAmount.lte = query.maxAmount;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(`${query.endDate}T23:59:59`);
    }
    if (query.keyword) {
      const normalizedKeyword = normalizeBuyerNo(query.keyword);
      where.user = {
        OR: [
          { id: query.keyword },
          { buyerNo: normalizedKeyword },
          { profile: { nickname: { contains: query.keyword, mode: 'insensitive' } } },
          { authIdentities: { some: { provider: 'PHONE', identifier: { contains: query.keyword } } } },
        ],
      };
    }
    return where;
  }

  private normalizeAccountSort(query: AdminDigitalAssetAccountQueryDto): { field: AccountSortField; direction: AccountSortDirection } {
    const requestedField = query.sortField as AccountSortField | undefined;
    const field: AccountSortField = requestedField && (
      requestedField === 'totalAssetBalance'
      || Object.prototype.hasOwnProperty.call(ACCOUNT_SORT_FIELD_MAP, requestedField)
    )
      ? requestedField
      : 'cumulativeSpendAmount';
    const direction: AccountSortDirection = query.sortOrder === 'ascend' || query.sortOrder === 'asc' ? 'asc' : 'desc';
    return { field, direction };
  }

  private buildAccountOrderBy(sort: { field: PersistedAccountSortField; direction: AccountSortDirection }) {
    return [{ [ACCOUNT_SORT_FIELD_MAP[sort.field]]: sort.direction }, { id: 'asc' as const }];
  }

  private async findAccountsSortedByTotalAssetBalance(
    query: AdminDigitalAssetAccountQueryDto,
    where: any,
    page: number,
    pageSize: number,
    direction: AccountSortDirection,
  ) {
    const skip = (page - 1) * pageSize;
    const whereSql = this.buildAccountRawWhere(query);
    const directionSql = direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const rows: Array<{ id: string }> = await (this.prisma as any).$queryRaw(Prisma.sql`
      SELECT a."id"
      FROM "DigitalAssetAccount" a
      JOIN "User" u ON u."id" = a."userId"
      LEFT JOIN "UserProfile" p ON p."userId" = u."id"
      ${whereSql}
      ORDER BY (COALESCE(a."seedAssetBalance", 0) + COALESCE(a."creditAssetBalance", 0)) ${directionSql}, a."id" ASC
      OFFSET ${skip}
      LIMIT ${pageSize}
    `);
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const items = await (this.prisma as any).digitalAssetAccount.findMany({
      where: { ...where, id: { in: ids } },
      include: this.accountInclude(),
    });
    const byId = new Map(items.map((item: any) => [item.id, item]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  private async getVipAssetRankMap(items: any[]) {
    const ids = items.map((item) => item?.id).filter(Boolean);
    if (ids.length === 0) return new Map<string, number>();

    const rows: Array<{ id: string; assetRank: number | bigint }> = await (this.prisma as any).$queryRaw(Prisma.sql`
      WITH ranked AS (
        SELECT
          a."id",
          RANK() OVER (
            ORDER BY (COALESCE(a."seedAssetBalance", 0) + COALESCE(a."creditAssetBalance", 0)) DESC
          )::int AS "assetRank"
        FROM "DigitalAssetAccount" a
        JOIN "MemberProfile" mp ON mp."userId" = a."userId"
        WHERE mp."tier"::text = 'VIP'
      )
      SELECT "id", "assetRank"
      FROM ranked
      WHERE "id" IN (${Prisma.join(ids)})
    `);

    const rankByAccountId = new Map<string, number>();
    rows.forEach((row) => {
      const rank = Number(row.assetRank);
      if (Number.isFinite(rank)) {
        rankByAccountId.set(row.id, rank);
      }
    });
    return rankByAccountId;
  }

  private buildAccountRawWhere(query: AdminDigitalAssetAccountQueryDto) {
    const filters: Prisma.Sql[] = [];
    if (query.minAmount !== undefined) {
      filters.push(Prisma.sql`a."cumulativeSpendAmount" >= ${query.minAmount}`);
    }
    if (query.maxAmount !== undefined) {
      filters.push(Prisma.sql`a."cumulativeSpendAmount" <= ${query.maxAmount}`);
    }
    if (query.startDate) {
      filters.push(Prisma.sql`a."createdAt" >= ${new Date(query.startDate)}`);
    }
    if (query.endDate) {
      filters.push(Prisma.sql`a."createdAt" <= ${new Date(`${query.endDate}T23:59:59`)}`);
    }
    if (query.keyword) {
      const normalizedKeyword = normalizeBuyerNo(query.keyword);
      const keywordLike = `%${query.keyword}%`;
      filters.push(Prisma.sql`(
        u."id" = ${query.keyword}
        OR u."buyerNo" = ${normalizedKeyword}
        OR p."nickname" ILIKE ${keywordLike}
        OR EXISTS (
          SELECT 1
          FROM "AuthIdentity" ai
          WHERE ai."userId" = u."id"
            AND ai."provider"::text = 'PHONE'
            AND ai."identifier" LIKE ${keywordLike}
        )
      )`);
    }
    return filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
  }

  private accountInclude() {
    return {
      user: {
        select: {
          id: true,
          buyerNo: true,
          status: true,
          profile: { select: { nickname: true, avatarUrl: true } },
          memberProfile: { select: { tier: true } },
          authIdentities: {
            where: { provider: 'PHONE' },
            select: { identifier: true },
            take: 1,
          },
        },
      },
    };
  }

  private mapAccount(item: any, assetRank: number | null = null) {
    return {
      id: item.id,
      userId: item.userId,
      assetRank,
      cumulativeSpendAmount: item.cumulativeSpendAmount,
      seedAssetBalance: item.seedAssetBalance ?? 0,
      creditAssetBalance: item.creditAssetBalance ?? 0,
      frozenCreditAssetBalance: item.frozenCreditAssetBalance ?? 0,
      totalAssetBalance: (item.seedAssetBalance ?? 0) + (item.creditAssetBalance ?? 0),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      user: {
        id: item.user?.id ?? item.userId,
        buyerNo: item.user?.buyerNo ?? null,
        nickname: item.user?.profile?.nickname ?? null,
        avatarUrl: item.user?.profile?.avatarUrl ?? null,
        phone: maskPhone(item.user?.authIdentities?.[0]?.identifier ?? null),
        status: item.user?.status ?? null,
        vipStatus: item.user?.memberProfile?.tier ?? 'NORMAL',
      },
    };
  }

  private normalizeCreditTiers(tiers?: CreditAssetTier[]) {
    try {
      return validateCreditTiers((tiers ?? DEFAULT_CREDIT_TIERS) as CreditAssetTier[]);
    } catch (error: any) {
      throw new BadRequestException(error?.message ?? '消费资产倍率档位不合法');
    }
  }

  private normalizeSettings(modules: any[], options?: { allowLegacyKey?: boolean }) {
    return normalizeDigitalAssetModuleSettings(modules, options);
  }

  private escapeCsv(value: string) {
    if (!/[",\n]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }
}
