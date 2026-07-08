import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusService } from '../bonus/bonus.service';
import { NormalShareService } from '../normal-share/normal-share.service';
import { InviteH5LandingDto } from './dto/landing-event.dto';
import { InviteCodeResolverService } from './invite-code-resolver.service';
import {
  InviteBindingResult,
  InviteBindingStatus,
  InviteBindingType,
  InviteCodeResolveResult,
  InviteCodeType,
} from './invite-h5.types';

type BindAfterAuthInput = {
  userId: string;
  inviteCode: string;
  landingSessionId?: string;
};

@Injectable()
export class InviteH5Service {
  private readonly logger = new Logger(InviteH5Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: InviteCodeResolverService,
    private readonly normalShare: NormalShareService,
    private readonly bonus: BonusService,
  ) {}

  async recordLanding(dto: InviteH5LandingDto, ipAddress: string) {
    const resolved = await this.resolver.resolve(dto.inviteCode);
    const landingSessionId = this.newLandingSessionId();

    const created = await this.prisma.inviteH5LandingEvent.create({
      data: {
        inviteCode: resolved.code,
        inviteType: resolved.status,
        inviterUserId: this.inviterUserIdOf(resolved),
        landingSessionId,
        ipAddress,
        userAgent: dto.userAgent ?? '',
        screenInfo: this.screenInfo(dto),
        language: dto.language ?? null,
      },
      select: { landingSessionId: true },
    });

    return {
      landingSessionId: created.landingSessionId,
      codeStatus: resolved.status,
    };
  }

  async bindAfterAuth(input: BindAfterAuthInput): Promise<InviteBindingResult> {
    const inviteCode = await this.inviteCodeForBinding(input);
    const resolved = await this.resolver.resolve(inviteCode);

    if (resolved.status === 'INVALID' || resolved.status === 'CONFLICT') {
      return this.finishBinding(input, {
        status: 'INVALID_CODE',
        type: null,
        message: '推荐码无效，未绑定推荐关系',
      }, resolved.status);
    }

    const type: InviteCodeType = resolved.status;

    if (resolved.inviterUserId === input.userId) {
      return this.finishBinding(input, {
        status: 'SELF_INVITE',
        type,
        message: '不能绑定自己的推荐码',
      }, 'SELF_INVITE');
    }

    const existingInviterUserId = await this.findExistingInviterUserId(input.userId);
    if (existingInviterUserId) {
      const same = existingInviterUserId === resolved.inviterUserId;
      return this.finishBinding(input, {
        status: same ? 'ALREADY_BOUND_SAME' : 'ALREADY_BOUND_OTHER',
        type,
        message: same ? '推荐关系已记录' : '已绑定推荐关系，无法覆盖',
      }, same ? null : 'ALREADY_BOUND_OTHER');
    }

    try {
      if (resolved.status === 'NORMAL_SHARE') {
        await this.normalShare.bind(input.userId, {
          code: resolved.code,
          source: 'LANDING',
        });
      } else {
        await this.bonus.useReferralCode(input.userId, resolved.code);
      }

      return this.finishBinding(input, {
        status: 'BOUND',
        type,
        message: '推荐关系已记录',
      }, null);
    } catch (err) {
      const mapped = this.mapBindingError(err, type);
      if (mapped.status === 'ERROR') {
        this.logger.warn(
          `H5 推荐关系绑定失败: userId=${input.userId}, code=${resolved.code}, error=${this.errorMessage(err)}`,
        );
      }
      return this.finishBinding(input, mapped, mapped.status);
    }
  }

  async getStatsForInviter(inviterUserId: string) {
    const [openCount, authedUsers, boundUsers] = await Promise.all([
      this.prisma.inviteH5LandingEvent.count({
        where: { inviterUserId },
      }),
      this.prisma.inviteH5LandingEvent.findMany({
        where: { inviterUserId, authedUserId: { not: null } },
        distinct: ['authedUserId'],
        select: { authedUserId: true },
      }),
      this.prisma.inviteH5LandingEvent.findMany({
        where: {
          inviterUserId,
          authedUserId: { not: null },
          bindingStatus: { in: ['BOUND', 'ALREADY_BOUND_SAME'] },
        },
        distinct: ['authedUserId'],
        select: { authedUserId: true },
      }),
    ]);

    return {
      openCount,
      authedCount: authedUsers.length,
      boundCount: boundUsers.length,
    };
  }

