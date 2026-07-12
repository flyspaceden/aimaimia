import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaptainProfileStatus, CompanyStatus, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
  CAPTAIN_SHANGHAI_OFFSET_MS,
  getCaptainShanghaiMonth,
  normalizeCaptainSeafoodConfig,
  validateCaptainSeafoodConfig,
} from '../../captain/captain.constants';
import { CaptainApplicationService } from '../../captain/captain-application.service';
import { CaptainConfigService } from '../../captain/captain-config.service';
import { CaptainMonthlySettlementService } from '../../captain/captain-monthly-settlement.service';
import { CaptainRelationService } from '../../captain/captain-relation.service';
import { ProfitSafetyService } from '../../profit/profit-safety.service';
import {
  ApproveCaptainApplicationDto,
  RejectCaptainApplicationDto,
} from '../../captain/dto/captain-application.dto';
import {
  CreateCaptainProfileDto,
  GenerateCaptainSettlementsDto,
  ListCaptainApplicationsQueryDto,
  ListCaptainLedgersQueryDto,
  ListCaptainOrdersQueryDto,
  ListCaptainProfilesQueryDto,
  ListCaptainScopeOptionsQueryDto,
  ListCaptainSettlementsQueryDto,
  UpdateCaptainProfileStatusDto,
} from './admin-captain.dto';

