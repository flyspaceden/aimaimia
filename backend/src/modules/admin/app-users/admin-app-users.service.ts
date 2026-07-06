import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { maskContact, maskPhone } from '../../../common/security/privacy-mask';
import { normalizeBuyerNo, resolveBuyerUserId } from '../../../common/utils/buyer-no.util';
import { DigitalAssetService } from '../../digital-asset/digital-asset.service';

const APP_LINK_BASE_URL = 'https://app.ai-maimai.com';

@Injectable()
export class AdminAppUsersService {
  constructor(
    private prisma: PrismaService,
    private digitalAssetService: DigitalAssetService,
  ) {}

  /** App 用户列表（买家） */
  async findAll(
    page = 1,
    pageSize = 20,
    status?: string,
    keyword?: string,
    tier?: string,
    startDate?: string,
    endDate?: string,
    sortField?: string,
    sortOrder?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    const orderBy = this.buildUserOrderBy(sortField, sortOrder);
    if (status) where.status = status;

    // 关键词搜索：手机号（AuthIdentity）或昵称（UserProfile）
    if (keyword) {
      const normalizedKeyword = normalizeBuyerNo(keyword);
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
        { buyerNo: normalizedKeyword },
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
        orderBy,
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
            select: { tier: true, referralCode: true },
          },
          normalShareProfile: {
            select: { code: true, status: true },
          },
          _count: { select: { orders: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((user) => ({
        id: user.id,
        buyerNo: user.buyerNo,
        phone: maskPhone(user.authIdentities[0]?.identifier || null),
        nickname: user.profile?.nickname || null,
        avatarUrl: user.profile?.avatarUrl || null,
        memberTier: user.memberProfile?.tier || 'NORMAL',
        normalShareCode: user.memberProfile?.tier === 'VIP' ? null : user.normalShareProfile?.code ?? null,
        normalShareStatus: user.memberProfile?.tier === 'VIP' ? null : user.normalShareProfile?.status ?? null,
        vipReferralCode: user.memberProfile?.tier === 'VIP' ? user.memberProfile?.referralCode ?? null : null,
        status: user.status,
        orderCount: user._count.orders,
        createdAt: user.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  private buildUserOrderBy(sortField?: string, sortOrder?: string) {
    const direction = sortOrder === 'asc' || sortOrder === 'ascend' ? 'asc' : 'desc';
    if (sortField === 'memberTier') {
      return [
        { memberProfile: { tier: direction } },
        { createdAt: 'desc' },
        { id: 'asc' },
      ] as any;
    }
    if (sortField === 'status') {
      return [
        { status: direction },
        { createdAt: 'desc' },
        { id: 'asc' },
      ] as any;
    }
    if (sortField === 'orderCount') {
      return [
        { orders: { _count: direction } },
        { createdAt: 'desc' },
        { id: 'asc' },
      ] as any;
    }
    return [
      { createdAt: direction },
      { id: 'asc' },
    ] as any;
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
    const resolvedId = await resolveBuyerUserId(this.prisma, id);
    const userSummarySelect = this.userSummarySelect();
    const user = await this.prisma.user.findUnique({
      where: { id: resolvedId },
      include: {
        profile: true,
        authIdentities: {
          select: { provider: true, identifier: true, verified: true },
        },
        memberProfile: {
          select: { tier: true, referralCode: true, inviterUserId: true, vipPurchasedAt: true },
        },
        normalShareProfile: {
          select: {
            id: true,
            userId: true,
            code: true,
            status: true,
            disabledReason: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        normalShareBindingReceived: {
          include: {
            inviter: { select: userSummarySelect },
            firstOrder: {
              select: {
                id: true,
                totalAmount: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
        normalShareBindingsMade: {
          include: {
            invitee: { select: userSummarySelect },
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
          take: 50,
        },
        referralReceived: {
          include: {
            inviter: { select: userSummarySelect },
          },
        },
        _count: {
          select: { orders: true, addresses: true, followsGiven: true },
        },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const directVipInvitees = await this.prisma.memberProfile.findMany({
      where: {
        inviterUserId: user.id,
        tier: 'VIP',
      },
      select: {
        userId: true,
        tier: true,
        referralCode: true,
        vipPurchasedAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: userSummarySelect },
      },
      orderBy: [
        { vipPurchasedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      take: 50,
    });

    const extraUserMap = await this.loadRecommendationUserMap(user);
    const phone =
      user.authIdentities.find(
        (a: { provider: string }) => a.provider === 'PHONE',
      )?.identifier || null;

    return {
      id: user.id,
      buyerNo: user.buyerNo,
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
      recommendation: this.buildRecommendation(user, directVipInvitees, extraUserMap),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private userSummarySelect() {
    return {
      id: true,
      buyerNo: true,
      profile: { select: { nickname: true, avatarUrl: true } },
      authIdentities: {
        where: { provider: AuthProvider.PHONE },
        select: { identifier: true },
        take: 1,
      },
      memberProfile: { select: { tier: true } },
    } as const;
  }

  private async loadRecommendationUserMap(user: any) {
    const ids = new Set<string>();
    if (user.memberProfile?.inviterUserId) ids.add(user.memberProfile.inviterUserId);
    if (user.normalShareBindingReceived?.effectiveInviterUserId) {
      ids.add(user.normalShareBindingReceived.effectiveInviterUserId);
    }

    const embeddedIds = new Set<string>();
    for (const embedded of [
      user.normalShareBindingReceived?.inviter,
      user.referralReceived?.inviter,
    ]) {
      if (embedded?.id) embeddedIds.add(embedded.id);
    }

    for (const id of embeddedIds) ids.delete(id);
    if (ids.size === 0) return new Map<string, any>();

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(ids) } },
      select: this.userSummarySelect(),
    });
    return new Map(users.map((item: any) => [item.id, this.mapUserSummary(item)]));
  }

  private buildRecommendation(user: any, directVipInvitees: any[], extraUserMap: Map<string, any>) {
    const visibleCode = this.buildVisibleRecommendationCode(user);
    const currentInviterId = user.memberProfile?.inviterUserId ?? null;
    const currentInviter = currentInviterId
      ? this.findEmbeddedUserSummary(user, currentInviterId) ?? extraUserMap.get(currentInviterId) ?? null
      : null;

    const normalBindingReceived = this.mapNormalShareBinding(
      user.normalShareBindingReceived,
      extraUserMap,
    );

    return {
      visibleCode,
      normalShareProfile: user.normalShareProfile
        ? {
            id: user.normalShareProfile.id,
            userId: user.normalShareProfile.userId,
            code: user.normalShareProfile.code,
            status: user.normalShareProfile.status,
            disabledReason: user.normalShareProfile.disabledReason ?? null,
            shareUrl: `${APP_LINK_BASE_URL}/s/${user.normalShareProfile.code}`,
            createdAt: user.normalShareProfile.createdAt,
            updatedAt: user.normalShareProfile.updatedAt,
          }
        : null,
      vipReferralCode: user.memberProfile?.tier === 'VIP'
        ? user.memberProfile?.referralCode ?? null
        : null,
      currentInviter,
      normalBindingReceived,
      vipReferralReceived: this.mapReferralLink(user.referralReceived, 'received'),
      directNormalInvitees: (user.normalShareBindingsMade ?? []).map((binding: any) =>
        this.mapNormalShareBinding(binding, extraUserMap),
      ),
      directVipInvitees: directVipInvitees.map((profile: any) => ({
        userId: profile.userId,
        tier: profile.tier,
        referralCode: profile.referralCode ?? null,
        vipPurchasedAt: profile.vipPurchasedAt ?? null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        user: this.mapUserSummary(profile.user),
      })),
      counts: {
        directNormalInvitees: (user.normalShareBindingsMade ?? []).length,
        activeNormalInvitees: (user.normalShareBindingsMade ?? []).filter(
          (binding: any) => !binding.relationStatus || binding.relationStatus === 'ACTIVE',
        ).length,
        directVipInvitees: directVipInvitees.length,
      },
    };
  }

  private buildVisibleRecommendationCode(user: any) {
    if (user.memberProfile?.tier === 'VIP' && user.memberProfile?.referralCode) {
      return {
        type: 'VIP_REFERRAL',
        code: user.memberProfile.referralCode,
        status: 'ACTIVE',
        url: `${APP_LINK_BASE_URL}/r/${user.memberProfile.referralCode}`,
      };
    }
    if (user.normalShareProfile?.code) {
      return {
        type: 'NORMAL_SHARE',
        code: user.normalShareProfile.code,
        status: user.normalShareProfile.status,
        url: `${APP_LINK_BASE_URL}/s/${user.normalShareProfile.code}`,
      };
    }
    return null;
  }

  private findEmbeddedUserSummary(user: any, userId: string) {
    for (const embedded of [
      user.normalShareBindingReceived?.inviter,
      user.referralReceived?.inviter,
    ]) {
      if (embedded?.id === userId) return this.mapUserSummary(embedded);
    }
    return null;
  }

  private mapUserSummary(user: any) {
    if (!user) return null;
    return {
      id: user.id,
      buyerNo: user.buyerNo ?? null,
      nickname: user.profile?.nickname ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      phoneMasked: maskPhone(user.authIdentities?.[0]?.identifier ?? null),
      memberTier: user.memberProfile?.tier ?? null,
    };
  }

  private mapNormalShareBinding(binding: any, extraUserMap: Map<string, any>) {
    if (!binding) return null;
    return {
      id: binding.id,
      inviterUserId: binding.inviterUserId,
      inviteeUserId: binding.inviteeUserId,
      code: binding.code,
      source: binding.source,
      relationStatus: binding.relationStatus ?? null,
      relationInvalidAt: binding.relationInvalidAt ?? null,
      relationInvalidReason: binding.relationInvalidReason ?? null,
      effectiveInviterUserId: binding.effectiveInviterUserId ?? null,
      boundAt: binding.boundAt,
      firstOrderId: binding.firstOrderId ?? null,
      rewardStatus: binding.rewardStatus,
      rewardIssuedAt: binding.rewardIssuedAt ?? null,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
      inviter: this.mapUserSummary(binding.inviter),
      invitee: this.mapUserSummary(binding.invitee),
      effectiveInviter: binding.effectiveInviterUserId
        ? extraUserMap.get(binding.effectiveInviterUserId)
          ?? (binding.inviterUserId === binding.effectiveInviterUserId
            ? this.mapUserSummary(binding.inviter)
            : null)
        : null,
      firstOrder: binding.firstOrder
        ? {
            id: binding.firstOrder.id,
            orderNo: binding.firstOrder.id,
            totalAmount: binding.firstOrder.totalAmount,
            status: binding.firstOrder.status,
            createdAt: binding.firstOrder.createdAt,
          }
        : null,
    };
  }

  private mapReferralLink(link: any, direction: 'received' | 'made') {
    if (!link) return null;
    return {
      id: link.id,
      inviterUserId: link.inviterUserId,
      inviteeUserId: link.inviteeUserId,
      codeUsed: link.codeUsed,
      channel: link.channel ?? null,
      createdAt: link.createdAt,
      inviter: this.mapUserSummary(link.inviter),
      invitee: this.mapUserSummary(link.invitee),
      direction,
    };
  }

  /** 封禁/解封 App 用户 */
  async toggleBan(id: string, status: 'ACTIVE' | 'BANNED') {
    const resolvedId = await resolveBuyerUserId(this.prisma, id);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: resolvedId } });
      if (!user) throw new NotFoundException('用户不存在');

      if (status === 'BANNED') {
        await this.digitalAssetService.clearAccountAssets(tx, {
          userId: resolvedId,
          reason: 'SERIOUS_BAN',
          idempotencyKey: `digital-asset-clear:${resolvedId}:serious-ban`,
        });
      }

      return tx.user.update({
        where: { id: resolvedId },
        data: { status },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
}
