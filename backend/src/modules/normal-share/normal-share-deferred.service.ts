import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateNormalShareDeferredDto } from './dto/create-normal-share-deferred.dto';

@Injectable()
export class NormalShareDeferredService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateNormalShareDeferredDto,
    ipAddress: string,
  ): Promise<{ cookieId: string }> {
    const code = this.normalizeCode(dto.code);
    await this.assertCodeBindable(this.prisma, code);

    const screenInfo = `${dto.screenWidth}x${dto.screenHeight}`;
    const language = dto.language || '';
    const fingerprint = this.computeFingerprint(
      ipAddress,
      dto.userAgent,
      screenInfo,
      language,
    );

    const record = await this.prisma.normalShareDeferredLink.create({
      data: {
        code,
        fingerprint,
        ipAddress,
        userAgent: dto.userAgent.slice(0, 500),
        screenInfo,
        language: language || null,
        cookieId: this.generateCookieId(),
        matched: false,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    return { cookieId: record.cookieId };
  }

  async resolve(cookieId: string): Promise<{ code: string | null }> {
    if (!cookieId || cookieId.length > 80) {
      return { code: null };
    }

    const now = new Date();
    const record = await this.prisma.$transaction(async (tx) => {
      const found = await tx.normalShareDeferredLink.findUnique({
        where: { cookieId },
      });
      if (!found || found.matched || found.expiresAt < now) {
        return null;
      }

      const consumed = await tx.normalShareDeferredLink.update({
        where: { id: found.id },
        data: { matched: true },
      });

      return (await this.isCodeBindable(tx, consumed.code)) ? consumed : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { code: record?.code ?? null };
  }

  private async assertCodeBindable(prisma: PrismaService | Prisma.TransactionClient, code: string) {
    const bindable = await this.isCodeBindable(prisma, code);
    if (!bindable) {
      throw new BadRequestException('普通分享码无效');
    }
  }

  private async isCodeBindable(
    prisma: PrismaService | Prisma.TransactionClient,
    code: string,
  ) {
    if (!code) return false;
    const profile = await prisma.normalShareProfile.findUnique({
      where: { code },
      include: {
        user: {
          select: {
            status: true,
            deletionExecutedAt: true,
            memberProfile: { select: { tier: true } },
          },
        },
      },
    });
    return Boolean(
      profile &&
      profile.status === 'ACTIVE' &&
      profile.user.status === UserStatus.ACTIVE &&
      !profile.user.deletionExecutedAt &&
      profile.user.memberProfile?.tier !== 'VIP',
    );
  }

  private normalizeCode(code?: string) {
    return (code || '').trim().toUpperCase();
  }

  private computeFingerprint(
    ip: string,
    userAgent: string,
    screenInfo: string,
    language: string,
  ) {
    const normalizedUa = userAgent
      .replace(/\s*MicroMessenger\/[\d.]+/i, '')
      .replace(/\s*NetType\/\w+/i, '')
      .replace(/\s*Language\/[\w-]+/i, '')
      .replace(/\s*Chrome\/[\d.]+/i, '')
      .replace(/\s*Safari\/[\d.]+/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    return createHash('sha256')
      .update(`${ip}|${normalizedUa}|${screenInfo}|${language}`)
      .digest('hex');
  }

  private generateCookieId() {
    return `nsdl_${randomBytes(16).toString('hex')}`;
  }
}
