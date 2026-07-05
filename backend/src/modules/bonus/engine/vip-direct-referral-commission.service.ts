import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from './bonus-config.service';
import { RewardCalculatorService } from './reward-calculator.service';
import { PLATFORM_USER_ID } from './constants';

export type VipDirectReferralCommissionResult = 'credited' | 'platform' | 'skipped';

type DirectReferralScheme = 'NORMAL_DIRECT_REFERRAL' | 'VIP_DIRECT_REFERRAL';
type DirectRelationSource = 'MEMBER_PROFILE' | 'NORMAL_SHARE_BINDING' | 'NONE';

interface DirectRelationResolution {
  inviterUserId: string | null;
  sourceRelation: DirectRelationSource;
  normalShareBindingId?: string;
  relationStatus?: string;
  platformReason?: string;
}

interface DirectCommissionContext {
  scheme: DirectReferralScheme;
  platformScheme: 'NORMAL_DIRECT_REFERRAL_PLATFORM' | 'VIP_DIRECT_REFERRAL_PLATFORM';
  accountType: 'NORMAL_REWARD' | 'VIP_REWARD';
  ruleType: DirectReferralScheme;
  idempotencyKey: string;
  ratio: number;
  pools: {
    profit: number;
    directReferralPool: number;
    configSnapshot: Record<string, any>;
  };
}

@Injectable()
export class VipDirectReferralCommissionService {
  private readonly logger = new Logger(VipDirectReferralCommissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: BonusConfigService,
    private readonly calculator: RewardCalculatorService,
  ) {}

