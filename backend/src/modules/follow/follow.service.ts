import { Injectable, NotFoundException } from '@nestjs/common';
import { FollowType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FollowService {
  constructor(private prisma: PrismaService) {}

  /** 我的关注列表（批量查询优化） */
  async listFollowing(userId: string, role?: string, sort?: string) {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
    });

    // 按 followedType 筛选
    const filtered = role
      ? follows.filter((f) => f.followedType === role)
      : follows;

    if (filtered.length === 0) return [];

    const authorIds = filtered.map((f) => f.followedId);

    // 批量查询：一次拿到所有关注目标的粉丝数
    const followerCounts = await this.prisma.follow.groupBy({
      by: ['followedId'],
      where: { followedId: { in: authorIds } },
      _count: { id: true },
    });
    const countMap = new Map(followerCounts.map((c) => [c.followedId, c._count.id]));

    // 分离 company 和 user ID，批量查询
    const companyIds = filtered.filter((f) => f.followedType === 'COMPANY').map((f) => f.followedId);
    const userIds = filtered.filter((f) => f.followedType !== 'COMPANY').map((f) => f.followedId);

    const [companies, users] = await Promise.all([
      companyIds.length > 0
        ? this.prisma.company.findMany({
            where: { id: { in: companyIds } },
            include: { profile: true },
          })
        : [],
      userIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            include: { profile: true },
          })
        : [],
    ]);

    const companyMap = new Map(companies.map((c) => [c.id, c]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    // 组装结果
    const items = filtered.map((f) => {
      const followerCount = countMap.get(f.followedId) || 0;
      let author: any;

      if (f.followedType === 'COMPANY') {
        const company = companyMap.get(f.followedId);
        if (!company) return null;
        const address = company.address as any || {};
        const highlights = company.profile?.highlights as any || {};
        author = {
          id: company.id,
          name: company.name,
          avatar: highlights.cover || '',
          type: 'company' as const,
          verified: true,
          title: highlights.mainBusiness || company.description || '',
          companyId: company.id,
          isFollowed: true,
          intimacyLevel: 42,
          followerCount,
          city: address.text || '',
          interestTags: highlights.certifications || [],
        };
      } else {
        const user = userMap.get(f.followedId);
        if (!user) return null;
        const profile = user.profile;
        author = {
          id: user.id,
          name: profile?.nickname || '新用户',
          avatar: profile?.avatarUrl || 'https://placehold.co/200x200/png',
          type: 'user' as const,
          tags: profile?.interests || [],
          isFollowed: true,
          intimacyLevel: 28,
          followerCount,
          city: profile?.city || '',
          interestTags: profile?.interests || [],
        };
      }

      return {
        author,
        followedAt: f.createdAt instanceof Date
          ? f.createdAt.toISOString().slice(0, 16).replace('T', ' ')
          : f.createdAt,
      };
    }).filter(Boolean);

    // 排序
    if (sort === 'active') {
      items.sort((a, b) => (b!.author.followerCount ?? 0) - (a!.author.followerCount ?? 0));
    }

    return items;
  }

  /** 关注/取关切换 */
  async toggleFollow(userId: string, authorId: string) {
    const followedType = await this.resolveAuthorType(authorId);

    const existing = await this.prisma.follow.findUnique({
      where: { followerId_followedId: { followerId: userId, followedId: authorId } },
    });

    if (existing) {
      await this.prisma.follow.delete({ where: { id: existing.id } });
      return { authorId, isFollowed: false };
    }

    await this.prisma.follow.create({
      data: { followerId: userId, followedId: authorId, followedType },
    });

    return { authorId, isFollowed: true };
  }

  /** 作者公开资料 */
  async getAuthorProfile(authorId: string, currentUserId: string) {
    const authorType = await this.resolveAuthorType(authorId);
    return this.buildAuthorProfile(authorId, authorType, currentUserId);
  }

  /** 判断 authorId 是 user 还是 company */
  private async resolveAuthorType(authorId: string): Promise<FollowType> {
    const company = await this.prisma.company.findUnique({ where: { id: authorId } });
    if (company) return FollowType.COMPANY;

    const user = await this.prisma.user.findUnique({ where: { id: authorId } });
    if (user) return FollowType.USER;

    throw new NotFoundException('作者不存在');
  }

  /** 构建 PostAuthor 格式的作者资料 */
  private async buildAuthorProfile(authorId: string, authorType: string, currentUserId: string) {
    const followRecord = await this.prisma.follow.findUnique({
      where: { followerId_followedId: { followerId: currentUserId, followedId: authorId } },
    });
    const isFollowed = !!followRecord;

    const followerCount = await this.prisma.follow.count({
      where: { followedId: authorId },
    });

    if (authorType === 'COMPANY' || authorType === 'company') {
      const company = await this.prisma.company.findUnique({
        where: { id: authorId },
        include: { profile: true },
      });
      if (!company) throw new NotFoundException('企业不存在');

      const address = company.address as any || {};
      const highlights = company.profile?.highlights as any || {};

      return {
        id: company.id,
        name: company.name,
        avatar: highlights.cover || '',
        type: 'company' as const,
        verified: true,
        title: highlights.mainBusiness || company.description || '',
        companyId: company.id,
        isFollowed,
        intimacyLevel: isFollowed ? 42 : 0,
        followerCount,
        city: address.text || '',
        interestTags: highlights.certifications || [],
      };
    }

    // user 类型
    const user = await this.prisma.user.findUnique({
      where: { id: authorId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const profile = user.profile;
    return {
      id: user.id,
      name: profile?.nickname || '新用户',
      avatar: profile?.avatarUrl || 'https://placehold.co/200x200/png',
      type: 'user' as const,
      tags: profile?.interests || [],
      isFollowed,
      intimacyLevel: isFollowed ? 28 : 0,
      followerCount,
      city: profile?.city || '',
      interestTags: profile?.interests || [],
    };
  }
}
