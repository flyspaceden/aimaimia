import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  /** 获取当前用户资料（映射为前端 UserProfile 格式） */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) throw new NotFoundException('用户不存在');

    // 如果 UserProfile 不存在，自动创建（兼容旧数据）
    let profile = user.profile;
    if (!profile) {
      profile = await this.prisma.userProfile.create({
        data: { userId },
      });
    }

    return {
      id: user.id,
      name: profile.nickname || '新用户',
      avatar: profile.avatarUrl || 'https://placehold.co/200x200/png',
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
    if (avatarFrame !== undefined) {
      if (typeof avatarFrame === 'object' && avatarFrame !== null) {
        data.avatarFrameType = avatarFrame.type || avatarFrame.id;
        data.avatarFrameLabel = avatarFrame.label || '';
      } else {
        data.avatarFrameType = null;
      }
    } else if (dto.avatarFrameId !== undefined) {
      data.avatarFrameType = dto.avatarFrameId;
    }

    await this.prisma.userProfile.update({
      where: { userId },
      data,
    });

    return this.getProfile(userId);
  }
}
