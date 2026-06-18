import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { calculateCreditAsset, validateCreditTiers } from './digital-asset-credit-calculator';
import {
  DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS,
  normalizeDigitalAssetModuleSettings,
} from './digital-asset-module-settings';
import {
  allocateOrderAssetAmount,
  calculateOrderAssetAmount,
  calculateRefundProductAmount,
  clampReversalAmount,
  roundMoney,
} from './digital-asset-ledger-calculator';
import { CreditAssetTier, DigitalAssetSourceType, DigitalAssetSubjectType } from './digital-asset-v2.types';
import { resolveVipBackfillPackage } from './digital-asset-vip-package.utils';

type LedgerDirection = 'CREDIT' | 'DEBIT';
type ReceiveSource = 'ORDER_RECEIVED' | 'BACKFILL';
type AdminAdjustSubjectType = DigitalAssetSubjectType;

const SERIALIZABLE_MAX_RETRIES = 3;
const DIGITAL_ASSET_CREDIT_TIERS_KEY = 'DIGITAL_ASSET_CREDIT_TIERS';
const DIGITAL_ASSET_SETTINGS_KEY = 'DIGITAL_ASSET_MODULE_SETTINGS';
const DEFAULT_CREDIT_TIERS: CreditAssetTier[] = [
  { minAmount: 0, maxAmount: 500, multiplier: 3 },
  { minAmount: 500, maxAmount: 5000, multiplier: 5 },
  { minAmount: 5000, maxAmount: null, multiplier: 10 },
];
const ACTIVATION_PROMPT = {
  title: '让每一次消费，都成为你的数字资产基础',
  description: '成为 VIP 后，累计消费可按规则转化为信用资产。',
  actionLabel: '开通 VIP 激活资产',
};

function roundAsset(value: number): number {
  return Math.round(Number.isFinite(value) ? Number(value) : 0);
}

function normalizeLedgerSource(type: string): DigitalAssetSourceType {
  return type as DigitalAssetSourceType;
}

function filterLegacySourceType(sourceType?: string): string | undefined {
  return sourceType === 'ORDER_RECEIVED' ? 'ORDER_RECEIVED' : sourceType;
}

