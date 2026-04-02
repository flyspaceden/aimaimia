import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { maskContact, maskPhone } from '../../../common/security/privacy-mask';

@Injectable()
export class AdminAppUsersService {
  constructor(private prisma: PrismaService) {}

  /** App 用户列表（买家） */
  async findAll(
    page = 1,
    pageSize = 20,
    status?: string,
    keyword?: string,
    tier?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (status) where.status = status;

    // 关键词搜索：手机号（AuthIdentity）或昵称（UserProfile）
    if (keyword) {
      where.OR = [
        {
          authIdentities: {
            some: { identifier: { contains: keyword } },
          },
        },
        {
          profile: { nickname: { contains: keyword, mode: 'insensitive' } },
        },
        { id: keyword },
      ];
    }

    // 会员类型筛选
    if (tier) {
      where.memberProfile = { tier };
    }

    // 注册时间范围
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59');
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          profile: {
            select: {
              nickname: true,
              avatarUrl: true,
            },
          },
          authIdentities: {
            where: { provider: 'PHONE' },
            select: { identifier: true },
            take: 1,
          },
          memberProfile: {
            select: { tier: true },
          },
          _count: { select: { orders: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((user) => ({
        id: user.id,
        phone: maskPhone(user.authIdentities[0]?.identifier || null),
        nickname: user.profile?.nickname || null,
        avatarUrl: user.profile?.avatarUrl || null,
        memberTier: user.memberProfile?.tier || 'NORMAL',
        status: user.status,
        orderCount: user._count.orders,
        createdAt: user.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 用户统计概览 */
  async getStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [totalUsers, vipUsers, todayRegistered, bannedUsers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.memberProfile.count({ where: { tier: 'VIP' } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.user.count({ where: { status: 'BANNED' } }),
    ]);

    return { totalUsers, vipUsers, todayRegistered, bannedUsers };
  }

  /** App 用户详情 */
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        authIdentities: {
          select: { provider: true, identifier: true, verified: true },
        },
        memberProfile: {
          select: { tier: true },
        },
        _count: {
          select: { orders: true, addresses: true, followsGiven: true },
        },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const phone =
      user.authIdentities.find(
        (a: { provider: string }) => a.provider === 'PHONE',
      )?.identifier || null;

    return {
      id: user.id,
      phone,
      phoneMasked: maskPhone(phone),
      nickname: user.profile?.nickname || null,
      avatarUrl: user.profile?.avatarUrl || null,
      level: user.profile?.level || '新芽会员',
      growthPoints: user.profile?.growthPoints || 0,
      points: user.profile?.points || 0,
      gender: user.profile?.gender || null,
      birthday: user.profile?.birthday || null,
      city: user.profile?.city || null,
      status: user.status,
      memberTier: user.memberProfile?.tier || 'NORMAL',
      orderCount: user._count.orders,
      addressCount: user._count.addresses,
      followCount: user._count.followsGiven,
      authIdentitiesMasked: user.authIdentities.map((identity) => ({
        provider: identity.provider,
        identifierMasked: maskContact(identity.identifier),
        verified: identity.verified,
      })),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /** 封禁/解封 App 用户 */
  async toggleBan(id: string, status: 'ACTIVE' | 'BANNED') {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');

    return this.prisma.user.update({
      where: { id },
      data: { status },
    });
  }
}
