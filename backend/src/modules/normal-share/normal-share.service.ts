import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BindNormalShareDto } from './dto/bind-normal-share.dto';

const SHARE_BASE_URL = process.env.NORMAL_SHARE_BASE_URL || 'https://app.ai-maimai.com';
const SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class NormalShareService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.normalShareProfile.findUnique({
        where: { userId },
      });
      if (existing) {
        return this.toProfileResponse(existing);
      }

      const code = await this.pickUniqueCode(tx);
      const created = await tx.normalShareProfile.create({
        data: {
          userId,
          code,
          status: 'ACTIVE',
        },
      });
      return this.toProfileResponse(created);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async bind(inviteeUserId: string, dto: BindNormalShareDto) {
    const code = this.normalizeCode(dto.code);
    if (!code) {
      throw new BadRequestException('普通分享码无效');
    }

    return this.prisma.$transaction(async (tx) => {
      const inviterProfile = await tx.normalShareProfile.findUnique({
        where: { code },
        include: {
          user: {
            select: {
              id: true,
              status: true,
              deletionExecutedAt: true,
              profile: { select: { nickname: true, avatarUrl: true } },
            },
          },
        },
      });
      if (!inviterProfile) {
        throw new BadRequestException('普通分享码无效');
      }
      if (inviterProfile.status !== 'ACTIVE') {
        throw new BadRequestException('普通分享码已停用');
      }
      if (
        inviterProfile.user.status !== UserStatus.ACTIVE ||
        inviterProfile.user.deletionExecutedAt
      ) {
        throw new BadRequestException('邀请人账号不可用');
      }
      if (inviterProfile.userId === inviteeUserId) {
        throw new BadRequestException('不能绑定自己的普通分享码');
      }

      const existingNormalBinding = await tx.normalShareBinding.findUnique({
        where: { inviteeUserId },
      });
      if (existingNormalBinding) {
        if (
          existingNormalBinding.inviterUserId === inviterProfile.userId ||
          existingNormalBinding.code === code
        ) {
          return { ...existingNormalBinding, isIdempotent: true };
        }
        throw new BadRequestException('已绑定普通分享关系，不能更换');
      }

      const existingVipReferral = await tx.referralLink.findUnique({
        where: { inviteeUserId },
      });
      if (existingVipReferral) {
        throw new BadRequestException('已存在 VIP 推荐关系，不能绑定普通分享码');
      }

      return tx.normalShareBinding.create({
        data: {
          inviterUserId: inviterProfile.userId,
          inviteeUserId,
          code,
          source: dto.source ?? 'APP',
          rewardStatus: 'PENDING',
          meta: Prisma.JsonNull,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getStats(userId: string) {
    const [total, rewarded, pending] = await Promise.all([
      this.prisma.normalShareBinding.count({
        where: { inviterUserId: userId },
      }),
      this.prisma.normalShareBinding.count({
        where: { inviterUserId: userId, rewardStatus: 'ISSUED' },
      }),
      this.prisma.normalShareBinding.count({
        where: {
          inviterUserId: userId,
          rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
        },
      }),
    ]);

    return {
      totalInvitees: total,
      rewardedInvitees: rewarded,
      pendingInvitees: pending,
    };
  }

  async getRecords(userId: string) {
    return this.prisma.normalShareBinding.findMany({
      where: { inviterUserId: userId },
      include: {
        invitee: {
          select: {
            id: true,
            buyerNo: true,
            profile: { select: { nickname: true, avatarUrl: true } },
          },
        },
        firstOrder: {
          select: {
            id: true,
            totalAmount: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private normalizeCode(code?: string) {
    return (code || '').trim().toUpperCase();
  }

  private toProfileResponse(profile: any) {
    return {
      id: profile.id,
      userId: profile.userId,
      code: profile.code,
      status: profile.status,
      disabledReason: profile.disabledReason ?? null,
      shareUrl: `${SHARE_BASE_URL}/s/${profile.code}`,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private async pickUniqueCode(tx: Prisma.TransactionClient) {
    for (let i = 0; i < 10; i++) {
      const code = this.generateCode();
      const existing = await tx.normalShareProfile.findUnique({
        where: { code },
      });
      if (!existing) {
        return code;
      }
    }
    throw new Error('pickUniqueNormalShareCode: 10 次尝试均冲突');
  }

  private generateCode() {
    let code = 'S';
    for (let i = 0; i < 7; i++) {
      code += SHARE_CODE_ALPHABET.charAt(Math.floor(Math.random() * SHARE_CODE_ALPHABET.length));
    }
    return code;
  }
}