@Injectable()
export class DigitalAssetService {
  private readonly logger = new Logger(DigitalAssetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async creditOrderReceived(orderId: string, source: ReceiveSource): Promise<void> {
    await this.recordOrderReceived(orderId, source);
  }

  async recordOrderReceived(orderId: string, source: ReceiveSource): Promise<void> {
    await this.withSerializableRetry(async (tx) => {
      const cumulativeIdempotencyKey = `order:${orderId}:spend-credit`;
      const legacyCumulativeIdempotencyKey = `order:${orderId}:cumulative-spend-credit`;
      const creditIdempotencyKey = `order:${orderId}:credit-asset`;

      const [existingCumulative, existingLegacyCumulative, existingCredit] = await Promise.all([
        tx.digitalAssetLedger.findUnique({ where: { idempotencyKey: cumulativeIdempotencyKey } }),
        tx.digitalAssetLedger.findUnique({ where: { idempotencyKey: legacyCumulativeIdempotencyKey } }),
        tx.digitalAssetLedger.findUnique({ where: { idempotencyKey: creditIdempotencyKey } }),
      ]);
      if (existingCumulative || existingLegacyCumulative || existingCredit) return;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('订单不存在');

      const hasReceivedFact = Boolean((order as any).receivedAt) || order.status === 'RECEIVED';
      if (!hasReceivedFact) {
        if (source === 'BACKFILL') {
          this.logger.warn(`跳过无收货事实订单数字资产回填: orderId=${orderId}`);
          return;
        }
        throw new BadRequestException('订单尚未确认收货，不能累计数字资产');
      }

      if ((order as any).bizType === 'VIP_PACKAGE') return;

      const cumulativeSpendAmount = calculateOrderAssetAmount(order as any);
      if (cumulativeSpendAmount <= 0) return;

      const member = tx.memberProfile?.findUnique
        ? await tx.memberProfile.findUnique({ where: { userId: order.userId } })
        : null;
      const isVip = member?.tier === 'VIP';
      const account = await this.findOrCreateAccount(tx, order.userId);
      const spendAllocations = allocateOrderAssetAmount({
        orderAssetAmount: cumulativeSpendAmount,
        items: (order.items ?? []).map((item: any) => ({
          orderItemId: item.id,
          skuId: item.skuId ?? null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          isPrize: Boolean(item.isPrize),
          createdAt: item.createdAt,
        })),
      });

      const nextCumulativeSpendAmount = existingCumulative || existingLegacyCumulative
        ? roundMoney(account.cumulativeSpendAmount)
        : roundMoney(account.cumulativeSpendAmount + cumulativeSpendAmount);
      let nextCreditAssetBalance = account.creditAssetBalance ?? 0;

      if (!existingCumulative && !existingLegacyCumulative) {
        await tx.digitalAssetLedger.create({
          data: {
            accountId: account.id,
            userId: order.userId,
            type: source === 'BACKFILL' ? 'BACKFILL' : 'CONSUMPTION_CONFIRMED',
            subjectType: 'CUMULATIVE_SPEND',
            direction: 'CREDIT',
            amount: cumulativeSpendAmount,
            balanceAfter: nextCumulativeSpendAmount,
            cumulativeSpendAfter: nextCumulativeSpendAmount,
            seedAssetBalanceAfter: account.seedAssetBalance ?? 0,
            creditAssetBalanceAfter: account.creditAssetBalance ?? 0,
            orderId,
            idempotencyKey: cumulativeIdempotencyKey,
            meta: {
              itemAllocations: spendAllocations.allocations,
              residualOrderItemId: spendAllocations.residualOrderItemId,
              source,
              legacyIdempotencyKey: legacyCumulativeIdempotencyKey,
            },
          },
        });
      }

      if (isVip && !existingCredit) {
        const tiers = await this.getCreditTiers(tx);
        const creditResult = calculateCreditAsset({
          previousCumulativeSpend: account.cumulativeSpendAmount ?? 0,
          addedSpend: cumulativeSpendAmount,
          tiers,
        });

        if (creditResult.assetAmount > 0) {
          nextCreditAssetBalance = (account.creditAssetBalance ?? 0) + creditResult.assetAmount;
          const creditAllocations = this.allocateFromExistingAllocations(
            spendAllocations.allocations,
            creditResult.assetAmount,
          );
          await tx.digitalAssetLedger.create({
            data: {
              accountId: account.id,
              userId: order.userId,
              type: source === 'BACKFILL' ? 'BACKFILL' : 'CONSUMPTION_CONFIRMED',
              subjectType: 'CREDIT_ASSET',
              direction: 'CREDIT',
              amount: creditResult.assetAmount,
              assetAmount: creditResult.assetAmount,
              balanceAfter: nextCreditAssetBalance,
              cumulativeSpendAfter: nextCumulativeSpendAmount,
              seedAssetBalanceAfter: account.seedAssetBalance ?? 0,
              creditAssetBalanceAfter: nextCreditAssetBalance,
              orderId,
              idempotencyKey: creditIdempotencyKey,
              ruleSnapshot: {
                tiers,
                segments: creditResult.segments,
                rawAssetAmount: creditResult.rawAssetAmount,
              },
              meta: {
                itemAllocations: creditAllocations.allocations,
                spendItemAllocations: spendAllocations.allocations,
                residualOrderItemId: creditAllocations.residualOrderItemId,
                source,
              },
            },
          });
        }
      }

      if (!existingCumulative && !existingLegacyCumulative || nextCreditAssetBalance !== (account.creditAssetBalance ?? 0)) {
        await tx.digitalAssetAccount.update({
          where: { id: account.id },
          data: {
            cumulativeSpendAmount: nextCumulativeSpendAmount,
            creditAssetBalance: nextCreditAssetBalance,
          },
        });
      }
    });
  }

  async reverseRefund(refundId: string): Promise<void> {
    await this.withSerializableRetry(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        include: { items: true },
      });
      if (!refund) throw new NotFoundException('退款单不存在');

      const afterSale = refund.afterSaleId
        ? await tx.afterSaleRequest.findUnique({
          where: { id: refund.afterSaleId },
          include: { shippingPayment: true },
        })
        : await tx.afterSaleRequest.findFirst({
          where: { refundId },
          include: { shippingPayment: true },
        });
      const afterSaleId = refund.afterSaleId ?? afterSale?.id ?? null;

      await this.writeRefundReversal(tx, {
        subjectType: 'CUMULATIVE_SPEND',
        idempotencyKey: `refund:${refundId}:digital-asset-reversal:cumulative`,
        legacyFallbackIdempotencyKey: afterSaleId ? `after-sale:${afterSaleId}:cumulative-spend-reversal` : null,
        refund,
        refundId,
        afterSale,
        afterSaleId,
      });
      await this.writeRefundReversal(tx, {
        subjectType: 'CREDIT_ASSET',
        idempotencyKey: `refund:${refundId}:digital-asset-reversal:credit`,
        legacyFallbackIdempotencyKey: afterSaleId ? `after-sale:${afterSaleId}:credit-asset-reversal` : null,
        refund,
        refundId,
        afterSale,
        afterSaleId,
      });
    });
  }

  async reverseAfterSale(afterSaleId: string): Promise<void> {
    const afterSale: any = await this.withSerializableRetry((tx) =>
      tx.afterSaleRequest.findUnique({
        where: { id: afterSaleId },
        include: { shippingPayment: true },
      }),
    );
    if (!afterSale) throw new NotFoundException('售后单不存在');
    if (afterSale.refundId) {
      await this.reverseRefund(afterSale.refundId);
      return;
    }

    await this.withSerializableRetry(async (tx) => {
      const currentAfterSale = await tx.afterSaleRequest.findUnique({
        where: { id: afterSaleId },
        include: { shippingPayment: true },
      });
      if (!currentAfterSale) throw new NotFoundException('售后单不存在');

      await this.writeRefundReversal(tx, {
        subjectType: 'CUMULATIVE_SPEND',
        idempotencyKey: `after-sale:${afterSaleId}:cumulative-spend-reversal`,
        legacyFallbackIdempotencyKey: `after-sale:${afterSaleId}:cumulative-spend-reversal`,
        refund: null,
        refundId: null,
        afterSale: currentAfterSale,
        afterSaleId,
      });
      await this.writeRefundReversal(tx, {
        subjectType: 'CREDIT_ASSET',
        idempotencyKey: `after-sale:${afterSaleId}:credit-asset-reversal`,
        legacyFallbackIdempotencyKey: `after-sale:${afterSaleId}:credit-asset-reversal`,
        refund: null,
        refundId: null,
        afterSale: currentAfterSale,
        afterSaleId,
      });
    });
  }

  async grantVipActivationAssets(tx: Prisma.TransactionClient | any, params: {
    userId: string;
    vipPurchaseId: string;
    packageId: string | null;
    vipAmount: number;
    inviterUserId: string | null;
  }): Promise<void> {
    const vipPackage = await this.resolveVipPackageRule(tx, {
      packageId: params.packageId,
      vipAmount: params.vipAmount,
    });
    if (!vipPackage) {
      throw new BadRequestException('VIP 档位不存在，无法发放数字资产');
    }
    const selfSeedAssetAmount = vipPackage.selfSeedAssetAmount ?? 0;
    const referralSeedAssetAmount = vipPackage.referralSeedAssetAmount ?? 0;

    const account = await this.findOrCreateAccount(tx, params.userId);
    const selfSeedKey = `vip-purchase:${params.vipPurchaseId}:self-seed`;
    const historicalCreditKey = `user:${params.userId}:historical-consumption-credit-grant`;
    const referralSeedKey = `vip-purchase:${params.vipPurchaseId}:referral-seed`;

    const existingSelfSeedLedger = await tx.digitalAssetLedger.findUnique({
      where: { idempotencyKey: selfSeedKey },
    });
    if (!existingSelfSeedLedger && selfSeedAssetAmount > 0) {
      const nextSeedAssetBalance = (account.seedAssetBalance ?? 0) + selfSeedAssetAmount;
      const created = await tx.digitalAssetLedger.create({
        data: {
          accountId: account.id,
          userId: params.userId,
          type: 'SELF_VIP_PURCHASE',
          subjectType: 'SEED_ASSET',
          direction: 'CREDIT',
          amount: selfSeedAssetAmount,
          assetAmount: selfSeedAssetAmount,
          balanceAfter: nextSeedAssetBalance,
          cumulativeSpendAfter: account.cumulativeSpendAmount ?? 0,
          seedAssetBalanceAfter: nextSeedAssetBalance,
          creditAssetBalanceAfter: account.creditAssetBalance ?? 0,
          vipPurchaseId: params.vipPurchaseId,
          idempotencyKey: selfSeedKey,
          meta: {
            packageId: vipPackage.id,
            vipAmount: params.vipAmount,
          },
        },
      });
      await tx.digitalAssetAccount.update({
        where: { id: account.id },
        data: { seedAssetBalance: nextSeedAssetBalance },
      });
      account.seedAssetBalance = nextSeedAssetBalance;
    }

    const existingHistoricalLedger = await tx.digitalAssetLedger.findUnique({
      where: { idempotencyKey: historicalCreditKey },
    });
    if (existingHistoricalLedger && !account.historicalCreditGrantedAt) {
      const grantedAt = existingHistoricalLedger.createdAt ?? new Date();
      await tx.digitalAssetAccount.update({
        where: { id: account.id },
        data: {
          historicalCreditGrantedAt: grantedAt,
          historicalCreditGrantLedgerId: existingHistoricalLedger.id,
        },
      });
      account.historicalCreditGrantedAt = grantedAt;
      account.historicalCreditGrantLedgerId = existingHistoricalLedger.id;
    } else if (!existingHistoricalLedger && !account.historicalCreditGrantedAt) {
      const tiers = await this.getCreditTiers(tx);
      const historicalCreditResult = calculateCreditAsset({
        previousCumulativeSpend: 0,
        addedSpend: account.cumulativeSpendAmount ?? 0,
        tiers,
      });
      const nextCreditAssetBalance = (account.creditAssetBalance ?? 0) + historicalCreditResult.assetAmount;
      const createdHistoricalLedger = await tx.digitalAssetLedger.create({
        data: {
          accountId: account.id,
          userId: params.userId,
          type: 'HISTORICAL_CONSUMPTION_GRANT',
          subjectType: 'CREDIT_ASSET',
          direction: 'CREDIT',
          amount: historicalCreditResult.assetAmount,
          assetAmount: historicalCreditResult.assetAmount,
          balanceAfter: nextCreditAssetBalance,
          cumulativeSpendAfter: account.cumulativeSpendAmount ?? 0,
          seedAssetBalanceAfter: account.seedAssetBalance ?? 0,
          creditAssetBalanceAfter: nextCreditAssetBalance,
          vipPurchaseId: params.vipPurchaseId,
          idempotencyKey: historicalCreditKey,
          ruleSnapshot: {
            tiers,
            segments: historicalCreditResult.segments,
            rawAssetAmount: historicalCreditResult.rawAssetAmount,
          },
          meta: {
            packageId: vipPackage.id,
            vipAmount: params.vipAmount,
          },
        },
      });
      const grantedAt = new Date();
      await tx.digitalAssetAccount.update({
        where: { id: account.id },
        data: {
          creditAssetBalance: nextCreditAssetBalance,
          historicalCreditGrantedAt: grantedAt,
          historicalCreditGrantLedgerId: createdHistoricalLedger.id,
        },
      });
      account.creditAssetBalance = nextCreditAssetBalance;
      account.historicalCreditGrantedAt = grantedAt;
      account.historicalCreditGrantLedgerId = createdHistoricalLedger.id;
    }

    if (params.inviterUserId && referralSeedAssetAmount > 0) {
      const existingReferralLedger = await tx.digitalAssetLedger.findUnique({
        where: { idempotencyKey: referralSeedKey },
      });
      const inviterEligible = await this.isEligibleReferralSeedRecipient(tx, params.inviterUserId);
      if (!existingReferralLedger && inviterEligible) {
        const inviterAccount = await this.findOrCreateAccount(tx, params.inviterUserId);
        const nextSeedAssetBalance = (inviterAccount.seedAssetBalance ?? 0) + referralSeedAssetAmount;
        await tx.digitalAssetLedger.create({
          data: {
            accountId: inviterAccount.id,
            userId: params.inviterUserId,
            type: 'REFERRAL_VIP_PURCHASE',
            subjectType: 'SEED_ASSET',
            direction: 'CREDIT',
            amount: referralSeedAssetAmount,
            assetAmount: referralSeedAssetAmount,
            balanceAfter: nextSeedAssetBalance,
            cumulativeSpendAfter: inviterAccount.cumulativeSpendAmount ?? 0,
            seedAssetBalanceAfter: nextSeedAssetBalance,
            creditAssetBalanceAfter: inviterAccount.creditAssetBalance ?? 0,
            vipPurchaseId: params.vipPurchaseId,
            idempotencyKey: referralSeedKey,
            meta: {
              packageId: vipPackage.id,
              vipAmount: params.vipAmount,
              sourceUserId: params.userId,
            },
          },
        });
        await tx.digitalAssetAccount.update({
          where: { id: inviterAccount.id },
          data: { seedAssetBalance: nextSeedAssetBalance },
        });
      }
    }
  }

  async backfillExistingVipAssets(params: {
    userId: string;
    vipPurchaseId: string;
    packageId: string | null;
    vipAmount: number;
  }): Promise<{
    status: 'credited' | 'alreadyCredited' | 'invalidPackage';
    grantedSelfSeed: boolean;
    grantedHistoricalCredit: boolean;
  }> {
    return this.withSerializableRetry(async (tx) => {
      const vipPackage = await this.resolveVipPackageRule(tx, {
        packageId: params.packageId,
        vipAmount: params.vipAmount,
      });
      if (!vipPackage) {
        return {
          status: 'invalidPackage' as const,
          grantedSelfSeed: false,
          grantedHistoricalCredit: false,
        };
      }

      const selfSeedKey = `vip-purchase:${params.vipPurchaseId}:self-seed`;
      const historicalCreditKey = `user:${params.userId}:historical-consumption-credit-grant`;
      const [accountBeforeGrant, existingSelfSeedLedger] = await Promise.all([
        tx.digitalAssetAccount.findUnique({ where: { userId: params.userId } }),
        tx.digitalAssetLedger.findUnique({ where: { idempotencyKey: selfSeedKey } }),
      ]);

      await this.grantVipActivationAssets(tx, {
        userId: params.userId,
        vipPurchaseId: params.vipPurchaseId,
        packageId: params.packageId,
        vipAmount: params.vipAmount,
        inviterUserId: null,
      });

      const grantedSelfSeed = !existingSelfSeedLedger && (vipPackage.selfSeedAssetAmount ?? 0) > 0;
      const grantedHistoricalCredit = !accountBeforeGrant?.historicalCreditGrantedAt;
      return {
        status: grantedSelfSeed || grantedHistoricalCredit ? 'credited' as const : 'alreadyCredited' as const,
        grantedSelfSeed,
        grantedHistoricalCredit,
      };
    });
  }

  async adjustByAdmin(params: {
    targetUserId: string;
    adminUserId: string;
    subjectType?: AdminAdjustSubjectType;
    amount: number;
    direction: LedgerDirection;
    reason: string;
    clientIdempotencyKey?: string;
  }): Promise<void> {
    const subjectType = params.subjectType ?? 'CUMULATIVE_SPEND';
    const amount = subjectType === 'CUMULATIVE_SPEND'
      ? roundMoney(params.amount)
      : roundAsset(params.amount);
    if (amount <= 0) throw new BadRequestException('调整金额必须大于 0');
    if (subjectType !== 'CUMULATIVE_SPEND' && !Number.isInteger(params.amount)) {
      throw new BadRequestException('数字资产调整数量必须为整数');
    }

    const idempotencyKey = params.clientIdempotencyKey
      ? `admin-adjust-client:${params.clientIdempotencyKey}`
      : `admin-adjust:${params.adminUserId}:${params.targetUserId}:${randomUUID()}`;

    await this.withSerializableRetry(async (tx) => {
      const existing = await tx.digitalAssetLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return;

      const account = await this.findOrCreateAccount(tx, params.targetUserId);
      const directionMultiplier = params.direction === 'CREDIT' ? 1 : -1;
      const cumulativeSpendAmount = account.cumulativeSpendAmount ?? 0;
      const seedAssetBalance = account.seedAssetBalance ?? 0;
      const creditAssetBalance = account.creditAssetBalance ?? 0;

      let nextCumulativeSpendAmount = cumulativeSpendAmount;
      let nextSeedAssetBalance = seedAssetBalance;
      let nextCreditAssetBalance = creditAssetBalance;

      if (subjectType === 'CUMULATIVE_SPEND') {
        nextCumulativeSpendAmount = roundMoney(cumulativeSpendAmount + directionMultiplier * amount);
        if (nextCumulativeSpendAmount < 0) throw new BadRequestException('数字资产累计消费不能扣成负数');
      } else if (subjectType === 'SEED_ASSET') {
        nextSeedAssetBalance = seedAssetBalance + directionMultiplier * amount;
        if (nextSeedAssetBalance < 0) throw new BadRequestException('种子资产不能扣成负数');
      } else {
        nextCreditAssetBalance = creditAssetBalance + directionMultiplier * amount;
        if (nextCreditAssetBalance < 0) throw new BadRequestException('信用资产不能扣成负数');
      }

      await tx.digitalAssetLedger.create({
        data: {
          accountId: account.id,
          userId: params.targetUserId,
          type: 'ADMIN_ADJUSTMENT',
          subjectType,
          direction: params.direction,
          amount,
          assetAmount: subjectType === 'CUMULATIVE_SPEND' ? null : amount,
          balanceAfter: subjectType === 'CUMULATIVE_SPEND'
            ? nextCumulativeSpendAmount
            : subjectType === 'SEED_ASSET'
              ? nextSeedAssetBalance
              : nextCreditAssetBalance,
          cumulativeSpendAfter: nextCumulativeSpendAmount,
          seedAssetBalanceAfter: nextSeedAssetBalance,
          creditAssetBalanceAfter: nextCreditAssetBalance,
          adminUserId: params.adminUserId,
          reason: params.reason,
          idempotencyKey,
          meta: {
            clientIdempotencyKey: params.clientIdempotencyKey ?? null,
          },
        },
      });
      await tx.digitalAssetAccount.update({
        where: { id: account.id },
        data: {
          cumulativeSpendAmount: nextCumulativeSpendAmount,
          seedAssetBalance: nextSeedAssetBalance,
          creditAssetBalance: nextCreditAssetBalance,
        },
      });
    });
  }

  async clearAccountAssets(tx: Prisma.TransactionClient | any, params: {
    userId: string;
    reason: 'ACCOUNT_DELETION' | 'SERIOUS_BAN' | string;
    idempotencyKey: string;
    adminUserId?: string | null;
  }): Promise<void> {
    const account = await tx.digitalAssetAccount.findUnique({ where: { userId: params.userId } });
    if (!account) return;

    const seedAssetBalance = account.seedAssetBalance ?? 0;
    const creditAssetBalance = account.creditAssetBalance ?? 0;
    if (seedAssetBalance <= 0 && creditAssetBalance <= 0) return;

    let nextSeedAssetBalance = seedAssetBalance;
    let nextCreditAssetBalance = creditAssetBalance;

    if (seedAssetBalance > 0) {
      const seedKey = `${params.idempotencyKey}:seed`;
      const existingSeedLedger = await tx.digitalAssetLedger.findUnique({ where: { idempotencyKey: seedKey } });
      if (!existingSeedLedger) {
        nextSeedAssetBalance = 0;
        await tx.digitalAssetLedger.create({
          data: {
            accountId: account.id,
            userId: params.userId,
            type: 'ADMIN_ADJUSTMENT',
            subjectType: 'SEED_ASSET',
            direction: 'DEBIT',
            amount: seedAssetBalance,
            assetAmount: seedAssetBalance,
            balanceAfter: nextSeedAssetBalance,
            cumulativeSpendAfter: account.cumulativeSpendAmount ?? 0,
            seedAssetBalanceAfter: nextSeedAssetBalance,
            creditAssetBalanceAfter: nextCreditAssetBalance,
            adminUserId: params.adminUserId ?? null,
            reason: params.reason,
            idempotencyKey: seedKey,
            meta: {
              reason: params.reason,
              originalSeedAssetBalance: seedAssetBalance,
              originalCreditAssetBalance: creditAssetBalance,
            },
          },
        });
      } else {
        nextSeedAssetBalance = 0;
      }
    }

    if (creditAssetBalance > 0) {
      const creditKey = `${params.idempotencyKey}:credit`;
      const existingCreditLedger = await tx.digitalAssetLedger.findUnique({ where: { idempotencyKey: creditKey } });
      if (!existingCreditLedger) {
        nextCreditAssetBalance = 0;
        await tx.digitalAssetLedger.create({
          data: {
            accountId: account.id,
            userId: params.userId,
            type: 'ADMIN_ADJUSTMENT',
            subjectType: 'CREDIT_ASSET',
            direction: 'DEBIT',
            amount: creditAssetBalance,
            assetAmount: creditAssetBalance,
            balanceAfter: nextCreditAssetBalance,
            cumulativeSpendAfter: account.cumulativeSpendAmount ?? 0,
            seedAssetBalanceAfter: nextSeedAssetBalance,
            creditAssetBalanceAfter: nextCreditAssetBalance,
            adminUserId: params.adminUserId ?? null,
            reason: params.reason,
            idempotencyKey: creditKey,
            meta: {
              reason: params.reason,
              originalSeedAssetBalance: seedAssetBalance,
              originalCreditAssetBalance: creditAssetBalance,
            },
          },
        });
      } else {
        nextCreditAssetBalance = 0;
      }
    }

    await tx.digitalAssetAccount.update({
      where: { id: account.id },
      data: {
        seedAssetBalance: nextSeedAssetBalance,
        creditAssetBalance: nextCreditAssetBalance,
      },
    });
  }

  async getSummary(userId: string) {
    const [account, member, modules, tiers, vipSeedRules] = await Promise.all([
      (this.prisma as any).digitalAssetAccount.findUnique({ where: { userId } }),
      (this.prisma as any).memberProfile.findUnique({ where: { userId } }),
      this.getModuleSettings(),
      this.getCreditTiers(this.prisma),
      this.getVipSeedRules(),
    ]);
    const recentRecords = await this.listLedgersInternal(userId, { page: 1, pageSize: 5 }, { restrictForNonVipBuyer: true, member });

    const cumulativeSpendAmount = account?.cumulativeSpendAmount ?? 0;
    const isVip = member?.tier === 'VIP';
    const seedAssetBalance = isVip ? account?.seedAssetBalance ?? 0 : 0;
    const creditAssetBalance = isVip ? account?.creditAssetBalance ?? 0 : 0;
    const totalAssetBalance = seedAssetBalance + creditAssetBalance;
    const currentCreditTier = this.getCurrentCreditTierInfo(cumulativeSpendAmount, tiers);
    const nextCreditTier = this.getNextCreditTierInfo(cumulativeSpendAmount, tiers);

    return {
      isVip,
      totalAssetBalance,
      seedAssetBalance,
      creditAssetBalance,
      cumulativeSpendAmount,
      activationPrompt: isVip ? undefined : ACTIVATION_PROMPT,
      currentCreditTier,
      nextCreditTier,
      vipSeedRules,
      recentRecords: recentRecords.items,
      modules,
    };
  }

  async listBuyerLedgers(userId: string, query: {
    page?: number;
    pageSize?: number;
    type?: string;
    subjectType?: DigitalAssetSubjectType;
    sourceType?: string;
  }) {
    return this.listLedgersInternal(userId, query, { restrictForNonVipBuyer: true });
  }

  async listLedgers(userId: string, query: {
    page?: number;
    pageSize?: number;
    type?: string;
    subjectType?: DigitalAssetSubjectType;
    sourceType?: string;
  }) {
    return this.listLedgersInternal(userId, query, { restrictForNonVipBuyer: false });
  }

  private async listLedgersInternal(userId: string, query: {
    page?: number;
    pageSize?: number;
    type?: string;
    subjectType?: DigitalAssetSubjectType;
    sourceType?: string;
  }, options: {
    restrictForNonVipBuyer: boolean;
    member?: { tier?: string | null } | null;
  }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where: any = { userId };

    if (options.restrictForNonVipBuyer) {
      const member = options.member ?? await (this.prisma as any).memberProfile.findUnique({ where: { userId } });
      const isVip = member?.tier === 'VIP';
      if (!isVip) {
        if (query.subjectType && query.subjectType !== 'CUMULATIVE_SPEND') {
          return {
            items: [],
            total: 0,
            page,
            pageSize,
          };
        }
        where.subjectType = 'CUMULATIVE_SPEND';
      } else if (query.subjectType) {
        where.subjectType = query.subjectType;
      }
    } else if (query.subjectType) {
      where.subjectType = query.subjectType;
    }

    const sourceType = filterLegacySourceType(query.sourceType ?? query.type);
    if (sourceType) where.type = sourceType;

    const [items, total] = await Promise.all([
      (this.prisma as any).digitalAssetLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      (this.prisma as any).digitalAssetLedger.count({ where }),
    ]);

    return {
      items: items.map((ledger: any) => this.mapLedger(ledger)),
      total,
      page,
      pageSize,
    };
  }

  private async writeRefundReversal(tx: any, params: {
    subjectType: DigitalAssetSubjectType;
    idempotencyKey: string;
    legacyFallbackIdempotencyKey: string | null;
    refund: any | null;
    refundId: string | null;
    afterSale: any | null;
    afterSaleId: string | null;
  }) {
    const existing = await tx.digitalAssetLedger.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return;

    if (params.legacyFallbackIdempotencyKey) {
      const fallbackLedger = await tx.digitalAssetLedger.findUnique({
        where: { idempotencyKey: params.legacyFallbackIdempotencyKey },
      });
      if (fallbackLedger && params.subjectType === 'CUMULATIVE_SPEND') {
        await tx.digitalAssetLedger.update({
          where: { id: fallbackLedger.id },
          data: {
            refundId: params.refundId,
            meta: {
              ...((fallbackLedger as any).meta ?? {}),
              linkedRefundId: params.refundId,
            },
          },
        });
        return;
      }
    }

    const orderId = params.refund?.orderId ?? params.afterSale?.orderId;
    if (!orderId) return;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || (order as any).bizType === 'VIP_PACKAGE') return;

    const account = await tx.digitalAssetAccount.findUnique({ where: { userId: order.userId } });
    if (!account) return;

    const creditLedgers = await tx.digitalAssetLedger.findMany({
      where: { orderId, direction: 'CREDIT', subjectType: params.subjectType },
    });
    const itemAllocations = creditLedgers.flatMap((ledger: any) => (ledger.meta?.itemAllocations ?? []) as any[]);
    if (itemAllocations.length === 0) return;

    const spendItemAllocations = creditLedgers.flatMap((ledger: any) => (
      params.subjectType === 'CUMULATIVE_SPEND'
        ? (ledger.meta?.itemAllocations ?? [])
        : (ledger.meta?.spendItemAllocations ?? [])
    ) as any[]);

    const debitLedgers = await tx.digitalAssetLedger.findMany({
      where: { orderId, direction: 'DEBIT', subjectType: params.subjectType },
    });
    const alreadyReversedByItem = new Map<string, number>();
    for (const ledger of debitLedgers) {
      for (const item of ledger.meta?.reversedItems ?? []) {
        alreadyReversedByItem.set(
          item.orderItemId,
          roundMoney((alreadyReversedByItem.get(item.orderItemId) ?? 0) + item.reversedAmount),
        );
      }
    }

    const orderRemainingAmount = roundMoney(
      itemAllocations.reduce((sum: number, item: any) => sum + item.assetAmount, 0)
        - Array.from(alreadyReversedByItem.values()).reduce((sum, value) => sum + value, 0),
    );
    if (orderRemainingAmount <= 0) return;

    const reversedItems = this.calculateReversedItems({
      subjectType: params.subjectType,
      refund: params.refund,
      afterSale: params.afterSale,
      itemAllocations,
      spendItemAllocations,
      alreadyReversedByItem,
      orderRemainingAmount,
    });
    const amount = roundMoney(reversedItems.reduce((sum, item) => sum + item.reversedAmount, 0));
    if (amount <= 0) return;

    const nextCumulativeSpendAmount = params.subjectType === 'CUMULATIVE_SPEND'
      ? roundMoney((account.cumulativeSpendAmount ?? 0) - amount)
      : account.cumulativeSpendAmount ?? 0;
    const nextCreditAssetBalance = params.subjectType === 'CREDIT_ASSET'
      ? (account.creditAssetBalance ?? 0) - roundAsset(amount)
      : account.creditAssetBalance ?? 0;
    if (nextCumulativeSpendAmount < 0) throw new BadRequestException('数字资产累计消费不能扣成负数');
    if (nextCreditAssetBalance < 0) throw new BadRequestException('信用资产不能扣成负数');

    await tx.digitalAssetLedger.create({
      data: {
        accountId: account.id,
        userId: order.userId,
        type: 'REFUND_REVERSAL',
        subjectType: params.subjectType,
        direction: 'DEBIT',
        amount,
        assetAmount: params.subjectType === 'CREDIT_ASSET' ? roundAsset(amount) : null,
        balanceAfter: params.subjectType === 'CUMULATIVE_SPEND'
          ? nextCumulativeSpendAmount
          : nextCreditAssetBalance,
        cumulativeSpendAfter: nextCumulativeSpendAmount,
        seedAssetBalanceAfter: account.seedAssetBalance ?? 0,
        creditAssetBalanceAfter: nextCreditAssetBalance,
        orderId,
        refundId: params.refundId,
        afterSaleId: params.afterSaleId,
        idempotencyKey: params.idempotencyKey,
        meta: {
          reversedItems,
        },
      },
    });
    await tx.digitalAssetAccount.update({
      where: { id: account.id },
      data: {
        cumulativeSpendAmount: nextCumulativeSpendAmount,
        creditAssetBalance: nextCreditAssetBalance,
      },
    });
  }

  private calculateReversedItems(params: {
    subjectType: DigitalAssetSubjectType;
    refund: any | null;
    afterSale: any | null;
    itemAllocations: any[];
    spendItemAllocations: any[];
    alreadyReversedByItem: Map<string, number>;
    orderRemainingAmount: number;
  }) {
    const { refund, afterSale, itemAllocations, spendItemAllocations, alreadyReversedByItem, subjectType } = params;
    const assetByItemId = new Map(itemAllocations.map((item) => [item.orderItemId, item]));
    const spendByItemId = new Map(spendItemAllocations.map((item) => [item.orderItemId, item]));
    const refundItems = refund?.items ?? [];

    const buildRequestedAmount = (orderItemId: string, spendAmount: number) => {
      if (subjectType === 'CUMULATIVE_SPEND') return spendAmount;
      const assetAllocation = assetByItemId.get(orderItemId);
      const spendAllocation = spendByItemId.get(orderItemId);
      if (!assetAllocation || !spendAllocation || spendAllocation.assetAmount <= 0) return 0;
      return roundAsset(assetAllocation.assetAmount * (Math.max(0, spendAmount) / spendAllocation.assetAmount));
    };

    if (refundItems.length > 0) {
      let orderRemaining = params.orderRemainingAmount;
      const reversedItems = [];
      for (const refundItem of refundItems) {
        const allocation = assetByItemId.get(refundItem.orderItemId);
        if (!allocation) continue;
        const alreadyReversedAmount = alreadyReversedByItem.get(refundItem.orderItemId) ?? 0;
        const lineRemaining = roundMoney(allocation.assetAmount - alreadyReversedAmount);
        const requestedAmount = buildRequestedAmount(refundItem.orderItemId, refundItem.amount);
        const reversedAmount = clampReversalAmount({
          requestedAmount,
          lineRemainingAmount: lineRemaining,
          orderRemainingAmount: orderRemaining,
        });
        if (reversedAmount <= 0) continue;
        orderRemaining = roundMoney(orderRemaining - reversedAmount);
        reversedItems.push({
          orderItemId: refundItem.orderItemId,
          quantity: refundItem.quantity,
          originalAssetAmount: allocation.assetAmount,
          alreadyReversedAmount,
          reversedAmount,
        });
      }
      return reversedItems;
    }

    if (afterSale?.orderItemId) {
      const allocation = assetByItemId.get(afterSale.orderItemId);
      if (!allocation) return [];
      const alreadyReversedAmount = alreadyReversedByItem.get(afterSale.orderItemId) ?? 0;
      const lineRemaining = roundMoney(allocation.assetAmount - alreadyReversedAmount);
      const shippingPaymentRefundAmount = afterSale.shippingPayment?.status === 'REFUNDED'
        ? afterSale.shippingPayment.amount
        : 0;
      const requestedSpendAmount = calculateRefundProductAmount({
        refundAmount: afterSale.refundAmount ?? refund?.amount ?? 0,
        returnShippingFee: afterSale.returnShippingFee,
        shippingPaymentRefundAmount,
      });
      const requestedAmount = buildRequestedAmount(afterSale.orderItemId, requestedSpendAmount);
      const reversedAmount = clampReversalAmount({
        requestedAmount,
        lineRemainingAmount: lineRemaining,
        orderRemainingAmount: params.orderRemainingAmount,
      });
      if (reversedAmount <= 0) return [];
      return [{
        orderItemId: afterSale.orderItemId,
        quantity: afterSale.orderItem?.quantity ?? 1,
        originalAssetAmount: allocation.assetAmount,
        alreadyReversedAmount,
        reversedAmount,
      }];
    }

    let orderRemaining = params.orderRemainingAmount;
    const requestedSpendAmount = calculateRefundProductAmount({
      refundAmount: afterSale?.refundAmount ?? refund?.amount ?? orderRemaining,
      returnShippingFee: afterSale?.returnShippingFee,
      shippingPaymentRefundAmount: afterSale?.shippingPayment?.status === 'REFUNDED'
        ? afterSale.shippingPayment.amount
        : 0,
    });
    if (requestedSpendAmount <= 0) return [];

    let remainingRequestedSpend = requestedSpendAmount;
    const reversedItems = [];
    for (const allocation of itemAllocations) {
      const spendAllocation = spendByItemId.get(allocation.orderItemId);
      const alreadyReversedAmount = alreadyReversedByItem.get(allocation.orderItemId) ?? 0;
      const lineRemaining = roundMoney(allocation.assetAmount - alreadyReversedAmount);
      const lineSpendAmount = Math.min(remainingRequestedSpend, spendAllocation?.assetAmount ?? remainingRequestedSpend);
      const requestedAmount = buildRequestedAmount(allocation.orderItemId, lineSpendAmount);
      const reversedAmount = clampReversalAmount({
        requestedAmount,
        lineRemainingAmount: lineRemaining,
        orderRemainingAmount: orderRemaining,
      });
      if (reversedAmount <= 0) continue;
      orderRemaining = roundMoney(orderRemaining - reversedAmount);
      remainingRequestedSpend = roundMoney(remainingRequestedSpend - lineSpendAmount);
      reversedItems.push({
        orderItemId: allocation.orderItemId,
        quantity: allocation.quantity,
        originalAssetAmount: allocation.assetAmount,
        alreadyReversedAmount,
        reversedAmount,
      });
      if (orderRemaining <= 0 || remainingRequestedSpend <= 0) break;
    }
    return reversedItems;
  }

  private allocateFromExistingAllocations(
    allocations: Array<{ orderItemId: string; skuId: string | null; quantity: number; grossAmount: number; assetAmount: number }>,
    totalAssetAmount: number,
  ) {
    if (allocations.length === 0 || totalAssetAmount <= 0) {
      return { allocations: [], residualOrderItemId: null };
    }

    const totalBaseAmount = allocations.reduce((sum, item) => sum + item.assetAmount, 0);
    if (totalBaseAmount <= 0) {
      return { allocations: [], residualOrderItemId: null };
    }

    let allocated = 0;
    const normalized = allocations.map((item, index) => {
      const isLast = index === allocations.length - 1;
      const assetAmount = isLast
        ? roundAsset(totalAssetAmount - allocated)
        : roundAsset(totalAssetAmount * (item.assetAmount / totalBaseAmount));
      allocated += assetAmount;
      return {
        orderItemId: item.orderItemId,
        skuId: item.skuId,
        quantity: item.quantity,
        grossAmount: item.grossAmount,
        assetAmount,
      };
    });

    return {
      allocations: normalized,
      residualOrderItemId: normalized[normalized.length - 1]?.orderItemId ?? null,
    };
  }

  private async getCreditTiers(client: any): Promise<CreditAssetTier[]> {
    if (!client?.ruleConfig?.findUnique) {
      return validateCreditTiers(DEFAULT_CREDIT_TIERS);
    }
    const config = await client.ruleConfig.findUnique({
      where: { key: DIGITAL_ASSET_CREDIT_TIERS_KEY },
    });
    const tiers = (config?.value?.value?.tiers ?? config?.value?.tiers ?? DEFAULT_CREDIT_TIERS) as CreditAssetTier[];
    return validateCreditTiers(tiers);
  }

  private async getVipSeedRules() {
    if (!(this.prisma as any).vipPackage?.findMany) return [];
    const packages = await (this.prisma as any).vipPackage.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { price: 'asc' },
    });

    return packages.map((pkg: any) => ({
      packageId: pkg.id,
      price: pkg.price,
      selfSeedAssetAmount: pkg.selfSeedAssetAmount,
      referralSeedAssetAmount: pkg.referralSeedAssetAmount,
    }));
  }

  private async getModuleSettings() {
    if (!(this.prisma as any).ruleConfig?.findUnique) {
      return DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS.map((item) => ({
        ...item,
        status: 'COMING_SOON' as const,
      }));
    }
    const config = await (this.prisma as any).ruleConfig.findUnique({
      where: { key: DIGITAL_ASSET_SETTINGS_KEY },
    });
    return normalizeDigitalAssetModuleSettings(
      (config?.value?.modules ?? DEFAULT_DIGITAL_ASSET_MODULE_SETTINGS) as any[],
      { allowLegacyKey: true },
    ).map((item) => ({
      ...item,
      status: 'COMING_SOON' as const,
    }));
  }

  private getCurrentCreditTierInfo(cumulativeSpendAmount: number, tiers: CreditAssetTier[]) {
    const tier = [...tiers].reverse().find((item) => cumulativeSpendAmount >= item.minAmount) ?? tiers[0];
    return {
      minAmount: tier.minAmount,
      maxAmount: tier.maxAmount,
      multiplier: tier.multiplier,
      currentAmount: cumulativeSpendAmount,
    };
  }

  private getNextCreditTierInfo(cumulativeSpendAmount: number, tiers: CreditAssetTier[]) {
    const nextTier = tiers.find((item) => item.minAmount > cumulativeSpendAmount) ?? null;
    if (!nextTier) return null;
    return {
      minAmount: nextTier.minAmount,
      maxAmount: nextTier.maxAmount,
      multiplier: nextTier.multiplier,
      remainingAmount: roundMoney(nextTier.minAmount - cumulativeSpendAmount),
    };
  }

  private async resolveVipPackageRule(tx: any, params: { packageId: string | null; vipAmount: number }) {
    if (!tx?.vipPackage) return null;
    const vipPackages = await tx.vipPackage.findMany({
      select: {
        id: true,
        price: true,
        status: true,
        selfSeedAssetAmount: true,
        referralSeedAssetAmount: true,
      },
    });
    return resolveVipBackfillPackage({
      packageId: params.packageId,
      vipAmount: params.vipAmount,
      vipPackages,
    });
  }

  private async isEligibleReferralSeedRecipient(tx: any, userId: string): Promise<boolean> {
    const user = await tx.user?.findUnique?.({
      where: { id: userId },
      select: {
        status: true,
        deletionExecutedAt: true,
        memberProfile: { select: { tier: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletionExecutedAt) return false;

    const tier = user.memberProfile?.tier
      ?? (await tx.memberProfile?.findUnique?.({ where: { userId }, select: { tier: true } }))?.tier;
    return tier === 'VIP';
  }

  private async findOrCreateAccount(tx: any, userId: string) {
    const existing = await tx.digitalAssetAccount.findUnique({ where: { userId } });
    if (existing) return existing;
    return tx.digitalAssetAccount.create({
      data: {
        userId,
        cumulativeSpendAmount: 0,
        seedAssetBalance: 0,
        creditAssetBalance: 0,
        historicalCreditGrantedAt: null,
        historicalCreditGrantLedgerId: null,
      },
    });
  }

  private mapLedger(ledger: any) {
    return {
      id: ledger.id,
      type: ledger.type,
      sourceType: normalizeLedgerSource(ledger.type),
      subjectType: ledger.subjectType,
      direction: ledger.direction,
      amount: ledger.amount,
      assetAmount: ledger.assetAmount ?? null,
      balanceAfter: ledger.balanceAfter,
      title: this.getLedgerTitle(ledger),
      description: ledger.reason ?? undefined,
      orderId: ledger.orderId ?? undefined,
      createdAt: ledger.createdAt,
    };
  }

  private getLedgerTitle(ledger: any): string {
    if (ledger.type === 'SELF_VIP_PURCHASE') return '自购 VIP 种子资产';
    if (ledger.type === 'REFERRAL_VIP_PURCHASE') return '推荐 VIP 种子资产';
    if (ledger.type === 'HISTORICAL_CONSUMPTION_GRANT') return '历史消费转入';
    if (ledger.type === 'REFUND_REVERSAL') return '退款扣回';
    if (ledger.type === 'ADMIN_ADJUSTMENT') return '后台调整';
    if (ledger.type === 'CONSUMPTION_CONFIRMED' || ledger.type === 'ORDER_RECEIVED' || ledger.type === 'BACKFILL') {
      return ledger.subjectType === 'CREDIT_ASSET' ? '信用资产入账' : '消费累计';
    }
    return '消费记录';
  }

  private async withSerializableRetry<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt += 1) {
      try {
        return await (this.prisma as any).$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < SERIALIZABLE_MAX_RETRIES - 1) continue;
        throw err;
      }
    }
    throw new Error('unreachable serializable retry state');
  }
}
