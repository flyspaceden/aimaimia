import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WechatMiniProgramApiError,
  WechatMiniProgramApiService,
} from '../wechat-mini-program-platform/wechat-mini-program-api.service';
import { MINI_PROGRAM_CODE_KINDS } from './dto/mini-program-code.dto';

type MiniProgramCodeKind = typeof MINI_PROGRAM_CODE_KINDS[number];
type SceneTarget = { payload: Record<string, string>; targetPath: string };

const SCENE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;
const SCENE_PAGE = 'packages/community/scene/index';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const JPEG_SIGNATURE = Buffer.from([255, 216, 255]);
const JPEG_EOI = Buffer.from([255, 217]);

@Injectable()
export class MiniProgramCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly wechat: WechatMiniProgramApiService,
  ) {}

  async createCode(userId: string, kind: MiniProgramCodeKind) {
    if (!this.wechat.isAvailable()) {
      throw new ServiceUnavailableException('微信小程序码服务未配置');
    }
    const target = await this.resolveOwnedTarget(userId, kind);
    if (!this.isAllowedTargetPath(target.targetPath)) {
      throw new BadRequestException('当前分享码格式不受小程序支持，请联系客服处理');
    }
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ kind, payload: target.payload, targetPath: target.targetPath }))
      .digest('hex');
    const now = new Date();
    const reusableAfter = new Date(now.getTime() + 24 * 60 * 60_000);
    let scene = await (this.prisma as any).miniProgramScene.findFirst({
      where: { ownerUserId: userId, kind, payloadHash, expiresAt: { gt: reusableAfter } },
      orderBy: { createdAt: 'desc' },
    });
    if (!scene) {
      scene = await (this.prisma as any).miniProgramScene.create({
        data: {
          token: randomBytes(16).toString('base64url'),
          ownerUserId: userId,
          kind,
          payload: target.payload,
          payloadHash,
          targetPath: target.targetPath,
          expiresAt: new Date(now.getTime() + this.sceneTtlMs()),
        },
      });
    }

    let image: Buffer;
    try {
      image = await this.wechat.postBuffer('/wxa/getwxacodeunlimit', {
        scene: scene.token,
        page: SCENE_PAGE,
        check_path: this.codeCheckPath(),
        env_version: this.codeEnvVersion(),
        width: 430,
        auto_color: false,
        line_color: { r: 46, g: 125, b: 50 },
        is_hyaline: false,
      });
    } catch (error) {
      if (error instanceof WechatMiniProgramApiError) {
        throw new ServiceUnavailableException('微信小程序码生成暂不可用，请稍后重试');
      }
      throw error;
    }
    const isPng = image.length >= PNG_SIGNATURE.length + PNG_IEND.length
      && image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      && image.subarray(-PNG_IEND.length).equals(PNG_IEND);
    const isJpeg = image.length >= JPEG_SIGNATURE.length + JPEG_EOI.length
      && image.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
      && image.subarray(-JPEG_EOI.length).equals(JPEG_EOI);
    if (!isPng && !isJpeg) {
      throw new ServiceUnavailableException('微信小程序码响应异常');
    }
    await (this.prisma as any).miniProgramScene.update({
      where: { id: scene.id },
      data: { generatedCount: { increment: 1 }, lastGeneratedAt: new Date() },
    });
    return {
      scene: scene.token,
      kind,
      mimeType: isPng ? 'image/png' : 'image/jpeg',
      imageBase64: image.toString('base64'),
      expiresAt: scene.expiresAt,
    };
  }

  async resolveScene(rawToken: string) {
    const token = rawToken?.trim() || '';
    if (!SCENE_TOKEN_PATTERN.test(token)) throw new NotFoundException('小程序码无效或已过期');
    const scene = await (this.prisma as any).miniProgramScene.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
      select: { kind: true, targetPath: true, expiresAt: true },
    });
    if (!scene || !this.isAllowedTargetPath(scene.targetPath)) {
      throw new NotFoundException('小程序码无效或已过期');
    }
    return { kind: scene.kind, path: scene.targetPath, expiresAt: scene.expiresAt };
  }

  private async resolveOwnedTarget(userId: string, kind: MiniProgramCodeKind): Promise<SceneTarget> {
    if (kind === 'REFERRAL') {
      const member = await this.prisma.memberProfile.findUnique({
        where: { userId },
        select: { tier: true, referralCode: true },
      });
      if (member?.tier === 'VIP') {
        if (!member.referralCode) throw new BadRequestException('VIP 推荐码尚未生成');
        return {
          payload: { code: member.referralCode, inviteKind: 'vip' },
          targetPath: `/packages/referral/landing/index?code=${encodeURIComponent(member.referralCode)}&kind=vip`,
        };
      }
      const profile = await this.prisma.normalShareProfile.findUnique({
        where: { userId },
        select: { code: true, status: true },
      });
      if (!profile || profile.status !== 'ACTIVE') {
        throw new BadRequestException('请先进入推荐中心生成普通分享码');
      }
      return {
        payload: { code: profile.code, inviteKind: 'normal' },
        targetPath: `/packages/referral/landing/index?code=${encodeURIComponent(profile.code)}&kind=normal`,
      };
    }
    if (kind === 'CAPTAIN') {
      const profile = await (this.prisma as any).captainProfile.findFirst({
        where: { userId, status: 'ACTIVE' },
        select: { captainCode: true },
      });
      if (!profile?.captainCode) throw new BadRequestException('当前账号尚未开通团长');
      return {
        payload: { code: profile.captainCode },
        targetPath: `/packages/community/captain-landing/index?code=${encodeURIComponent(profile.captainCode)}`,
      };
    }
    const instance = await this.prisma.groupBuyInstance.findFirst({
      where: { userId, status: 'SHARING' },
      orderBy: { updatedAt: 'desc' },
      include: { code: { select: { code: true, status: true } }, activity: { select: { id: true, status: true, endAt: true, deletedAt: true } } },
    });
    if (!instance?.code || instance.code.status !== 'ACTIVE' || instance.activity.status !== 'ACTIVE'
      || instance.activity.deletedAt || !instance.activity.endAt || instance.activity.endAt <= new Date()) {
      throw new BadRequestException('当前没有可分享的团购推荐码');
    }
    return {
      payload: { code: instance.code.code, activityId: instance.activity.id },
      targetPath: `/packages/group-buy/activity-detail/index?activityId=${encodeURIComponent(instance.activity.id)}&shareCode=${encodeURIComponent(instance.code.code)}`,
    };
  }

  private isAllowedTargetPath(path: string) {
    return [
      /^\/packages\/referral\/landing\/index\?code=[A-Z0-9]{8}&kind=(normal|vip)$/,
      /^\/packages\/community\/captain-landing\/index\?code=[A-Z0-9]{3,40}$/,
      /^\/packages\/group-buy\/activity-detail\/index\?activityId=[A-Za-z0-9%_-]{1,128}&shareCode=[A-Z2-9]{10}$/,
    ].some((pattern) => pattern.test(path));
  }

  private sceneTtlMs() {
    const days = Number(this.config.get<string>('WECHAT_MINIAPP_CODE_SCENE_TTL_DAYS', '365'));
    return Math.min(Math.max(Number.isFinite(days) ? days : 365, 1), 3650) * 24 * 60 * 60_000;
  }

  private codeCheckPath() {
    return this.config.get<string>('WECHAT_MINIAPP_CODE_CHECK_PATH', 'true') !== 'false';
  }

  private codeEnvVersion(): 'release' | 'trial' | 'develop' {
    const value = this.config.get<string>('WECHAT_MINIAPP_CODE_ENV_VERSION', 'release');
    return value === 'trial' || value === 'develop' ? value : 'release';
  }
}
