import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CAPTAIN_SEAFOOD_PROGRAM_CODE, getCaptainShanghaiMonth } from './captain.constants';
import { CaptainConfigService } from './captain-config.service';
import { CaptainRelationService } from './captain-relation.service';

@Injectable()
export class CaptainBuyerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: CaptainConfigService,
    private readonly relationService: CaptainRelationService,
  ) {}

  async getLanding(code: string) {
    const captainCode = this.normalizeCode(code);
    const config = await this.configService.getConfig();
    const profile = await (this.prisma as any).captainProfile.findFirst({
      where: {
        captainCode,
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: {
            id: true,
            buyerNo: true,
            profile: { select: { nickname: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!profile) {
      return {
        code: captainCode,
        valid: false,
        enabled: config.enabled,
        programName: config.programName,
        captain: null,
        reason: '团长码无效或已停用',
      };
    }

    return {
      code: captainCode,
      valid: true,
      enabled: config.enabled,
      programName: config.programName,
      captain: this.toCaptainPublic(profile),
    };
  }

  async bindByCode(buyerUserId: string, code: string) {
    const captainCode = this.normalizeCode(code);
    const config = await this.configService.getConfig();
    if (!config.enabled) {
      throw new BadRequestException('团长经营暂未开放');
    }
    const relation = await this.relationService.bindBuyerToCaptainCode({
      buyerUserId,
      captainCode,
      source: 'APP_CAPTAIN_LINK',
    });
    return {
      success: true,
      relation,
    };
  }

  async getMyCaptainProfile(userId: string) {
    const currentMonth = this.currentMonth();
    const [profile, account, metric, boundRelation] = await Promise.all([
      (this.prisma as any).captainProfile.findUnique({
        where: { userId },
        include: {
          user: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true, avatarUrl: true } },
            },
          },
        },
      }),
      (this.prisma as any).captainAccount.findUnique({
        where: {
          userId_programCode: {
            userId,
            programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          },
        },
      }),
      (this.prisma as any).captainMonthlyMetric.findFirst({
        where: {
          captainUserId: userId,
          month: currentMonth,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
      }),
      (this.prisma as any).captainRelation.findUnique({
        where: {
          buyerUserId_programCode: {
            buyerUserId: userId,
            programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          },
        },
        include: {
          directCaptain: {
            select: {
              id: true,
              buyerNo: true,
              profile: { select: { nickname: true, avatarUrl: true } },
            },
          },
        },
      }),
    ]);

    return {
      isCaptain: profile?.status === 'ACTIVE',
      profile,
      account,
      metric,
      boundRelation: this.stripLegacySecondLevel(boundRelation),
    };
  }

  async listMyLedgers(userId: string, page = 1, pageSize = 20) {
    const pagination = this.pagination(page, pageSize);
    const where = {
      userId,
      programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
      deletedAt: null,
    };
    const [items, total] = await Promise.all([
      (this.prisma as any).captainCommissionLedger.findMany({
        where,
        skip: pagination.skip,
        take: pagination.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          orderAttribution: {
            select: {
              id: true,
              orderId: true,
              buyerUserId: true,
              status: true,
              calculationModel: true,
              profitBaseAmount: true,
            },
          },
          settlement: { select: { id: true, month: true, status: true, meta: true } },
        },
      }),
      (this.prisma as any).captainCommissionLedger.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.stripLegacySecondLevel(item)),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  async listMyOrders(userId: string, page = 1, pageSize = 20) {
    const pagination = this.pagination(page, pageSize);
    const where = {
      programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
      directCaptainUserId: userId,
    };
    const [items, total] = await Promise.all([
      (this.prisma as any).captainOrderAttribution.findMany({
        where,
        skip: pagination.skip,
        take: pagination.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, status: true, totalAmount: true, createdAt: true } },
          buyer: { select: { id: true, buyerNo: true, profile: { select: { nickname: true, avatarUrl: true } } } },
        },
      }),
      (this.prisma as any).captainOrderAttribution.count({ where }),
    ]);

    return {
      items: items.map((item: any) => this.stripLegacySecondLevel(item)),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  private toCaptainPublic(profile: any) {
    return {
      userId: profile.userId,
      captainCode: profile.captainCode,
      displayName: profile.displayName,
      buyerNo: profile.user?.buyerNo ?? null,
      nickname: profile.user?.profile?.nickname ?? null,
      avatarUrl: profile.user?.profile?.avatarUrl ?? null,
    };
  }

  private stripLegacySecondLevel<T extends Record<string, any> | null>(record: T): T {
    if (!record) return record;
    const {
      legacyIndirectCaptainUserId: _legacyIndirectCaptainUserId,
      legacyIndirectCaptain: _legacyIndirectCaptain,
      legacyIndirectRate: _legacyIndirectRate,
      ...directOnly
    } = record;
    return directOnly as T;
  }

  private normalizeCode(code: string) {
    return (code || '').trim().toUpperCase();
  }

  private pagination(pageInput: number, pageSizeInput: number) {
    const page = Math.max(Number(pageInput) || 1, 1);
    const pageSize = Math.min(Math.max(Number(pageSizeInput) || 20, 1), 100);
    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize,
    };
  }

  private currentMonth() {
    return getCaptainShanghaiMonth();
  }
}
