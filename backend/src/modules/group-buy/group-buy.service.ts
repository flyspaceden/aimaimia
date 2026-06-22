import { BadRequestException, Injectable } from '@nestjs/common';
import { GroupBuyActivityStatus, GroupBuyInstanceStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GroupBuyService {
  constructor(private readonly prisma: PrismaService) {}

  static assertTierBasisPointsTotal(basisPoints: number[]): void {
    const total = basisPoints.reduce((sum, value) => sum + value, 0);
    if (total !== 10000) {
      throw new BadRequestException('团购返还档位总和必须等于100%');
    }
  }

  async findActiveActivities(now = new Date()) {
    const activities = await this.prisma.groupBuyActivity.findMany({
      where: {
        status: GroupBuyActivityStatus.ACTIVE,
        deletedAt: null,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gt: now } }] },
        ],
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      include: this.activityInclude(),
    });

    return {
      items: activities.map((activity) => this.mapActivityForBuyer(activity)),
    };
  }

  async getCurrentState(userId: string) {
    const instance = await this.prisma.groupBuyInstance.findFirst({
      where: {
        userId,
        status: {
          in: [
            GroupBuyInstanceStatus.QUALIFICATION_PENDING,
            GroupBuyInstanceStatus.SHARING,
            GroupBuyInstanceStatus.TERMINATED,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        activity: {
          include: this.activityInclude(),
        },
        code: {
          select: { code: true, status: true },
        },
        referrals: {
          select: {
            id: true,
            status: true,
            candidateSequence: true,
            effectiveSequence: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!instance) {
      return this.emptyCurrentState();
    }

    const occupyingStatuses = new Set<GroupBuyInstanceStatus>([
      GroupBuyInstanceStatus.QUALIFICATION_PENDING,
      GroupBuyInstanceStatus.SHARING,
    ]);
    const occupiesSlot = occupyingStatuses.has(instance.status);
    const hasPendingTerminatedReferral =
      instance.status === GroupBuyInstanceStatus.TERMINATED
      && instance.candidateCount > instance.validReferralCount;

    if (!occupiesSlot && !hasPendingTerminatedReferral) {
      return this.emptyCurrentState();
    }

    return {
      current: {
        id: instance.id,
        status: instance.status,
        validReferralCount: instance.validReferralCount,
        candidateCount: instance.candidateCount,
        code: instance.code
          ? {
              code: instance.code.code,
              status: instance.code.status,
            }
          : null,
        activity: this.mapActivityForBuyer(instance.activity),
        referrals: instance.referrals.map((referral) => ({
          id: referral.id,
          status: referral.status,
          candidateSequence: referral.candidateSequence,
          effectiveSequence: referral.effectiveSequence,
        })),
      },
      occupiesSlot,
      defaultTab: 'CURRENT',
      canBuyNew: !occupiesSlot,
    };
  }

  private emptyCurrentState() {
    return {
      current: null,
      occupiesSlot: false,
      defaultTab: 'PRODUCTS',
      canBuyNew: true,
    };
  }

  private activityInclude() {
    return {
      product: {
        select: {
          id: true,
          title: true,
          media: {
            select: { id: true, url: true, sortOrder: true },
            orderBy: { sortOrder: 'asc' as const },
          },
        },
      },
      sku: {
        select: {
          id: true,
          title: true,
          stock: true,
          weightGram: true,
        },
      },
      tiers: {
        orderBy: { sequence: 'asc' as const },
      },
    };
  }

  private mapActivityForBuyer(activity: any) {
    return {
      id: activity.id,
      title: activity.title,
      price: activity.price,
      freeShipping: activity.freeShipping,
      shippingSummary: activity.freeShipping ? '本活动商品包邮' : '按商品配置收取运费',
      ruleSummary: activity.ruleSummary ?? null,
      product: {
        id: activity.product.id,
        title: activity.product.title,
        imageUrl: activity.product.media?.[0]?.url ?? null,
      },
      sku: {
        id: activity.sku.id,
        title: activity.sku.title,
        stock: activity.sku.stock,
        weightGram: activity.sku.weightGram,
      },
      tiers: activity.tiers.map((tier: any) => ({
        sequence: tier.sequence,
        label: tier.label ?? `第${tier.sequence}位好友`,
      })),
    };
  }
}
