import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from './bonus-config.service';
import { RewardCalculatorService } from './reward-calculator.service';
import { PLATFORM_USER_ID } from './constants';

export type VipDirectReferralCommissionResult = 'credited' | 'platform' | 'skipped';

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

    const idempotencyKey = `ALLOC:ORDER_PAID:${orderId}:VIP_DIRECT_REFERRAL`;

    try {
      const existing = await (tx as any).rewardAllocation.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return 'skipped';
      }

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
      if (!member || member.tier !== 'VIP') {
        return 'skipped';
      }

      const config = await this.configService.getConfig();
      if (config.vipDirectReferralPercent <= 0) {
        return 'skipped';
      }

      const calcItems = order.items
        .filter((item: any) => !item.isPrize)
        .map((item: any) => ({
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          cost: item.sku?.cost ?? item.sku?.product?.cost ?? null,
          companyId: item.companyId ?? null,
        }));

      const pools = this.calculator.calculateVip(calcItems, config);
      if (pools.profit <= 0 || pools.directReferralPool <= 0) {
        return 'skipped';
      }

      const inviterUserId = member.inviterUserId ?? null;
      let platformReason: string | null = null;
      if (!inviterUserId) {
        platformReason = 'NO_DIRECT_INVITER';
      } else {
        const inviter = await (tx as any).user.findUnique({
          where: { id: inviterUserId },
          select: { status: true, deletionExecutedAt: true },
        });
        if (!inviter) {
          platformReason = 'DIRECT_INVITER_NOT_FOUND';
        } else if (inviter.status !== UserStatus.ACTIVE || inviter.deletionExecutedAt) {
          platformReason = 'DIRECT_INVITER_INACTIVE';
        }
      }

      if (platformReason) {
        await this.creditToPlatform(
          tx,
          order,
          idempotencyKey,
          inviterUserId,
          platformReason,
          pools,
          config.ruleVersion,
          config.vipDirectReferralPercent,
        );
        return 'platform';
      }

      const account = await (tx as any).rewardAccount.upsert({
        where: { userId_type: { userId: inviterUserId, type: 'VIP_REWARD' } },
        update: {},
        create: { userId: inviterUserId, type: 'VIP_REWARD' },
      });

      const allocation = await (tx as any).rewardAllocation.create({
        data: {
          triggerType: 'ORDER_PAID' as any,
          orderId,
          ruleType: 'VIP_DIRECT_REFERRAL' as any,
          ruleVersion: config.ruleVersion,
          idempotencyKey,
          meta: {
            scheme: 'VIP_DIRECT_REFERRAL',
            sourceOrderId: orderId,
            sourceUserId: order.userId,
            directInviterUserId: inviterUserId,
            profit: pools.profit,
            ratio: config.vipDirectReferralPercent,
            directReferralPool: pools.directReferralPool,
            configSnapshot: pools.configSnapshot,
            routedToPlatform: false,
            releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
          },
        },
      });

      await (tx as any).rewardLedger.create({
        data: {
          allocationId: allocation.id,
          accountId: account.id,
          userId: inviterUserId,
          entryType: 'FREEZE',
          amount: pools.directReferralPool,
          status: 'FROZEN',
          refType: 'ORDER',
          refId: orderId,
          meta: {
            scheme: 'VIP_DIRECT_REFERRAL',
            accountType: 'VIP_REWARD',
            sourceOrderId: orderId,
            sourceUserId: order.userId,
            directInviterUserId: inviterUserId,
            profit: pools.profit,
            ratio: config.vipDirectReferralPercent,
            directReferralPool: pools.directReferralPool,
            configSnapshot: pools.configSnapshot,
            releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
          },
        },
      });

      await (tx as any).rewardAccount.update({
        where: { id: account.id },
        data: { frozen: { increment: pools.directReferralPool } },
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
    idempotencyKey: string,
    inviterUserId: string | null,
    platformReason: string,
    pools: {
      profit: number;
      directReferralPool: number;
      configSnapshot: Record<string, any>;
    },
    ruleVersion: string,
    ratio: number,
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
        ruleType: 'VIP_DIRECT_REFERRAL' as any,
        ruleVersion,
        idempotencyKey,
        meta: {
          scheme: 'VIP_DIRECT_REFERRAL',
          sourceOrderId: order.id,
          sourceUserId: order.userId,
          directInviterUserId: inviterUserId,
          profit: pools.profit,
          ratio,
          directReferralPool: pools.directReferralPool,
          configSnapshot: pools.configSnapshot,
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
        amount: pools.directReferralPool,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: order.id,
        meta: {
          scheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
          originalScheme: 'VIP_DIRECT_REFERRAL',
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          platformReason,
          sourceOrderId: order.id,
          sourceUserId: order.userId,
          directInviterUserId: inviterUserId,
          profit: pools.profit,
          ratio,
          directReferralPool: pools.directReferralPool,
          configSnapshot: pools.configSnapshot,
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        },
      },
    });

    await (tx as any).rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: pools.directReferralPool } },
    });
  }

  private isUniqueConstraintError(err: any): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code === 'P2002'
      : err?.code === 'P2002';
  }
}
