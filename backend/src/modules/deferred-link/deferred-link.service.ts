import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeferredLinkService {
  private readonly logger = new Logger(DeferredLinkService.name);

  constructor(private prisma: PrismaService) {}

  private normalizeUA(ua: string): string {
    return ua
      .replace(/\s*MicroMessenger\/[\d.]+/i, '')
      .replace(/\s*NetType\/\w+/i, '')
      .replace(/\s*Language\/[\w-]+/i, '')
      .replace(/\s*miniProgram\/[\d.]+/i, '')
      .trim()
      .slice(0, 500);
  }

  private computeFingerprint(ip: string, ua: string, screenInfo: string, language: string): string {
    const normalized = this.normalizeUA(ua);
    const raw = `${ip}|${normalized}|${screenInfo}|${language}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  async create(
    dto: { referralCode: string; userAgent: string; screenWidth: number; screenHeight: number; language?: string },
    ipAddress: string,
  ): Promise<{ cookieId: string }> {
    const member = await this.prisma.memberProfile.findUnique({
      where: { referralCode: dto.referralCode },
    });
    if (!member) {
      throw new BadRequestException('推荐码无效');
    }

    const screenInfo = `${dto.screenWidth}x${dto.screenHeight}`;
    const language = dto.language || '';
    const fingerprint = this.computeFingerprint(ipAddress, dto.userAgent, screenInfo, language);

    const record = await this.prisma.deferredDeepLink.create({
      data: {
        referralCode: dto.referralCode,
        fingerprint,
        ipAddress,
        userAgent: dto.userAgent.slice(0, 500),
        screenInfo,
        language: language || null,
        cookieId: this.generateCookieId(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    return { cookieId: record.cookieId };
  }

  async resolve(cookieId: string): Promise<{ referralCode: string | null }> {
    if (!cookieId || cookieId.length > 50) {
      return { referralCode: null };
    }

    const now = new Date();
    // 事务内原子操作：查找 + 标记已消费
    const record = await this.prisma.$transaction(async (tx) => {
      const found = await tx.deferredDeepLink.findUnique({
        where: { cookieId },
      });
      if (!found || found.matched || found.expiresAt < now) {
        return null;
      }
      return tx.deferredDeepLink.update({
        where: { id: found.id },
        data: { matched: true },
      });
    });

    return { referralCode: record?.referralCode ?? null };
  }

  async match(
    dto: { userAgent: string; screenWidth: number; screenHeight: number; language?: string },
    ipAddress: string,
  ): Promise<{ referralCode: string | null }> {
    const screenInfo = `${dto.screenWidth}x${dto.screenHeight}`;
    const language = dto.language || '';
    const fingerprint = this.computeFingerprint(ipAddress, dto.userAgent, screenInfo, language);
    const now = new Date();

    // 事务内原子操作：查找 + 标记已消费
    const record = await this.prisma.$transaction(async (tx) => {
      // 第一优先级：精确指纹匹配
      const exactMatch = await tx.deferredDeepLink.findFirst({
        where: {
          fingerprint,
          matched: false,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (exactMatch) {
        return tx.deferredDeepLink.update({
          where: { id: exactMatch.id },
          data: { matched: true },
        });
      }

      // 第二优先级：模糊匹配（同 IP + 相同屏幕信息）
      const fuzzyMatch = await tx.deferredDeepLink.findFirst({
        where: {
          ipAddress,
          screenInfo,
          matched: false,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (fuzzyMatch) {
        return tx.deferredDeepLink.update({
          where: { id: fuzzyMatch.id },
          data: { matched: true },
        });
      }

      return null;
    });

    return { referralCode: record?.referralCode ?? null };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpired() {
    const result = await this.prisma.deferredDeepLink.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`清理过期 DeferredDeepLink 记录：${result.count} 条`);
    }
  }

  private generateCookieId(): string {
    return 'ddl_' + randomBytes(18).toString('hex');
  }
}
