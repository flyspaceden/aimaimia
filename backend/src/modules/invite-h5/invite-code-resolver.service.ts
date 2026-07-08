import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InviteCodeResolveResult } from './invite-h5.types';

@Injectable()
export class InviteCodeResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(rawCode: string): Promise<InviteCodeResolveResult> {
    const code = rawCode.trim().toUpperCase();

    const [normal, vip] = await Promise.all([
      this.prisma.normalShareProfile.findUnique({
        where: { code },
        select: {
          userId: true,
          status: true,
          user: {
            select: {
              status: true,
              deletionExecutedAt: true,
              memberProfile: { select: { tier: true } },
            },
          },
        },
      }),
      this.prisma.memberProfile.findUnique({
        where: { referralCode: code },
        select: {
          userId: true,
          tier: true,
          user: {
            select: {
              status: true,
              deletionExecutedAt: true,
            },
          },
        },
      }),
    ]);

    const normalBindable = Boolean(
      normal &&
      normal.status === 'ACTIVE' &&
      normal.user.status === 'ACTIVE' &&
      !normal.user.deletionExecutedAt &&
      normal.user.memberProfile?.tier !== 'VIP',
    );
    const vipBindable = Boolean(
      vip &&
      vip.tier === 'VIP' &&
      vip.user.status === 'ACTIVE' &&
      !vip.user.deletionExecutedAt,
    );

    if (normalBindable && vipBindable) {
      return { status: 'CONFLICT', code };
    }

    if (normalBindable && normal) {
      return {
        status: 'NORMAL_SHARE',
        code,
        inviterUserId: normal.userId,
      };
    }

    if (vipBindable && vip) {
      return {
        status: 'VIP_REFERRAL',
        code,
        inviterUserId: vip.userId,
      };
    }

    return { status: 'INVALID', code };
  }
}
