import { BadRequestException, Injectable } from '@nestjs/common';
import { GroupBuyActivityStatus, GroupBuyCodeStatus, GroupBuyInstanceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

type BuyerGroupBuyActivityItem = {
  productId: string;
  productTitle: string;
  imageUrl: string | null;
  skuId: string;
  skuTitle: string;
  stock: number;
  weightGram: number;
  quantity: number;
  sortOrder: number;
};

@Injectable()
export class GroupBuyService {
  constructor(private readonly prisma: PrismaService) {}

  static assertTierBasisPointsTotal(basisPoints: number[]): void {
    const total = basisPoints.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      throw new BadRequestException('团购返还档位总和必须大于0');
    }
  }

  async findActiveActivities(now = new Date()) {
    const activities = await this.prisma.groupBuyActivity.findMany({
      where: {
        status: GroupBuyActivityStatus.ACTIVE,
        deletedAt: null,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { endAt: { gt: now } },
        ],
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      include: this.activityInclude(),
    });

    return {
      items: activities.map((activity) => this.mapActivityForBuyer(activity)),
    };
  }

  async getCurrentState(userId: string, now = new Date()) {
    const include: Prisma.GroupBuyInstanceInclude = {
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
    };

    const instance = await this.prisma.groupBuyInstance.findFirst({
      where: {
        userId,
        status: {
          in: [
            GroupBuyInstanceStatus.QUALIFICATION_PENDING,
            GroupBuyInstanceStatus.SHARING,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      include,
    }) ?? await this.prisma.groupBuyInstance.findFirst({
      where: {
        userId,
        status: GroupBuyInstanceStatus.TERMINATED,
        candidateCount: { gt: 0 },
      },
      orderBy: { updatedAt: 'desc' },
      include,
    }) ?? await this.prisma.groupBuyInstance.findFirst({
      where: {
        userId,
        status: GroupBuyInstanceStatus.EXPIRED,
      },
      orderBy: { updatedAt: 'desc' },
      include,
    });

    if (!instance) {
      return this.emptyCurrentState();
    }

    const isEndedByActivityWindow = this.hasActivityEnded(instance.activity, now);
    const effectiveStatus = isEndedByActivityWindow
      ? GroupBuyInstanceStatus.EXPIRED
      : instance.status;
    const occupyingStatuses = new Set<GroupBuyInstanceStatus>([
      GroupBuyInstanceStatus.QUALIFICATION_PENDING,
      GroupBuyInstanceStatus.SHARING,
    ]);
    const occupiesSlot = occupyingStatuses.has(effectiveStatus);
    const hasPendingTerminatedReferral =
      effectiveStatus === GroupBuyInstanceStatus.TERMINATED
      && instance.candidateCount > 0;
    const isExpiredInstance = effectiveStatus === GroupBuyInstanceStatus.EXPIRED;

    if (!occupiesSlot && !hasPendingTerminatedReferral && !isExpiredInstance) {
      return this.emptyCurrentState();
    }

    return {
      current: {
        id: instance.id,
        status: effectiveStatus,
        validReferralCount: instance.validReferralCount,
        candidateCount: instance.candidateCount,
        code: instance.code
          ? {
              code: instance.code.code,
              status: isEndedByActivityWindow ? GroupBuyCodeStatus.EXPIRED : instance.code.status,
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

  async getLandingByCode(code: string, now = new Date()) {
    const normalizedCode = code.trim().toUpperCase();
    const groupBuyCode = await this.prisma.groupBuyCode.findUnique({
      where: { code: normalizedCode },
      include: {
        instance: {
          include: {
            activity: {
              include: this.activityInclude(),
            },
            user: {
              select: {
                id: true,
                buyerNo: true,
                profile: {
                  select: { nickname: true },
                },
              },
            },
          },
        },
      },
    });

    if (!groupBuyCode) {
      return this.invalidLanding(normalizedCode, '团购推荐码无效或已结束');
    }

    const instance = groupBuyCode.instance;
    const activity = instance.activity;
    if (
      groupBuyCode.status !== GroupBuyCodeStatus.ACTIVE
      || instance.status !== GroupBuyInstanceStatus.SHARING
    ) {
      return this.invalidLanding(normalizedCode, '团购推荐码已完成或不可用');
    }

    const totalSlots = this.resolveTierSnapshotCount(instance.tierSnapshot);
    if (totalSlots <= 0) {
      return this.invalidLanding(normalizedCode, '团购推荐码配置异常');
    }
    const occupiedReferralCount = await this.prisma.groupBuyReferral.count({
      where: {
        instanceId: instance.id,
        status: { in: ['CANDIDATE', 'VALID'] },
      },
    });
    if (occupiedReferralCount >= totalSlots) {
      return this.invalidLanding(normalizedCode, '团购推荐码名额已满');
    }

    if (!this.isActivityVisibleForBuyer(activity, now)) {
      return this.invalidLanding(normalizedCode, '团购活动未开始或已结束');
    }

    return {
      code: normalizedCode,
      valid: true,
      activity: this.mapActivityForBuyer(activity),
      inviter: {
        userId: instance.user.id,
        nickname: instance.user.profile?.nickname ?? null,
        buyerNo: instance.user.buyerNo ?? null,
      },
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

  private invalidLanding(code: string, reason: string) {
    return {
      code,
      valid: false,
      activity: null,
      inviter: null,
      reason,
    };
  }

  private isActivityVisibleForBuyer(activity: any, now: Date) {
    return activity.status === GroupBuyActivityStatus.ACTIVE
      && !activity.deletedAt
      && (!activity.startAt || activity.startAt <= now)
      && Boolean(activity.endAt)
      && activity.endAt > now;
  }

  private hasActivityEnded(activity: any, now: Date) {
    return activity.status === GroupBuyActivityStatus.ENDED
      || Boolean(activity.deletedAt)
      || !activity.endAt
      || activity.endAt <= now;
  }

  private resolveTierSnapshotCount(raw: unknown) {
    if (!Array.isArray(raw)) return 0;
    const sequences = new Set<number>();
    for (const item of raw) {
      const sequence = Number((item as any)?.sequence);
      if (Number.isInteger(sequence) && sequence > 0) {
        sequences.add(sequence);
      }
    }
    return sequences.size;
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
      items: {
        orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
        include: {
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
        },
      },
      tiers: {
        orderBy: { sequence: 'asc' as const },
      },
    };
  }

  private mapActivityForBuyer(activity: any) {
    const activityItems = this.normalizeActivityItems(activity);
    const availableStock = this.calculateAvailableStock(activityItems);
    const totalWeightGram = activityItems.reduce(
      (sum: number, item: BuyerGroupBuyActivityItem) => sum + item.weightGram * item.quantity,
      0,
    );
    const itemSummary = activityItems
      .map((item: BuyerGroupBuyActivityItem) => `${item.productTitle} x${item.quantity}`)
      .join('、');

    return {
      id: activity.id,
      status: activity.status,
      startAt: activity.startAt ? activity.startAt.toISOString() : null,
      endAt: activity.endAt ? activity.endAt.toISOString() : null,
      title: activity.title,
      description: activity.description ?? null,
      price: activity.price,
      freeShipping: activity.freeShipping,
      shippingSummary: activity.freeShipping ? '本活动商品包邮' : '按商品配置收取运费',
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
      items: activityItems.map((item: BuyerGroupBuyActivityItem) => ({
        productId: item.productId,
        productTitle: item.productTitle,
        imageUrl: item.imageUrl,
        skuId: item.skuId,
        skuTitle: item.skuTitle,
        stock: item.stock,
        weightGram: item.weightGram,
        quantity: item.quantity,
      })),
      itemSummary,
      availableStock,
      totalWeightGram,
      tiers: activity.tiers.map((tier: any) => ({
        sequence: tier.sequence,
        label: tier.label ?? `第${tier.sequence}位好友`,
      })),
    };
  }

  private normalizeActivityItems(activity: any): BuyerGroupBuyActivityItem[] {
    const rawItems = Array.isArray(activity.items) && activity.items.length > 0
      ? activity.items
      : [{
          productId: activity.productId ?? activity.product?.id,
          skuId: activity.skuId ?? activity.sku?.id,
          quantity: 1,
          sortOrder: 0,
          product: activity.product,
          sku: activity.sku,
        }];

    return rawItems
      .map((item: any, index: number) => {
        const product = item.product ?? activity.product;
        const sku = item.sku ?? activity.sku;
        const quantity = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
        return {
          productId: item.productId ?? product?.id,
          productTitle: product?.title ?? '',
          imageUrl: product?.media?.[0]?.url ?? null,
          skuId: item.skuId ?? sku?.id,
          skuTitle: sku?.title ?? '',
          stock: Number(sku?.stock ?? 0),
          weightGram: Number(sku?.weightGram ?? 0),
          quantity,
          sortOrder: item.sortOrder ?? index,
        };
      })
      .sort((a: BuyerGroupBuyActivityItem, b: BuyerGroupBuyActivityItem) => a.sortOrder - b.sortOrder);
  }

  private calculateAvailableStock(items: Array<{ stock: number; quantity: number }>) {
    if (items.length === 0) return 0;
    return Math.max(0, items.reduce((minAvailability, item) => {
      const quantity = Math.max(1, Math.floor(Number(item.quantity)));
      const stock = Math.max(0, Math.floor(Number(item.stock)));
      return Math.min(minAvailability, Math.floor(stock / quantity));
    }, Number.POSITIVE_INFINITY));
  }
}
