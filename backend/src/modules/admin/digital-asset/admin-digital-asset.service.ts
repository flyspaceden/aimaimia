import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DigitalAssetService } from '../../digital-asset/digital-asset.service';
import { validateCreditTiers } from '../../digital-asset/digital-asset-credit-calculator';
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
const ALLOWED_SETTING_FIELDS = new Set(['key', 'title', 'enabled', 'description']);
const DEFAULT_MODULE_SETTINGS = [
  { key: 'assetValue', title: '资产价值', enabled: false, description: '规则待公布' },
  { key: 'level', title: '资产等级', enabled: false, description: '待开放' },
  { key: 'benefits', title: '权益兑换', enabled: false, description: '待开放' },
  { key: 'equity', title: '工资/期权/股权', enabled: false, description: '规则待公布' },
];
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

    const [accounts, creditToday, debitToday] = await Promise.all([
      (this.prisma as any).digitalAssetAccount.aggregate({
        _count: { _all: true },
        _sum: {
          cumulativeSpendAmount: true,
          seedAssetBalance: true,
          creditAssetBalance: true,
        },
      }),
      (this.prisma as any).digitalAssetLedger.aggregate({
        where: { direction: 'CREDIT', createdAt: { gte: startOfDay } },
        _sum: { amount: true },
      }),
      (this.prisma as any).digitalAssetLedger.aggregate({
        where: { direction: 'DEBIT', createdAt: { gte: startOfDay } },
        _sum: { amount: true },
      }),
    ]);

    const totalSeedAssetBalance = accounts?._sum?.seedAssetBalance ?? 0;
    const totalCreditAssetBalance = accounts?._sum?.creditAssetBalance ?? 0;

    return {
      accountCount: accounts?._count?._all ?? 0,
      totalCumulativeSpendAmount: accounts?._sum?.cumulativeSpendAmount ?? 0,
      totalSeedAssetBalance,
      totalCreditAssetBalance,
      totalAssetBalance: totalSeedAssetBalance + totalCreditAssetBalance,
      todayCreditAmount: creditToday?._sum?.amount ?? 0,
      todayDebitAmount: debitToday?._sum?.amount ?? 0,
    };
  }

  async findAccounts(query: AdminDigitalAssetAccountQueryDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where = this.buildAccountWhere(query);

    const [items, total] = await Promise.all([
      (this.prisma as any).digitalAssetAccount.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { cumulativeSpendAmount: 'desc' },
        include: this.accountInclude(),
      }),
      (this.prisma as any).digitalAssetAccount.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.mapAccount(item)),
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
    const items = await (this.prisma as any).digitalAssetAccount.findMany({
      where,
      take: 5000,
      orderBy: { cumulativeSpendAmount: 'desc' },
      include: this.accountInclude(),
    });
    const rows = [
      ['买家编号', '用户ID', '昵称', '手机号', 'VIP状态', '数字资产总额', '种子资产', '信用资产', '累计消费', '账户更新时间'],
      ...items.map((item: any) => [
        item.user?.buyerNo ?? '',
        item.userId,
        item.user?.profile?.nickname ?? '',
        maskPhone(item.user?.authIdentities?.[0]?.identifier ?? null) ?? '',
        item.user?.memberProfile?.tier ?? 'NORMAL',
        String((item.seedAssetBalance ?? 0) + (item.creditAssetBalance ?? 0)),
        String(item.seedAssetBalance ?? 0),
        String(item.creditAssetBalance ?? 0),
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
      modules: this.normalizeSettings((moduleConfig?.value as any)?.modules ?? DEFAULT_MODULE_SETTINGS),
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

  private mapAccount(item: any) {
    return {
      id: item.id,
      userId: item.userId,
      cumulativeSpendAmount: item.cumulativeSpendAmount,
      seedAssetBalance: item.seedAssetBalance ?? 0,
      creditAssetBalance: item.creditAssetBalance ?? 0,
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
      throw new BadRequestException(error?.message ?? '信用资产倍率档位不合法');
    }
  }

  private normalizeSettings(modules: any[]) {
    if (!Array.isArray(modules)) throw new BadRequestException('modules 必须是数组');
    const defaults = new Map(DEFAULT_MODULE_SETTINGS.map((item) => [item.key, item]));
    const seen = new Set<string>();

    return modules.map((item) => {
      const extraFields = Object.keys(item ?? {}).filter((key) => !ALLOWED_SETTING_FIELDS.has(key));
      if (extraFields.length > 0) {
        throw new BadRequestException(`数字资产规则字段尚未开放: ${extraFields.join(', ')}`);
      }
      const fallback = defaults.get(item?.key);
      if (!fallback) throw new BadRequestException(`未知数字资产模块: ${item?.key ?? ''}`);
      if (seen.has(item.key)) throw new BadRequestException(`重复数字资产模块: ${item.key}`);
      seen.add(item.key);
      return {
        key: item.key,
        title: item.title ?? fallback.title,
        enabled: item.enabled ?? fallback.enabled,
        description: item.description ?? fallback.description,
      };
    });
  }

  private escapeCsv(value: string) {
    if (!/[",\n]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }
}
