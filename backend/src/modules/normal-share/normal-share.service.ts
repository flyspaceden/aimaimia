import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthEventService } from '../growth/growth-event.service';
import { BindNormalShareDto } from './dto/bind-normal-share.dto';
import { generateNormalShareCode } from './normal-share-code.util';

const SHARE_BASE_URL = process.env.NORMAL_SHARE_BASE_URL || 'https://app.ai-maimai.com';

@Injectable()
export class NormalShareService {
  private readonly logger = new Logger(NormalShareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly growthEvents: GrowthEventService,
  ) {}

  async getMe(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOrdinaryShareUser(tx, userId);

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

    const binding = await this.prisma.$transaction(async (tx) => {
      const inviteeMember = await tx.memberProfile.findUnique({
        where: { userId: inviteeUserId },
        select: { tier: true, inviterUserId: true },
      });
      if (inviteeMember?.tier === 'VIP') {
        throw new BadRequestException('VIP 用户不使用普通分享码');
      }

      const inviterProfile = await tx.normalShareProfile.findUnique({
        where: { code },
        include: {
          user: {
            select: {
              id: true,
              status: true,
              deletionExecutedAt: true,
              profile: { select: { nickname: true, avatarUrl: true } },
              memberProfile: { select: { tier: true } },
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
      if (
        inviteeMember?.inviterUserId &&
        inviteeMember.inviterUserId !== inviterProfile.userId
      ) {
        throw new BadRequestException('已绑定推荐关系，不能更换');
      }

      const ensureMemberInviter = async () => {
        if (inviteeMember?.inviterUserId === inviterProfile.userId) return;
        await tx.memberProfile.upsert({
          where: { userId: inviteeUserId },
          create: {
            userId: inviteeUserId,
            inviterUserId: inviterProfile.userId,
          },
          update: { inviterUserId: inviterProfile.userId },
        });
      };

      const existingNormalBinding = await tx.normalShareBinding.findUnique({
        where: { inviteeUserId },
      });
      const existingVipReferral = await tx.referralLink.findUnique({
        where: { inviteeUserId },
      });
      if (existingVipReferral && existingVipReferral.inviterUserId !== inviterProfile.userId) {
        throw new BadRequestException('已绑定推荐关系，不能更换');
      }

      if (existingNormalBinding) {
        const effectiveNormalInviter =
          existingNormalBinding.effectiveInviterUserId ?? existingNormalBinding.inviterUserId;
        if (effectiveNormalInviter !== inviterProfile.userId) {
          throw new BadRequestException('已绑定普通分享关系，不能更换');
        }

        await ensureMemberInviter();
        return { ...existingNormalBinding, isIdempotent: true };
      }

      if (existingVipReferral) {
        await ensureMemberInviter();
        return { ...existingVipReferral, isIdempotent: true };
      }

      await ensureMemberInviter();
      return tx.normalShareBinding.create({
        data: {
          inviterUserId: inviterProfile.userId,
          inviteeUserId,
          code,
          source: dto.source ?? 'APP',
          relationStatus: 'ACTIVE',
          effectiveInviterUserId: inviterProfile.userId,
          rewardStatus: 'PENDING',
          meta: Prisma.JsonNull,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.grantInviteRegisterGrowth(binding).catch((err: any) => {
      this.logger.warn(
        `普通分享注册奖励触发失败: bindingId=${binding?.id}, inviterUserId=${binding?.inviterUserId}, inviteeUserId=${binding?.inviteeUserId}, error=${err?.message}`,
      );
    });

    return binding;
  }

  private async grantInviteRegisterGrowth(binding: any) {
    if (!binding || binding.rewardStatus !== 'PENDING') return;

    const result = await this.growthEvents.receive({
      userId: binding.inviterUserId,
      behaviorCode: 'NORMAL_INVITE_REGISTER',
      idempotencyKey: `NORMAL_INVITE_REGISTER:${binding.inviterUserId}:${binding.inviteeUserId}`,
      refType: 'NORMAL_SHARE_BINDING',
      refId: binding.id,
      meta: {
        inviteeUserId: binding.inviteeUserId,
        bindingId: binding.id,
        code: binding.code,
      },
    });

    await this.prisma.normalShareBinding.updateMany({
      where: {
        id: binding.id,
        rewardStatus: 'PENDING',
      },
      data: {
        rewardStatus: result.status === 'GRANTED' || result.status === 'DUPLICATE'
          ? 'REGISTER_REWARDED'
          : 'FIRST_ORDER_PENDING',
        ...(result.status === 'GRANTED' || result.status === 'DUPLICATE'
          ? { rewardIssuedAt: new Date() }
          : {}),
      },
    });
  }

  async getStats(userId: string) {
    await this.assertOrdinaryShareUser(this.prisma, userId);

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
    await this.assertOrdinaryShareUser(this.prisma, userId);

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

  private async assertOrdinaryShareUser(
    prisma: PrismaService | Prisma.TransactionClient,
    userId: string,
  ) {
    const member = await prisma.memberProfile.findUnique({
      where: { userId },
      select: { tier: true },
    });
    if (member?.tier === 'VIP') {
      throw new BadRequestException('VIP 用户不使用普通分享码');
    }
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
    return generateNormalShareCode();
  }
}