@Injectable()
export class AdminCaptainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relationService: CaptainRelationService,
    private readonly configService: CaptainConfigService,
    private readonly monthlySettlementService: CaptainMonthlySettlementService,
    private readonly applicationService: CaptainApplicationService,
    private readonly profitSafetyService: ProfitSafetyService,
  ) {}

  async listProfiles(query: ListCaptainProfilesQueryDto = {}) {
    const { page, pageSize, skip } = this.pagination(query);
    const where: any = {
      programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
    };
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = this.profileKeywordWhere(query.keyword);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).captainProfile.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: this.profileInclude(query.month),
      }),
      (this.prisma as any).captainProfile.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async createProfile(dto: CreateCaptainProfileDto, adminUserId: string) {
    return this.relationService.createCaptainProfile({
      userId: dto.userId,
      captainCode: dto.captainCode,
      displayName: dto.displayName,
      adminUserId,
    });
  }

  listApplications(query: ListCaptainApplicationsQueryDto = {}) {
    return this.applicationService.listAdmin(query);
  }

  getApplication(id: string) {
    return this.applicationService.getAdmin(id);
  }

  approveApplication(id: string, adminUserId: string, dto: ApproveCaptainApplicationDto) {
    return this.applicationService.approve(id, adminUserId, dto);
  }

  rejectApplication(id: string, adminUserId: string, dto: RejectCaptainApplicationDto) {
    return this.applicationService.reject(id, adminUserId, dto);
  }

  async getProfile(userId: string, month?: string) {
    const profile = await (this.prisma as any).captainProfile.findUnique({
      where: { userId },
      include: this.profileInclude(month),
    });
    if (!profile) throw new NotFoundException('团长不存在');
    const account = await (this.prisma as any).captainAccount.findUnique({
      where: {
        userId_programCode: {
          userId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
      },
    });
    return { ...profile, account };
  }

  async updateProfileStatus(
    userId: string,
    dto: UpdateCaptainProfileStatusDto,
    adminUserId: string,
  ) {
    const existing = await (this.prisma as any).captainProfile.findUnique({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('团长不存在');

    const now = new Date();
    const data: any = {
      status: dto.status,
      statusReason: dto.reason ?? null,
      meta: {
        ...(existing.meta || {}),
        lastStatusAdminUserId: adminUserId,
        lastStatusAt: now.toISOString(),
      },
    };
    if (dto.status === CaptainProfileStatus.ACTIVE) {
      data.approvedAt = existing.approvedAt ?? now;
      data.pausedAt = null;
      data.disabledAt = null;
    }
    if (dto.status === CaptainProfileStatus.PAUSED) {
      data.pausedAt = now;
    }
    if (dto.status === CaptainProfileStatus.DISABLED) {
      data.disabledAt = now;
    }

    return (this.prisma as any).captainProfile.update({
      where: { userId },
      data,
    });
  }

  async getTeam(userId: string) {
    const items = await (this.prisma as any).captainRelation.findMany({
      where: {
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        status: 'ACTIVE',
        directCaptainUserId: userId,
      },
      orderBy: { boundAt: 'desc' },
      include: {
        buyer: {
          select: {
            id: true,
            buyerNo: true,
            profile: { select: { nickname: true, avatarUrl: true } },
          },
        },
        directCaptain: {
          select: {
            id: true,
            buyerNo: true,
            profile: { select: { nickname: true } },
          },
        },
      },
    });

    return { items: items.map((item: any) => this.stripLegacySecondLevel(item)) };
  }

  async listOrders(query: ListCaptainOrdersQueryDto = {}) {
    const { page, pageSize, skip } = this.pagination(query);
    const where: any = {
      programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
    };
    const and: any[] = [];
    if (query.captainUserId) where.directCaptainUserId = query.captainUserId;
    if (query.buyerUserId) where.buyerUserId = query.buyerUserId;
    if (query.status) where.status = query.status;
    if (query.month) {
      and.push({ order: { paidAt: this.monthDateWhere(query.month) } });
    }
    if (query.keyword) {
      and.push({
        OR: [
          { orderId: query.keyword },
          { buyer: { buyerNo: { contains: query.keyword, mode: 'insensitive' } } },
        ],
      });
    }
    if (and.length > 0) {
      where.AND = and;
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).captainOrderAttribution.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, status: true, totalAmount: true, createdAt: true } },
          buyer: { select: { id: true, buyerNo: true, profile: { select: { nickname: true } } } },
          directCaptain: { select: { id: true, buyerNo: true, profile: { select: { nickname: true } } } },
        },
      }),
      (this.prisma as any).captainOrderAttribution.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.stripLegacySecondLevel(item)),
      total,
      page,
      pageSize,
    };
  }

  async listLedgers(query: ListCaptainLedgersQueryDto = {}) {
    const { page, pageSize, skip } = this.pagination(query);
    const where: any = {
      programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
      deletedAt: null,
    };
    if (query.userId) where.userId = query.userId;
    if (query.orderId) where.orderId = query.orderId;
    if (query.settlementId) where.settlementId = query.settlementId;
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { id: query.keyword },
        { orderId: query.keyword },
        { refId: query.keyword },
        { user: { buyerNo: { contains: query.keyword, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).captainCommissionLedger.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, buyerNo: true, profile: { select: { nickname: true } } } },
          orderAttribution: { select: { id: true, orderId: true, buyerUserId: true } },
          settlement: { select: { id: true, month: true, status: true } },
        },
      }),
      (this.prisma as any).captainCommissionLedger.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async listSettlements(query: ListCaptainSettlementsQueryDto = {}) {
    const { page, pageSize, skip } = this.pagination(query);
    const where: any = {
      programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
    };
    if (query.userId) where.captainUserId = query.userId;
    if (query.month) where.month = query.month;
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { id: query.keyword },
        { captain: { buyerNo: { contains: query.keyword, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).captainMonthlySettlement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
        include: {
          captain: { select: { id: true, buyerNo: true, profile: { select: { nickname: true } } } },
          metric: true,
        },
      }),
      (this.prisma as any).captainMonthlySettlement.count({ where }),
    ]);

    const itemsWithReviewState = await Promise.all(items.map(async (settlement: any) => ({
      ...settlement,
      reviewBlockedReason: await this.monthlySettlementService.getReviewBlockReason(settlement),
    })));
    return { items: itemsWithReviewState, total, page, pageSize };
  }

  generateSettlements(month: GenerateCaptainSettlementsDto['month']) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 必须是 YYYY-MM');
    }
    return this.monthlySettlementService.createDraftSettlements(month);
  }

  approveSettlement(id: string, adminUserId: string) {
    return this.monthlySettlementService.approveSettlement(id, adminUserId);
  }

  markSettlementPaid(id: string, adminUserId: string) {
    return this.monthlySettlementService.markPaid(id, adminUserId);
  }

  recalculateSettlement(id: string, adminUserId: string) {
    return this.monthlySettlementService.recalculateSettlement(id, adminUserId);
  }

  async listScopeOptions(query: ListCaptainScopeOptionsQueryDto) {
    switch (query.type) {
      case 'CATEGORY':
        return this.listCategoryScopeOptions(query);
      case 'PRODUCT':
        return this.listProductScopeOptions(query);
      case 'COMPANY':
        return this.listCompanyScopeOptions(query);
      default:
        throw new BadRequestException('不支持的适用范围类型');
    }
  }

  async getSettings() {
    return this.configService.getSnapshot();
  }

  async updateSettings(value: unknown, adminUserId: string) {
    let config;
    try {
      config = validateCaptainSeafoodConfig(normalizeCaptainSeafoodConfig(value));
    } catch (err: any) {
      throw new BadRequestException(err?.message || '团长配置不合法');
    }

    const { result } = await this.profitSafetyService.withCandidateChange({
      captainConfig: config,
      createdByAdminId: adminUserId,
      changeNote: '更新预包装海鲜团长经营激励配置',
    }, async (tx) => {
      await (tx as any).ruleConfig.upsert({
        where: { key: CAPTAIN_SEAFOOD_CONFIG_KEY },
        update: { value: config },
        create: {
          key: CAPTAIN_SEAFOOD_CONFIG_KEY,
          value: config,
        },
      });
      return config;
    });
    return result;
  }

  private async listCategoryScopeOptions(query: ListCaptainScopeOptionsQueryDto) {
    const { page, pageSize, skip } = this.pagination(query);
    const keyword = query.keyword?.trim();
    const selectedIds = this.scopeSelectedIds(query.selectedIds);
    const where: Prisma.CategoryWhereInput = {
      isActive: true,
      ...(keyword ? {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { path: { contains: keyword, mode: 'insensitive' } },
          { id: { contains: keyword, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const select = { id: true, name: true, path: true, level: true, isActive: true } as const;
    const [rows, total, selectedRows] = await Promise.all([
      this.prisma.category.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        select,
      }),
      this.prisma.category.count({ where }),
      selectedIds.length > 0
        ? this.prisma.category.findMany({ where: { id: { in: selectedIds } }, select })
        : Promise.resolve([]),
    ]);
    return this.scopeOptionResult({
      rows,
      selectedRows,
      selectedIds,
      total,
      page,
      pageSize,
      map: (row) => ({
        id: row.id,
        name: row.name,
        subtitle: row.path ? `类目路径：${row.path.replace(/^\/+/, '')}` : `第 ${row.level} 级类目`,
        status: row.isActive ? 'ACTIVE' : 'INACTIVE',
      }),
    });
  }

  private async listProductScopeOptions(query: ListCaptainScopeOptionsQueryDto) {
    const { page, pageSize, skip } = this.pagination(query);
    const keyword = query.keyword?.trim();
    const selectedIds = this.scopeSelectedIds(query.selectedIds);
    const where: Prisma.ProductWhereInput = {
      status: { not: ProductStatus.DRAFT },
      ...(keyword ? {
        OR: [
          { title: { contains: keyword, mode: 'insensitive' } },
          { id: { contains: keyword, mode: 'insensitive' } },
          { company: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
          { category: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const select = {
      id: true,
      title: true,
      status: true,
      type: true,
      company: { select: { name: true } },
      category: { select: { name: true } },
    } as const;
    const [rows, total, selectedRows] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select,
      }),
      this.prisma.product.count({ where }),
      selectedIds.length > 0
        ? this.prisma.product.findMany({ where: { id: { in: selectedIds } }, select })
        : Promise.resolve([]),
    ]);
    return this.scopeOptionResult({
      rows,
      selectedRows,
      selectedIds,
      total,
      page,
      pageSize,
      map: (row) => ({
        id: row.id,
        name: row.title,
        subtitle: [
          row.company?.name || '未知商户',
          row.category?.name || '未分类',
          row.type === 'BUNDLE' ? '组合商品' : '普通商品',
        ].join(' · '),
        status: row.status,
      }),
    });
  }

  private async listCompanyScopeOptions(query: ListCaptainScopeOptionsQueryDto) {
    const { page, pageSize, skip } = this.pagination(query);
    const keyword = query.keyword?.trim();
    const selectedIds = this.scopeSelectedIds(query.selectedIds);
    const where: Prisma.CompanyWhereInput = {
      status: CompanyStatus.ACTIVE,
      ...(keyword ? {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { shortName: { contains: keyword, mode: 'insensitive' } },
          { id: { contains: keyword, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const select = { id: true, name: true, shortName: true, status: true } as const;
    const [rows, total, selectedRows] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select,
      }),
      this.prisma.company.count({ where }),
      selectedIds.length > 0
        ? this.prisma.company.findMany({ where: { id: { in: selectedIds } }, select })
        : Promise.resolve([]),
    ]);
    return this.scopeOptionResult({
      rows,
      selectedRows,
      selectedIds,
      total,
      page,
      pageSize,
      map: (row) => ({
        id: row.id,
        name: row.name,
        subtitle: row.shortName ? `简称：${row.shortName}` : '未设置简称',
        status: row.status,
      }),
    });
  }

  private scopeSelectedIds(value?: string) {
    return [...new Set((value || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean))]
      .slice(0, 100);
  }

  private scopeOptionResult<T extends { id: string }>(input: {
    rows: T[];
    selectedRows: T[];
    selectedIds: string[];
    total: number;
    page: number;
    pageSize: number;
    map: (row: T) => { id: string; name: string; subtitle: string; status: string };
  }) {
    const selectedById = new Map(input.selectedRows.map((row) => [row.id, row]));
    return {
      items: input.rows.map(input.map),
      selectedItems: input.selectedIds
        .map((id) => selectedById.get(id))
        .filter((row): row is T => Boolean(row))
        .map(input.map),
      total: input.total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  private pagination(query: { page?: number; pageSize?: number }) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private stripLegacySecondLevel<T extends Record<string, any>>(record: T): T {
    const {
      legacyIndirectCaptainUserId: _legacyIndirectCaptainUserId,
      legacyIndirectCaptain: _legacyIndirectCaptain,
      legacyIndirectRate: _legacyIndirectRate,
      ...directOnly
    } = record;
    return directOnly as T;
  }

  private profileInclude(month?: string) {
    return {
      user: {
        include: {
          profile: { select: { nickname: true, avatarUrl: true } },
          captainAccounts: {
            where: { programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE },
          },
          captainMonthlyMetrics: {
            where: {
              month: month ?? this.currentMonth(),
              programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
            },
            take: 1,
          },
        },
      },
    };
  }

  private profileKeywordWhere(keyword: string) {
    return [
      { captainCode: { contains: keyword, mode: 'insensitive' } },
      { displayName: { contains: keyword, mode: 'insensitive' } },
      { user: { buyerNo: { contains: keyword, mode: 'insensitive' } } },
      { user: { profile: { nickname: { contains: keyword, mode: 'insensitive' } } } },
    ];
  }

  private monthDateWhere(month: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    const year = match ? Number(match[1]) : NaN;
    const monthNumber = match ? Number(match[2]) : NaN;
    if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) {
      throw new BadRequestException('month 必须是 YYYY-MM');
    }
    const start = new Date(Date.UTC(year, monthNumber - 1, 1) - CAPTAIN_SHANGHAI_OFFSET_MS);
    const end = new Date(Date.UTC(year, monthNumber, 1) - CAPTAIN_SHANGHAI_OFFSET_MS);
    return { gte: start, lt: end };
  }

  private currentMonth() {
    return getCaptainShanghaiMonth();
  }
}
