import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
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
  private static readonly DOWNLOAD_PASS_TTL_MS = 10 * 60 * 1000;
  /**
   * 自动恢复窗口故意短于凭证总有效期：降低同一 Wi-Fi、同型号手机先后扫码时
   * 错误跳过注册的概率。超过该窗口仍可使用剪贴板中的高熵一次性凭证。
   */
  private static readonly DOWNLOAD_AUTO_RESUME_TTL_MS = 2 * 60 * 1000;

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

  /**
   * 为当前已完成 H5 登录的会话签发下载交接凭证。
   * 这里只用 updateMany 的条件作为授权判断，避免“先读再写”之间被替换会话归属。
   */
  async createDownloadPass(userId: string, landingSessionId: string, ticket: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDownloadPassTransfer(tx);
      return this.createDownloadPassLocked(tx, userId, landingSessionId, ticket);
    });
  }

  private async createDownloadPassLocked(
    tx: Prisma.TransactionClient,
    userId: string,
    landingSessionId: string,
    ticket: string,
  ) {
    const ticketHash = this.hashDownloadPass(ticket);
    const now = new Date();
    const expiresAt = new Date(Date.now() + InviteH5Service.DOWNLOAD_PASS_TTL_MS);

    const current = await tx.inviteH5LandingEvent.findUnique({
      where: { landingSessionId },
      select: {
        authedUserId: true,
        downloadPassHash: true,
        downloadPassExpiresAt: true,
        downloadPassUsedAt: true,
      },
    });

    if (!current || current.authedUserId !== userId) {
      throw new ForbiddenException('当前登录会话不能申请下载凭证');
    }

    if (current.downloadPassHash === ticketHash) {
      const existingExpiresAt = current.downloadPassExpiresAt;
      // 已消费或过期的旧凭证不能被复活；前端应生成新的随机值再请求一次。
      if (current.downloadPassUsedAt || !existingExpiresAt || existingExpiresAt <= now) {
        return { status: 'RENEW_REQUIRED' as const };
      }

      // 同一票据可重试，但有效期固定从首次登记时起算，不能被反复续期。
      // 条件更新仍是并发裁决点：若刚好被系统浏览器消费，会得到 0 并走后续状态确认。
      const reused = await tx.inviteH5LandingEvent.updateMany({
        where: {
          landingSessionId,
          authedUserId: userId,
          downloadPassHash: ticketHash,
          downloadPassExpiresAt: { gt: now },
          downloadPassUsedAt: null,
        },
        data: {
          downloadPassExpiresAt: existingExpiresAt,
        },
      });
      if (reused.count === 1) {
        return { status: 'READY' as const, expiresAt: existingExpiresAt.toISOString() };
      }

      const settled = await tx.inviteH5LandingEvent.findUnique({
        where: { landingSessionId },
        select: {
          authedUserId: true,
          downloadPassHash: true,
          downloadPassExpiresAt: true,
          downloadPassUsedAt: true,
        },
      });
      if (!settled || settled.authedUserId !== userId) {
        throw new ForbiddenException('当前登录会话不能申请下载凭证');
      }
      if (
        settled.downloadPassHash === ticketHash &&
        !settled.downloadPassUsedAt &&
        settled.downloadPassExpiresAt &&
        settled.downloadPassExpiresAt > now
      ) {
        return { status: 'READY' as const, expiresAt: settled.downloadPassExpiresAt.toISOString() };
      }
      if (
        settled.downloadPassHash === ticketHash &&
        (settled.downloadPassUsedAt || !settled.downloadPassExpiresAt || settled.downloadPassExpiresAt <= now)
      ) {
        return { status: 'RENEW_REQUIRED' as const };
      }
      throw new ConflictException('下载已在另一个窗口准备，请返回原页面继续');
    }

    // 只有没有有效凭证的会话才允许写入新票据。这个条件更新是并发裁决点：
    // 双击/多标签页不同票据只能有一个成功，后写请求不能覆盖先写请求。
    const issued = await tx.inviteH5LandingEvent.updateMany({
      where: {
        landingSessionId,
        authedUserId: userId,
        OR: [
          { downloadPassHash: null },
          { downloadPassExpiresAt: { lte: now } },
          { downloadPassUsedAt: { not: null } },
        ],
      },
      data: {
        downloadPassHash: ticketHash,
        downloadPassExpiresAt: expiresAt,
        downloadPassUsedAt: null,
      },
    });

    if (issued.count === 1) {
      return { status: 'READY' as const, expiresAt: expiresAt.toISOString() };
    }

    // 若另一个同票据重试刚好先完成，当前请求也可安全复用它；不同有效票据则拒绝。
    const settled = await tx.inviteH5LandingEvent.findUnique({
      where: { landingSessionId },
      select: {
        authedUserId: true,
        downloadPassHash: true,
        downloadPassExpiresAt: true,
        downloadPassUsedAt: true,
      },
    });
    if (!settled || settled.authedUserId !== userId) {
      throw new ForbiddenException('当前登录会话不能申请下载凭证');
    }
    if (
      settled.downloadPassHash === ticketHash &&
      !settled.downloadPassUsedAt &&
      settled.downloadPassExpiresAt &&
      settled.downloadPassExpiresAt > now
    ) {
      return { status: 'READY' as const, expiresAt: settled.downloadPassExpiresAt.toISOString() };
    }
    if (
      settled.downloadPassHash === ticketHash &&
      (settled.downloadPassUsedAt || !settled.downloadPassExpiresAt || settled.downloadPassExpiresAt <= now)
    ) {
      return { status: 'RENEW_REQUIRED' as const };
    }
    throw new ConflictException('下载已在另一个窗口准备，请返回原页面继续');
  }

  /**
   * 原子消费一次性下载凭证。无论凭证不存在、过期还是已消费，都只返回不可用，
   * 避免让公开接口泄露 H5 会话或用户信息。
   */
  async consumeDownloadPass(ticket: string): Promise<{ valid: boolean }> {
    const now = new Date();
    const result = await this.prisma.inviteH5LandingEvent.updateMany({
      where: {
        downloadPassHash: this.hashDownloadPass(ticket),
        downloadPassExpiresAt: { gt: now },
        downloadPassUsedAt: null,
        authedUserId: { not: null },
      },
      data: { downloadPassUsedAt: now },
    });
    return { valid: result.count === 1 };
  }

  /**
   * 部分安卓微信会让系统浏览器重新打开原始二维码 URL，完全丢弃当前 query/hash。
   * 此处以短时、同邀请码、同出口 IP、同屏幕上下文、同安卓设备型号做恢复：
   * - 只接受来源为微信、目标为非微信安卓浏览器；
   * - 只有一个候选时才原子消费；
   * - 0 个或多个候选都拒绝猜测，由前端改走剪贴板高熵凭证。
   *
   * 返回值不暴露用户、会话、推荐关系或失败原因。
   */
  async resumeDownloadPass(
    dto: InviteH5LandingDto,
    ipAddress: string,
  ): Promise<{ valid: boolean }> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - InviteH5Service.DOWNLOAD_AUTO_RESUME_TTL_MS);
    const screenInfo = this.screenInfo(dto);
    const targetUserAgent = dto.userAgent ?? '';
    const targetDevice = this.androidDeviceSignature(targetUserAgent);

    if (
      !screenInfo ||
      !targetDevice ||
      this.isWechatUserAgent(targetUserAgent) ||
      dto.devicePixelRatio === undefined ||
      dto.colorDepth === undefined ||
      dto.timezoneOffset === undefined ||
      dto.maxTouchPoints === undefined
    ) {
      return { valid: false };
    }

    const inviteCode = dto.inviteCode.trim().toUpperCase();
    const targetLanguage = this.normalizeLanguage(dto.language);
    if (!targetLanguage) return { valid: false };

    return this.prisma.$transaction(async (tx) => {
      await this.lockDownloadPassTransfer(tx);
      const candidates = await tx.inviteH5LandingEvent.findMany({
        where: {
          inviteCode,
          ipAddress,
          screenInfo,
          authedUserId: { not: null },
          downloadPassHash: { not: null },
          downloadPassExpiresAt: { gt: now },
          downloadPassUsedAt: null,
          updatedAt: { gt: cutoff },
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          userAgent: true,
          language: true,
          downloadPassHash: true,
        },
      });

      const matches = candidates.filter((candidate) => {
        if (!this.isWechatUserAgent(candidate.userAgent)) return false;
        if (this.androidDeviceSignature(candidate.userAgent) !== targetDevice) return false;
        const sourceLanguage = this.normalizeLanguage(candidate.language);
        return Boolean(sourceLanguage && sourceLanguage === targetLanguage);
      });

      if (matches.length !== 1) {
        if (matches.length > 1) {
          this.logger.warn(
            `H5 下载自动恢复出现多候选，已拒绝猜测: code=${inviteCode}, count=${matches.length}`,
          );
        }
        return { valid: false };
      }

      const candidate = matches[0];
      if (!candidate.downloadPassHash) return { valid: false };

      // CAS 是最终并发裁决点：即使两个请求同时读到唯一候选，也只有一个能消费。
      const consumed = await tx.inviteH5LandingEvent.updateMany({
        where: {
          id: candidate.id,
          downloadPassHash: candidate.downloadPassHash,
          downloadPassExpiresAt: { gt: now },
          downloadPassUsedAt: null,
          authedUserId: { not: null },
          updatedAt: { gt: cutoff },
        },
        data: { downloadPassUsedAt: now },
      });

      return { valid: consumed.count === 1 };
    });
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
    const shortSide = Math.min(dto.screenWidth, dto.screenHeight);
    const longSide = Math.max(dto.screenWidth, dto.screenHeight);
    const basic = `${shortSide}x${longSide}`;
    const hasExtendedContext =
      dto.devicePixelRatio !== undefined &&
      dto.colorDepth !== undefined &&
      dto.timezoneOffset !== undefined &&
      dto.maxTouchPoints !== undefined;
    if (!hasExtendedContext) return basic;

    const dpr = Number(dto.devicePixelRatio!.toFixed(2));
    return `${basic}|dpr=${dpr}|depth=${dto.colorDepth}|tz=${dto.timezoneOffset}|touch=${dto.maxTouchPoints}`;
  }

  private isWechatUserAgent(userAgent: string): boolean {
    return /MicroMessenger/i.test(userAgent);
  }

  /**
   * 仅抽取跨 WebView/厂商浏览器仍稳定的安卓版本和设备型号，不把浏览器版本
   * 当作设备身份。无法可靠抽取时返回 null，禁止自动恢复。
   */
  private androidDeviceSignature(userAgent: string): string | null {
    const androidVersion = userAgent.match(/\bAndroid\s+([\d.]+)/i)?.[1];
    const parenthetical = userAgent.match(/\(([^)]+)\)/)?.[1];
    if (!androidVersion || !parenthetical) return null;

    const buildPart = parenthetical
      .split(';')
      .map((part) => part.trim())
      .find((part) => /\bBuild\//i.test(part));
    if (!buildPart) return null;
    const model = buildPart.replace(/\s+Build\/.*$/i, '').trim();

    const normalizedModel = model
      .replace(/\bwv\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedModel || normalizedModel.length > 100) return null;

    return `android:${androidVersion.split('.')[0]}:${normalizedModel}`;
  }

  private normalizeLanguage(language?: string | null): string | null {
    const normalized = language?.trim().toLowerCase().split(/[-_]/)[0] ?? '';
    return normalized || null;
  }

  /**
   * 下载凭证签发与“唯一候选”恢复共用事务级 advisory lock，消除候选读取后又有
   * 新凭证签发的幻读窗口。当前流量很低，使用单一锁可优先保证裁决正确性。
   */
  private async lockDownloadPassTransfer(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock($1, $2)',
      0x41494d4d,
      0x4835444c,
    );
  }

  private newLandingSessionId(): string {
    return `ih5_${randomBytes(12).toString('hex')}`;
  }

  private hashDownloadPass(ticket: string): string {
    return createHash('sha256').update(ticket).digest('hex');
  }
}
