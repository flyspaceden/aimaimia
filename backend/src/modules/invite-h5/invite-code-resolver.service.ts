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
        select: { userId: true, status: true },
      }),
      this.prisma.memberProfile.findUnique({
        where: { referralCode: code },
        select: { userId: true, tier: true },
      }),
    ]);

    if (normal && vip?.tier === 'VIP') {
      return { status: 'CONFLICT', code };
    }

    if (normal?.status === 'ACTIVE') {
      return {
        status: 'NORMAL_SHARE',
        code,
        inviterUserId: normal.userId,
      };
    }

    if (!normal && vip?.tier === 'VIP') {
      return {
        status: 'VIP_REFERRAL',
        code,
        inviterUserId: vip.userId,
      };
    }

    return { status: 'INVALID', code };
  }
}
