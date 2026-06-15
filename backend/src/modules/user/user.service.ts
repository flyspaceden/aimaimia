import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  /** 获取当前用户资料（映射为前端 UserProfile 格式） */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, authIdentities: true },
    });

    if (!user) throw new NotFoundException('用户不存在');

    // 如果 UserProfile 不存在，自动创建（兼容旧数据）
    let profile = user.profile;
    if (!profile) {
      profile = await this.prisma.userProfile.create({
        data: { userId },
      });
    }

    // 提取手机号和微信绑定状态（账号与安全页用）
    // 手机号存在 AuthIdentity{provider:PHONE, identifier:phone}
    // 微信昵称沿用 UserProfile.nickname（与管理后台 admin-app-users.service.ts:137 行为一致）
    const phoneIdentity = user.authIdentities.find((i) => i.provider === 'PHONE');
    const hasWechat = user.authIdentities.some((i) => i.provider === 'WECHAT');

    return {
      id: user.id,
      buyerNo: user.buyerNo,
      name: profile.nickname || '新用户',
      phone: phoneIdentity?.identifier,
      // wechatBound 是绑定状态判定字段（昵称仅作展示）
      // 避免微信已绑但 fetchWechatUserProfile 失败导致 nickname 空时被误判"未绑定"
      wechatBound: hasWechat,
      wechatNickname: hasWechat ? profile.nickname : undefined,
      // 退换货政策同意状态（前端 checkout.tsx 用于决定是否弹首次下单弹窗）
      // P1 commit 11ed366 漏补此字段，导致 Bug 6 用户退出 checkout 后重进仍弹窗
      hasAgreedReturnPolicy: user.hasAgreedReturnPolicy,
      avatar: profile.avatarUrl || 'preset://sprout',
      gender: profile.gender || 'UNKNOWN',
      birthday: profile.birthday?.toISOString().slice(0, 10) || null,
      level: profile.level,
      levelProgress: profile.levelProgress,
      growthPoints: profile.growthPoints,
      nextLevelPoints: profile.nextLevelPoints,
      points: profile.points,
      location: profile.city || '',
      interests: profile.interests,
      avatarFrame: profile.avatarFrameType
        ? {
            id: `frame-${profile.avatarFrameType}`,
            type: profile.avatarFrameType,
            label: profile.avatarFrameLabel || '',
            expiresAt: profile.avatarFrameExpiresAt?.toISOString(),
          }
        : undefined,
    };
  }

  /** 更新个人资料 */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // 确保 UserProfile 存在
    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const data: any = {};
    if (dto.name !== undefined) data.nickname = dto.name;
    if (dto.location !== undefined) data.city = dto.location;
    if (dto.interests !== undefined) data.interests = dto.interests;
    if (dto.avatar !== undefined) data.avatarUrl = dto.avatar;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.birthday !== undefined) data.birthday = new Date(dto.birthday);
    // 前端可能传 avatarFrame 对象或 avatarFrameId 字符串
    const avatarFrame = (dto as any).avatarFrame;
    let nextFrameType: string | null | undefined = undefined;
    if (avatarFrame !== undefined) {
      if (typeof avatarFrame === 'object' && avatarFrame !== null) {
        nextFrameType = avatarFrame.type || avatarFrame.id;
        data.avatarFrameType = nextFrameType;
        data.avatarFrameLabel = avatarFrame.label || '';
      } else {
        nextFrameType = null;
        data.avatarFrameType = null;
      }
    } else if (dto.avatarFrameId !== undefined) {
      nextFrameType = dto.avatarFrameId;
      data.avatarFrameType = dto.avatarFrameId;
    }

    // 头像框权限校验：VIP 框必须当前账号是 VIP 才能戴
    // 前端虽已 UI 卡权限，但请求 body 可被篡改，必须在服务端再卡一次
    if (nextFrameType === 'vip') {
      const member = await this.prisma.memberProfile.findUnique({
        where: { userId },
        select: { tier: true },
      });
      if (member?.tier !== 'VIP') {
        throw new BadRequestException('VIP 头像框仅 VIP 会员可佩戴');
      }
    }

    await this.prisma.userProfile.update({
      where: { userId },
      data,
    });

    return this.getProfile(userId);
  }

  /**
   * 从微信同步头像到当前用户
   * - 前提：当前用户已绑定微信（有 WECHAT AuthIdentity）
   * - 安全：换出的 openId 必须与当前账号绑定的 openId 一致，防止借他人 code 偷头像
   * - 失败场景：微信未绑定 / openId 不一致 / 微信侧未返回 headimgurl
   */
  async syncWechatAvatar(userId: string, code: string) {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId, provider: 'WECHAT' },
    });
    if (!identity) {
      throw new BadRequestException('当前账号未绑定微信，请先绑定微信后再同步头像');
    }

    const wechatProfile = await this.authService.exchangeCodeForWechatProfile(code);
    if (wechatProfile.openId !== identity.identifier) {
      throw new BadRequestException('微信授权账号与当前绑定不一致');
    }
    if (!wechatProfile.avatarUrl) {
      throw new BadRequestException('微信未返回头像（可能用户拒绝了头像授权）');
    }

    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, avatarUrl: wechatProfile.avatarUrl },
      update: { avatarUrl: wechatProfile.avatarUrl },
    });

    return this.getProfile(userId);
  }
}