  async createFrozenForPaidOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<VipDirectReferralCommissionResult> {
    void this.prisma;

    try {
      const order = await (tx as any).order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            select: {
              memberProfile: {
                select: {
                  tier: true,
                  inviterUserId: true,
                },
              },
            },
          },
          items: {
            include: {
              sku: {
                select: {
                  cost: true,
                  product: { select: { cost: true } },
                },
              },
            },
          },
        },
      });

      if (!order || order.bizType !== 'NORMAL_GOODS') {
        return 'skipped';
      }

      const member = order.user?.memberProfile;
      const inviteeTierAtOrder = member?.tier ?? null;
      if (!member) {
        return 'skipped';
      }

      const config = await this.configService.getConfig();
      const calcItems = order.items
        .filter((item: any) => !item.isPrize)
        .map((item: any) => ({
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          cost: item.sku?.cost ?? item.sku?.product?.cost ?? null,
          companyId: item.companyId ?? null,
        }));

      const relation = await this.resolveDirectRelation(
        tx,
        order.userId,
        member.inviterUserId ?? null,
      );
      const inviter = relation.inviterUserId
        ? await (tx as any).user.findUnique({
          where: { id: relation.inviterUserId },
          select: {
            status: true,
            deletionExecutedAt: true,
            memberProfile: { select: { tier: true } },
          },
        })
        : null;

      const platformReason = this.resolvePlatformReason(relation, inviter);
      const inviterTierAtOrder = inviter?.memberProfile?.tier ?? null;
      const fallbackTier = inviteeTierAtOrder === 'VIP' ? 'VIP' : 'NORMAL';
      const commissionTier = inviterTierAtOrder === 'VIP'
        ? 'VIP'
        : inviterTierAtOrder === 'NORMAL'
          ? 'NORMAL'
          : fallbackTier;
      const context = this.buildCommissionContext(
        orderId,
        commissionTier,
        calcItems,
        config,
      );

      if (!context || context.pools.profit <= 0 || context.pools.directReferralPool <= 0) {
        return 'skipped';
      }

      const existing = await (tx as any).rewardAllocation.findUnique({
        where: { idempotencyKey: context.idempotencyKey },
      });
      if (existing) {
        return 'skipped';
      }
      const existingDirectAllocation = await (tx as any).rewardAllocation.findFirst({
        where: {
          orderId,
          triggerType: 'ORDER_PAID',
          ruleType: { in: ['NORMAL_DIRECT_REFERRAL', 'VIP_DIRECT_REFERRAL'] },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingDirectAllocation) {
        return 'skipped';
      }

      if (platformReason) {
        await this.creditToPlatform(
          tx,
          order,
          context,
          relation,
          inviteeTierAtOrder,
          inviterTierAtOrder,
          platformReason,
          config.ruleVersion,
        );
        return 'platform';
      }

      const account = await (tx as any).rewardAccount.upsert({
        where: { userId_type: { userId: relation.inviterUserId, type: context.accountType } },
        update: {},
        create: { userId: relation.inviterUserId, type: context.accountType },
      });

      const allocation = await (tx as any).rewardAllocation.create({
        data: {
          triggerType: 'ORDER_PAID' as any,
          orderId,
          ruleType: context.ruleType as any,
          ruleVersion: config.ruleVersion,
          idempotencyKey: context.idempotencyKey,
          meta: {
            scheme: context.scheme,
            sourceOrderId: orderId,
            sourceUserId: order.userId,
            directInviterUserId: relation.inviterUserId,
            inviterTierAtOrder,
            inviteeTierAtOrder,
            profit: context.pools.profit,
            ratio: context.ratio,
            directReferralPool: context.pools.directReferralPool,
            sourceRelation: relation.sourceRelation,
            normalShareBindingId: relation.normalShareBindingId,
            relationStatus: relation.relationStatus,
            configSnapshot: context.pools.configSnapshot,
            routedToPlatform: false,
            releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
          },
        },
      });

      await (tx as any).rewardLedger.create({
        data: {
          allocationId: allocation.id,
          accountId: account.id,
          userId: relation.inviterUserId,
          entryType: 'FREEZE',
          amount: context.pools.directReferralPool,
          status: 'FROZEN',
          refType: 'ORDER',
          refId: orderId,
          meta: {
            scheme: context.scheme,
            accountType: context.accountType,
            sourceOrderId: orderId,
            sourceUserId: order.userId,
            directInviterUserId: relation.inviterUserId,
            inviterTierAtOrder,
            inviteeTierAtOrder,
            profit: context.pools.profit,
            ratio: context.ratio,
            directReferralPool: context.pools.directReferralPool,
            sourceRelation: relation.sourceRelation,
            normalShareBindingId: relation.normalShareBindingId,
            relationStatus: relation.relationStatus,
            configSnapshot: context.pools.configSnapshot,
            releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
          },
        },
      });

      await (tx as any).rewardAccount.update({
        where: { id: account.id },
        data: { frozen: { increment: context.pools.directReferralPool } },
      });

      return 'credited';
    } catch (err: any) {
      if (this.isUniqueConstraintError(err)) {
        this.logger.warn(`VIP直推佣金幂等键已存在，跳过：orderId=${orderId}`);
        return 'skipped';
      }
      throw err;
    }
  }

  private async creditToPlatform(
    tx: Prisma.TransactionClient,
    order: any,
    context: DirectCommissionContext,
    relation: DirectRelationResolution,
    inviteeTierAtOrder: string | null,
    inviterTierAtOrder: string | null,
    platformReason: string,
    ruleVersion: string,
  ) {
    const account = await (tx as any).rewardAccount.upsert({
      where: { userId_type: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' } },
      update: {},
      create: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
    });

    const allocation = await (tx as any).rewardAllocation.create({
      data: {
        triggerType: 'ORDER_PAID' as any,
        orderId: order.id,
        ruleType: context.ruleType as any,
        ruleVersion,
        idempotencyKey: context.idempotencyKey,
        meta: {
          scheme: context.scheme,
          sourceOrderId: order.id,
          sourceUserId: order.userId,
          directInviterUserId: relation.inviterUserId,
          inviterTierAtOrder,
          inviteeTierAtOrder,
          profit: context.pools.profit,
          ratio: context.ratio,
          directReferralPool: context.pools.directReferralPool,
          sourceRelation: relation.sourceRelation,
          normalShareBindingId: relation.normalShareBindingId,
          relationStatus: relation.relationStatus,
          configSnapshot: context.pools.configSnapshot,
          routedToPlatform: true,
          platformReason,
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        },
      },
    });

    await (tx as any).rewardLedger.create({
      data: {
        allocationId: allocation.id,
        accountId: account.id,
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount: context.pools.directReferralPool,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: order.id,
        meta: {
          scheme: context.platformScheme,
          originalScheme: context.scheme,
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          platformReason,
          sourceOrderId: order.id,
          sourceUserId: order.userId,
          directInviterUserId: relation.inviterUserId,
          inviterTierAtOrder,
          inviteeTierAtOrder,
          profit: context.pools.profit,
          ratio: context.ratio,
          directReferralPool: context.pools.directReferralPool,
          sourceRelation: relation.sourceRelation,
          normalShareBindingId: relation.normalShareBindingId,
          relationStatus: relation.relationStatus,
          configSnapshot: context.pools.configSnapshot,
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        },
      },
    });

    await (tx as any).rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: context.pools.directReferralPool } },
    });
  }

  private async resolveDirectRelation(
    tx: Prisma.TransactionClient,
    inviteeUserId: string,
    memberProfileInviterUserId: string | null,
  ): Promise<DirectRelationResolution> {
    if (memberProfileInviterUserId) {
      return {
        inviterUserId: memberProfileInviterUserId,
        sourceRelation: 'MEMBER_PROFILE',
      };
    }

    const binding = await (tx as any).normalShareBinding.findUnique({
      where: { inviteeUserId },
      select: {
        id: true,
        relationStatus: true,
        effectiveInviterUserId: true,
      },
    });

    if (!binding) {
      return {
        inviterUserId: null,
        sourceRelation: 'NONE',
        platformReason: 'NO_DIRECT_INVITER',
      };
    }

    if (binding.relationStatus !== 'ACTIVE') {
      return {
        inviterUserId: null,
        sourceRelation: 'NORMAL_SHARE_BINDING',
        normalShareBindingId: binding.id,
        relationStatus: binding.relationStatus,
        platformReason: 'DIRECT_RELATION_NOT_ACTIVE',
      };
    }

    if (!binding.effectiveInviterUserId) {
      return {
        inviterUserId: null,
        sourceRelation: 'NORMAL_SHARE_BINDING',
        normalShareBindingId: binding.id,
        relationStatus: binding.relationStatus,
        platformReason: 'DIRECT_RELATION_NO_EFFECTIVE_INVITER',
      };
    }

    return {
      inviterUserId: binding.effectiveInviterUserId,
      sourceRelation: 'NORMAL_SHARE_BINDING',
      normalShareBindingId: binding.id,
      relationStatus: binding.relationStatus,
    };
  }

  private resolvePlatformReason(
    relation: DirectRelationResolution,
    inviter: any,
  ): string | null {
    if (relation.platformReason) {
      return relation.platformReason;
    }
    if (!relation.inviterUserId) {
      return 'NO_DIRECT_INVITER';
    }
    if (!inviter) {
      return 'DIRECT_INVITER_NOT_FOUND';
    }
    if (inviter.status !== UserStatus.ACTIVE || inviter.deletionExecutedAt) {
      return 'DIRECT_INVITER_INACTIVE';
    }
    if (!inviter.memberProfile?.tier) {
      return 'DIRECT_INVITER_PROFILE_MISSING';
    }
    return null;
  }

  private buildCommissionContext(
    orderId: string,
    inviterTier: 'NORMAL' | 'VIP',
    calcItems: any[],
    config: any,
  ): DirectCommissionContext | null {
    if (inviterTier === 'VIP') {
      if (config.vipDirectReferralPercent <= 0) {
        return null;
      }
      const pools = this.calculator.calculateVip(calcItems, config);
      return {
        scheme: 'VIP_DIRECT_REFERRAL',
        platformScheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
        accountType: 'VIP_REWARD',
        ruleType: 'VIP_DIRECT_REFERRAL',
        idempotencyKey: `ALLOC:ORDER_PAID:${orderId}:VIP_DIRECT_REFERRAL`,
        ratio: config.vipDirectReferralPercent,
        pools,
      };
    }

    if (config.normalDirectReferralPercent <= 0) {
      return null;
    }
    const pools = this.calculator.calculateNormal(calcItems, config);
    return {
      scheme: 'NORMAL_DIRECT_REFERRAL',
      platformScheme: 'NORMAL_DIRECT_REFERRAL_PLATFORM',
      accountType: 'NORMAL_REWARD',
      ruleType: 'NORMAL_DIRECT_REFERRAL',
      idempotencyKey: `ALLOC:ORDER_PAID:${orderId}:NORMAL_DIRECT_REFERRAL`,
      ratio: config.normalDirectReferralPercent,
      pools,
    };
  }

  private isUniqueConstraintError(err: any): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code === 'P2002'
      : err?.code === 'P2002';
  }
}
