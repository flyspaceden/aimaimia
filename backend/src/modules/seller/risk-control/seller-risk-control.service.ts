import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  CompanyCreditEventType,
  CompanyStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

type SellerFeature = 'VIRTUAL_CALL' | 'BATCH_WAYBILL';

type CompanyAccessState = {
  id: string;
  status: CompanyStatus;
  creditScore: number;
  virtualCallRestrictedUntil: Date | null;
  suspendedUntil: Date | null;
};

type PrivacyViolationInput = {
  reason: string;
  sourceType: string;
  sourceRefId?: string;
  metadata?: Prisma.InputJsonValue;
  severe?: boolean;
};

@Injectable()
export class SellerRiskControlService {
  private readonly logger = new Logger(SellerRiskControlService.name);
  private static readonly SERIALIZABLE_RETRY_LIMIT = 3;

  constructor(private readonly prisma: PrismaService) {}

  async normalizeCompanyAccessStatus(
    companyId: string,
  ): Promise<CompanyAccessState | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        status: true,
        creditScore: true,
        virtualCallRestrictedUntil: true,
        suspendedUntil: true,
      },
    });

    if (!company) {
      return null;
    }

    return this.normalizeAccessState(company);
  }

  async assertFeatureAllowed(
    companyId: string,
    feature: SellerFeature,
  ): Promise<void> {
    const company = await this.normalizeCompanyAccessStatus(companyId);
    if (!company) {
      throw new ForbiddenException('企业不存在或已停用');
    }

    if (company.status === 'BANNED') {
      throw new ForbiddenException('企业已封禁，请联系管理员');
    }

    if (company.status !== 'ACTIVE') {
      if (company.suspendedUntil) {
        throw new ForbiddenException(
          `企业已停用，预计恢复时间：${this.formatUntil(company.suspendedUntil)}`,
        );
      }
      throw new ForbiddenException('企业已停用，请联系管理员');
    }

    if (feature === 'VIRTUAL_CALL') {
      if (
        company.virtualCallRestrictedUntil &&
        company.virtualCallRestrictedUntil > new Date()
      ) {
        throw new ForbiddenException(
          `企业虚拟号功能已限制至 ${this.formatUntil(company.virtualCallRestrictedUntil)}`,
        );
      }
      if (company.creditScore < 60) {
        throw new ForbiddenException('企业信用分过低，虚拟号功能已受限');
      }
      return;
    }

    if (feature === 'BATCH_WAYBILL' && company.creditScore < 60) {
      throw new ForbiddenException('企业信用分过低，批量面单功能已受限');
    }
  }

  async recordPrivacyViolation(
    companyId: string,
    input: PrivacyViolationInput,
  ) {
    for (let attempt = 0; attempt < SellerRiskControlService.SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          if (input.sourceRefId) {
            const duplicate = await tx.companyCreditEvent.findFirst({
              where: {
                companyId,
                type: CompanyCreditEventType.PRIVACY_VIOLATION,
                sourceType: input.sourceType,
                sourceRefId: input.sourceRefId,
              },
            });
            if (duplicate) {
              return duplicate;
            }
          }

          const company = await tx.company.findUnique({
            where: { id: companyId },
            select: {
              id: true,
              status: true,
              creditScore: true,
              virtualCallRestrictedUntil: true,
              suspendedUntil: true,
            },
          });

          if (!company) {
            throw new ForbiddenException('企业不存在或已停用');
          }

          const normalizedCompany = await this.normalizeAccessState(company, tx);
          const historicalViolationCount = await tx.companyCreditEvent.count({
            where: {
              companyId,
              type: CompanyCreditEventType.PRIVACY_VIOLATION,
            },
          });

          const violationLevel = historicalViolationCount + 1;
          const now = new Date();
          let scoreDelta = 0;
          let nextStatus = normalizedCompany.status;
          let virtualCallRestrictedUntil =
            normalizedCompany.virtualCallRestrictedUntil;
          let suspendedUntil = normalizedCompany.suspendedUntil;
          let action = '记录违规';

          if (input.severe) {
            scoreDelta = -100;
            nextStatus = 'BANNED';
            virtualCallRestrictedUntil = null;
            suspendedUntil = null;
            action = '严重违规，企业已永久封禁';
          } else if (violationLevel === 1) {
            scoreDelta = -10;
            action = '首次违规警告';
          } else if (violationLevel === 2) {
            scoreDelta = -20;
            virtualCallRestrictedUntil = this.maxDate(
              normalizedCompany.virtualCallRestrictedUntil,
              this.addDays(now, 7),
            );
            action = '第二次违规，虚拟号限制 7 天';
          } else if (violationLevel === 3) {
            nextStatus = 'SUSPENDED';
            suspendedUntil = this.addDays(now, 30);
            action = '第三次违规，企业暂停 30 天';
          } else {
            nextStatus = 'BANNED';
            virtualCallRestrictedUntil = null;
            suspendedUntil = null;
            action = '第四次违规，企业永久封禁';
          }

          const nextScore = Math.max(0, normalizedCompany.creditScore + scoreDelta);

          if (nextStatus === 'ACTIVE' && nextScore < 40) {
            nextStatus = 'SUSPENDED';
            suspendedUntil = null;
            action = '信用分低于 40，企业自动停用';
          }

          await tx.company.update({
            where: { id: companyId },
            data: {
              creditScore: nextScore,
              status: nextStatus,
              virtualCallRestrictedUntil,
              suspendedUntil,
            },
          });

          const event = await tx.companyCreditEvent.create({
            data: {
              companyId,
              type: CompanyCreditEventType.PRIVACY_VIOLATION,
              scoreDelta,
              reason: `${action}：${input.reason}`,
              sourceType: input.sourceType,
              sourceRefId: input.sourceRefId,
              metadata: {
                violationLevel,
                action,
                severe: Boolean(input.severe),
                ...(input.metadata && typeof input.metadata === 'object'
                  ? (input.metadata as Record<string, unknown>)
                  : {}),
              },
            },
          });

          this.logger.warn(
            `企业违规处罚已生效: companyId=${companyId}, level=${violationLevel}, score=${normalizedCompany.creditScore}->${nextScore}, status=${normalizedCompany.status}->${nextStatus}`,
          );

          return event;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        if (
          error?.code === 'P2034' &&
          attempt < SellerRiskControlService.SERIALIZABLE_RETRY_LIMIT - 1
        ) {
          this.logger.warn(
            `企业违规处罚事务冲突（P2034），重试 ${attempt + 1}/${SellerRiskControlService.SERIALIZABLE_RETRY_LIMIT}: companyId=${companyId}`,
          );
          continue;
        }
        throw error;
      }
    }

    throw new ForbiddenException('企业违规处罚失败，请稍后重试');
  }

  @Cron('0 */10 * * * *')
  async restoreExpiredSuspensions(): Promise<void> {
    const now = new Date();
    const { count } = await this.prisma.company.updateMany({
      where: {
        status: 'SUSPENDED',
        suspendedUntil: { lte: now },
        creditScore: { gte: 40 },
      },
      data: {
        status: 'ACTIVE',
        suspendedUntil: null,
      },
    });

    if (count > 0) {
      this.logger.log(`已自动恢复 ${count} 家到期停用企业`);
    }
  }

  private async normalizeAccessState(
    company: CompanyAccessState,
    tx?: Prisma.TransactionClient,
  ): Promise<CompanyAccessState> {
    if (
      company.status === 'SUSPENDED' &&
      company.suspendedUntil &&
      company.suspendedUntil <= new Date() &&
      company.creditScore >= 40
    ) {
      const client = tx ?? this.prisma;
      const updated = await client.company.update({
        where: { id: company.id },
        data: {
          status: 'ACTIVE',
          suspendedUntil: null,
        },
        select: {
          id: true,
          status: true,
          creditScore: true,
          virtualCallRestrictedUntil: true,
          suspendedUntil: true,
        },
      });
      return updated;
    }

    return company;
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private maxDate(current: Date | null, candidate: Date): Date {
    if (!current || current < candidate) {
      return candidate;
    }
    return current;
  }

  private formatUntil(date: Date): string {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