  private async inviteCodeForBinding(input: BindAfterAuthInput): Promise<string> {
    if (!input.landingSessionId) return input.inviteCode;
    const landing = await this.prisma.inviteH5LandingEvent.findUnique({
      where: { landingSessionId: input.landingSessionId },
      select: { inviteCode: true },
    });
    return landing?.inviteCode ?? input.inviteCode;
  }

  private async findExistingInviterUserId(userId: string): Promise<string | null> {
    const [vipReferral, normalBinding, member] = await Promise.all([
      this.prisma.referralLink.findUnique({
        where: { inviteeUserId: userId },
        select: { inviterUserId: true },
      }),
      this.prisma.normalShareBinding.findUnique({
        where: { inviteeUserId: userId },
        select: {
          inviterUserId: true,
          effectiveInviterUserId: true,
          relationStatus: true,
        },
      }),
      this.prisma.memberProfile.findUnique({
        where: { userId },
        select: { inviterUserId: true },
      }),
    ]);

    if (vipReferral?.inviterUserId) return vipReferral.inviterUserId;
    if (normalBinding?.relationStatus === 'ACTIVE') {
      return normalBinding.effectiveInviterUserId ?? normalBinding.inviterUserId;
    }
    return member?.inviterUserId ?? null;
  }

  private async finishBinding(
    input: BindAfterAuthInput,
    result: InviteBindingResult,
    errorCode: string | null,
  ): Promise<InviteBindingResult> {
    if (input.landingSessionId) {
      const now = new Date();
      await this.prisma.inviteH5LandingEvent.updateMany({
        where: { landingSessionId: input.landingSessionId },
        data: {
          authedUserId: input.userId,
          authedAt: now,
          bindingStatus: result.status,
          bindingType: result.type,
          errorCode,
          boundAt: this.isBoundStatus(result.status) ? now : undefined,
        },
      });
    }
    return result;
  }

  private mapBindingError(err: unknown, type: InviteCodeType): InviteBindingResult {
    const message = this.errorMessage(err);
    const normalized = message.toLowerCase();

    if (message.includes('已绑定') || message.includes('不能更换')) {
      return {
        status: 'ALREADY_BOUND_OTHER',
        type,
        message: '已绑定推荐关系，无法覆盖',
      };
    }
    if (message.includes('自己的')) {
      return {
        status: 'SELF_INVITE',
        type,
        message: '不能绑定自己的推荐码',
      };
    }
    if (
      message.includes('VIP 用户不使用普通分享码') ||
      message.includes('已加入 VIP 团队')
    ) {
      return {
        status: 'NOT_ELIGIBLE',
        type,
        message: '当前账号不适用这个推荐码',
      };
    }
    if (
      message.includes('无效') ||
      message.includes('停用') ||
      message.includes('不可用') ||
      normalized.includes('invalid')
    ) {
      return {
        status: 'INVALID_CODE',
        type: null,
        message: '推荐码无效，未绑定推荐关系',
      };
    }

    return {
      status: 'ERROR',
      type,
      message: '推荐关系暂未记录，请稍后重试',
    };
  }

  private errorMessage(err: unknown): string {
    if (!err || typeof err !== 'object') return String(err ?? '');
    const response = (err as { response?: unknown }).response;
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object') {
      const message = (response as { message?: unknown }).message;
      if (Array.isArray(message)) return message.join('；');
      if (typeof message === 'string') return message;
    }
    return (err as { message?: string }).message ?? '';
  }

  private inviterUserIdOf(resolved: InviteCodeResolveResult): string | null {
    return 'inviterUserId' in resolved ? resolved.inviterUserId : null;
  }

  private bindingTypeOf(resolved: InviteCodeResolveResult): InviteBindingType {
    return resolved.status === 'NORMAL_SHARE' || resolved.status === 'VIP_REFERRAL'
      ? resolved.status
      : null;
  }

  private isBoundStatus(status: InviteBindingStatus): boolean {
    return status === 'BOUND' || status === 'ALREADY_BOUND_SAME';
  }

  private screenInfo(dto: InviteH5LandingDto): string | null {
    if (!dto.screenWidth || !dto.screenHeight) return null;
    return `${dto.screenWidth}x${dto.screenHeight}`;
  }

  private newLandingSessionId(): string {
    return `ih5_${randomBytes(12).toString('hex')}`;
  }
}
