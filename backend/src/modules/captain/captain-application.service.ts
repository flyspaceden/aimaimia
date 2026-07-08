import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CAPTAIN_SEAFOOD_PROGRAM_CODE } from './captain.constants';
import { CaptainRelationService } from './captain-relation.service';
import {
  ApproveCaptainApplicationDto,
  CaptainApplicationStatusValue,
  RejectCaptainApplicationDto,
  SubmitCaptainApplicationDto,
} from './dto/captain-application.dto';

interface ListCaptainApplicationsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: CaptainApplicationStatusValue;
}

@Injectable()
export class CaptainApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relationService: CaptainRelationService,
  ) {}

  async getMyApplication(userId: string) {
    const [profile, application] = await Promise.all([
      (this.prisma as any).captainProfile.findUnique({
        where: { userId },
        select: {
          userId: true,
          captainCode: true,
          displayName: true,
          status: true,
          approvedAt: true,
          statusReason: true,
        },
      }),
      (this.prisma as any).captainApplication.findFirst({
        where: {
          userId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
        orderBy: { createdAt: 'desc' },
        include: this.applicationInclude(),
      }),
    ]);

    const isCaptain = profile?.status === 'ACTIVE';
    return {
      isCaptain,
      profile,
      application,
      canSubmit: !isCaptain && (!application || ['REJECTED', 'WITHDRAWN'].includes(application.status)),
    };
  }

  async submit(userId: string, dto: SubmitCaptainApplicationDto) {
    if (!dto.complianceAccepted) {
      throw new BadRequestException('请先确认团长合规承诺');
    }

    return (this.prisma as any).$transaction(async (tx: Prisma.TransactionClient) => {
      const existingProfile = await (tx as any).captainProfile.findUnique({
        where: { userId },
        select: { userId: true, status: true, captainCode: true },
      });
      if (existingProfile) {
        throw new BadRequestException('当前账号已开通过团长，请联系平台处理');
      }

      const pending = await (tx as any).captainApplication.findFirst({
        where: {
          userId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          status: 'PENDING',
        },
      });
      if (pending) {
        throw new ConflictException('已有团长申请正在审核中');
      }

      const snapshot = await this.buildSystemSnapshot(tx, userId);

      return (tx as any).captainApplication.create({
        data: {
          userId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          status: 'PENDING',
          realName: dto.realName.trim(),
          contact: dto.contact.trim(),
          city: dto.city.trim(),
          communityScale: dto.communityScale,
          expectedMonthlyGmv: dto.expectedMonthlyGmv,
          resourceTypes: dto.resourceTypes,
          promotionPlan: dto.promotionPlan.trim(),
          seafoodExperience: dto.seafoodExperience,
          complianceAccepted: dto.complianceAccepted,
          systemSnapshot: snapshot,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listAdmin(query: ListCaptainApplicationsQuery = {}) {
    const { page, pageSize, skip } = this.pagination(query);
    const where: any = {
      programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
    };
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = this.applicationKeywordWhere(query.keyword.trim());
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).captainApplication.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: this.applicationInclude(),
      }),
      (this.prisma as any).captainApplication.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getAdmin(id: string) {
    const application = await (this.prisma as any).captainApplication.findUnique({
      where: { id },
      include: this.applicationInclude(),
    });
    if (!application) {
      throw new NotFoundException('团长申请不存在');
    }
    return application;
  }

  async approve(id: string, adminUserId: string, dto: ApproveCaptainApplicationDto) {
    return (this.prisma as any).$transaction(async (tx: Prisma.TransactionClient) => {
      const application = await (tx as any).captainApplication.findUnique({
        where: { id },
      });
      if (!application) {
        throw new NotFoundException('团长申请不存在');
      }
      if (application.status !== 'PENDING') {
        throw new BadRequestException('只有待审核申请可以通过');
      }

      const existingProfile = await (tx as any).captainProfile.findUnique({
        where: { userId: application.userId },
      });
      let profile = existingProfile;
      if (existingProfile && existingProfile.status !== 'ACTIVE') {
        throw new BadRequestException('该用户已有非启用团长资料，请先处理团长状态');
      }
      if (!profile) {
        profile = await this.relationService.createCaptainProfileInTx(tx, {
          userId: application.userId,
          captainCode: dto.captainCode,
          displayName: dto.displayName,
          adminUserId,
        });
      }

      return (tx as any).captainApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedByAdminId: adminUserId,
          reviewedAt: new Date(),
          rejectReason: null,
          captainProfileUserId: profile.userId,
        },
        include: this.applicationInclude(),
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reject(id: string, adminUserId: string, dto: RejectCaptainApplicationDto) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('请填写驳回原因');
    }

    return (this.prisma as any).$transaction(async (tx: Prisma.TransactionClient) => {
      const application = await (tx as any).captainApplication.findUnique({
        where: { id },
      });
      if (!application) {
        throw new NotFoundException('团长申请不存在');
      }
      if (application.status !== 'PENDING') {
        throw new BadRequestException('只有待审核申请可以驳回');
      }

      return (tx as any).captainApplication.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedByAdminId: adminUserId,
          reviewedAt: new Date(),
          rejectReason: reason,
        },
        include: this.applicationInclude(),
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async buildSystemSnapshot(tx: Prisma.TransactionClient, userId: string) {
    const user = await (tx as any).user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        buyerNo: true,
        status: true,
        profile: { select: { nickname: true, city: true } },
        authIdentities: {
          where: { provider: 'PHONE' },
          select: { identifier: true, verified: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        memberProfile: { select: { tier: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const [orderCount, orderAmount, refundCount, refundAmount, boundRelation] = await Promise.all([
      (tx as any).order.count({
        where: {
          userId,
          deletedAt: null,
          paidAt: { not: null },
        },
      }),
      (tx as any).order.aggregate({
        where: {
          userId,
          deletedAt: null,
          paidAt: { not: null },
        },
        _sum: { totalAmount: true },
      }),
      (tx as any).refund.count({
        where: {
          status: 'REFUNDED',
          deletedAt: null,
          order: { userId },
        },
      }),
      (tx as any).refund.aggregate({
        where: {
          status: 'REFUNDED',
          deletedAt: null,
          order: { userId },
        },
        _sum: { amount: true },
      }),
      (tx as any).captainRelation.findUnique({
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
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
    ]);

    const paidAmount = Number(orderAmount?._sum?.totalAmount ?? 0);
    const refundAmountValue = Number(refundAmount?._sum?.amount ?? 0);
    const phoneIdentity = user.authIdentities?.[0];

    return {
      capturedAt: new Date().toISOString(),
      buyerNo: user.buyerNo ?? null,
      nickname: user.profile?.nickname ?? null,
      phone: phoneIdentity?.identifier ?? null,
      phoneVerified: phoneIdentity?.verified ?? false,
      userStatus: user.status,
      isVip: user.memberProfile?.tier === 'VIP',
      memberTier: user.memberProfile?.tier ?? null,
      orderCount,
      paidAmount,
      refundCount,
      refundAmount: refundAmountValue,
      refundRate: orderCount > 0 ? Number((refundCount / orderCount).toFixed(4)) : 0,
      boundCaptain: boundRelation?.directCaptain
        ? {
            userId: boundRelation.directCaptain.id,
            buyerNo: boundRelation.directCaptain.buyerNo ?? null,
            nickname: boundRelation.directCaptain.profile?.nickname ?? null,
          }
        : null,
    };
  }

  private applicationInclude() {
    return {
      user: {
        select: {
          id: true,
          buyerNo: true,
          profile: { select: { nickname: true, avatarUrl: true } },
          authIdentities: {
            where: { provider: 'PHONE' },
            select: { identifier: true, verified: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    };
  }

  private applicationKeywordWhere(keyword: string) {
    return [
      { id: keyword },
      { realName: { contains: keyword, mode: 'insensitive' } },
      { contact: { contains: keyword, mode: 'insensitive' } },
      { city: { contains: keyword, mode: 'insensitive' } },
      { user: { buyerNo: { contains: keyword, mode: 'insensitive' } } },
      { user: { profile: { nickname: { contains: keyword, mode: 'insensitive' } } } },
      { user: { authIdentities: { some: { identifier: { contains: keyword, mode: 'insensitive' } } } } },
    ];
  }

  private pagination(query: { page?: number; pageSize?: number }) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    return { page, pageSize, skip: (page - 1) * pageSize };
  }
}
