import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_DEDUCTION_RULES = {
  deductionRatioNormal: 0.1,
  deductionRatioVip: 0.15,
  deductionMinOrderAmount: 0,
};

const RULE_KEY_MAP: Record<string, keyof typeof DEFAULT_DEDUCTION_RULES> = {
  DEDUCTION_RATIO_NORMAL: 'deductionRatioNormal',
  DEDUCTION_RATIO_VIP: 'deductionRatioVip',
  DEDUCTION_MIN_ORDER_AMOUNT: 'deductionMinOrderAmount',
};

const yuanToCents = (value: number | null | undefined): number => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized)) return 0;
  return Math.round((normalized + Number.EPSILON) * 100);
};

const centsToYuan = (cents: number): number => {
  return Math.round(cents) / 100;
};

const unwrapRuleConfigValue = (raw: any): number | null => {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw
    ? raw.value
    : raw;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

type DeductionRules = typeof DEFAULT_DEDUCTION_RULES;

type DeductLedger = {
  id: string;
  accountId: string;
  userId: string;
  amount: number;
  meta?: any;
};

@Injectable()
export class RewardDeductionService {
  private readonly logger = new Logger(RewardDeductionService.name);

  constructor(private prisma: PrismaService) {}

  async calculateMaxDeductible(
    userId: string,
    goodsAmount: number,
  ): Promise<{
    pointsBalance: number;
    pointsRatio: number;
    maxDeductible: number;
  }> {
    return this.calculateMaxDeductibleWithClient(this.prisma as any, userId, goodsAmount);
  }

  async reserveDeduction(
    tx: any,
    userId: string,
    goodsAmount: number,
    requestedAmount: number,
  ): Promise<{
    groupId: string;
    primaryLedgerId: string;
    ledgerIds: string[];
    deductedFromVip: number;
    deductedFromNormal: number;
  } | null> {
    const requestedCents = yuanToCents(requestedAmount);
    if (requestedCents <= 0) return null;

    const max = await this.calculateMaxDeductibleWithClient(tx, userId, goodsAmount);
    if (requestedCents > yuanToCents(max.maxDeductible)) {
      throw new BadRequestException('抵扣金额超出上限');
    }

    const [vip, normal] = await this.getRewardAccounts(tx, userId);
    const vipBalanceCents = yuanToCents(vip?.balance);
    const normalBalanceCents = yuanToCents(normal?.balance);
    const totalBalanceCents = vipBalanceCents + normalBalanceCents;
    if (requestedCents > totalBalanceCents) {
      throw new BadRequestException('消费积分余额不足');
    }

    const fromVipCents = Math.min(vipBalanceCents, requestedCents);
    const fromNormalCents = requestedCents - fromVipCents;

    if (fromVipCents > 0 && !vip) {
      throw new BadRequestException('VIP 消费积分账户不存在');
    }
    if (fromNormalCents > 0 && !normal) {
      throw new BadRequestException('普通消费积分账户不存在');
    }

    if (fromVipCents > 0) {
      await this.reserveAccountBalance(tx, vip.id, fromVipCents, 'VIP 消费积分余额扣减并发失败，请重试');
    }
    if (fromNormalCents > 0) {
      await this.reserveAccountBalance(tx, normal.id, fromNormalCents, '普通消费积分余额扣减并发失败，请重试');
    }

    const groupId = `DG-${randomUUID()}`;
    const ledgerIds: string[] = [];
    let primaryLedgerId: string | null = null;

    if (fromVipCents > 0) {
      const ledger = await tx.rewardLedger.create({
        data: {
          accountId: vip.id,
          userId,
          entryType: 'DEDUCT',
          amount: centsToYuan(fromVipCents),
          status: 'RESERVED',
          refType: 'CHECKOUT',
          meta: {
            scheme: 'POINTS_DEDUCTION',
            groupId,
            role: fromNormalCents > 0 ? 'PRIMARY' : 'SOLE',
            accountType: 'VIP_REWARD',
          },
        },
      });
      primaryLedgerId = ledger.id;
      ledgerIds.push(ledger.id);
    }

    if (fromNormalCents > 0) {
      const ledger = await tx.rewardLedger.create({
        data: {
          accountId: normal.id,
          userId,
          entryType: 'DEDUCT',
          amount: centsToYuan(fromNormalCents),
          status: 'RESERVED',
          refType: 'CHECKOUT',
          meta: {
            scheme: 'POINTS_DEDUCTION',
            groupId,
            role: primaryLedgerId ? 'SECONDARY' : 'SOLE',
            accountType: 'NORMAL_REWARD',
            ...(primaryLedgerId ? { siblingLedgerId: primaryLedgerId } : {}),
          },
        },
      });
      if (!primaryLedgerId) primaryLedgerId = ledger.id;
      ledgerIds.push(ledger.id);
    }

    if (!primaryLedgerId) {
      throw new BadRequestException('抵扣预留失败');
    }

    return {
      groupId,
      primaryLedgerId,
      ledgerIds,
      deductedFromVip: centsToYuan(fromVipCents),
      deductedFromNormal: centsToYuan(fromNormalCents),
    };
  }

  async confirmDeduction(tx: any, groupId: string): Promise<void> {
    const ledgers = await this.findReservedDeductLedgers(tx, groupId);
    if (ledgers.length === 0) return;

    for (const ledger of ledgers) {
      const amount = centsToYuan(yuanToCents(ledger.amount));
      const updated = await tx.rewardAccount.updateMany({
        where: { id: ledger.accountId, frozen: { gte: amount } },
        data: { frozen: { decrement: amount } },
      });
      if (updated.count === 0) {
        throw new BadRequestException('抵扣积分确认失败，请重试');
      }
    }

    await tx.rewardLedger.updateMany({
      where: {
        status: 'RESERVED',
        entryType: 'DEDUCT',
        meta: { path: ['groupId'], equals: groupId },
      },
      data: { status: 'VOIDED' },
    });
  }

  async releaseDeduction(tx: any, groupId: string): Promise<void> {
    const ledgers = await this.findReservedDeductLedgers(tx, groupId);
    if (ledgers.length === 0) return;

    for (const ledger of ledgers) {
      const amount = centsToYuan(yuanToCents(ledger.amount));
      const updated = await tx.rewardAccount.updateMany({
        where: { id: ledger.accountId, frozen: { gte: amount } },
        data: {
          frozen: { decrement: amount },
          balance: { increment: amount },
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException('抵扣积分释放失败，请重试');
      }
    }

    await tx.rewardLedger.updateMany({
      where: {
        status: 'RESERVED',
        entryType: 'DEDUCT',
        meta: { path: ['groupId'], equals: groupId },
      },
      data: { status: 'AVAILABLE' },
    });
  }

  async refundDeduction(
    tx: any,
    params: {
      refundId: string;
      orderId: string;
      originalGoodsAmount: number;
      originalGoodsRefundAmount: number;
      originalDeductAmount: number;
      deductionGroupId: string | null;
      isFinalRefund?: boolean;
      cumulativeGoodsRefundAmount?: number;
    },
  ): Promise<void> {
    if (!params.deductionGroupId) return;
    const originalGoodsCents = yuanToCents(params.originalGoodsAmount);
    const goodsRefundCents = yuanToCents(params.originalGoodsRefundAmount);
    const originalDeductCents = yuanToCents(params.originalDeductAmount);
    if (originalGoodsCents <= 0 || goodsRefundCents <= 0 || originalDeductCents <= 0) return;

    const existingRestore = await tx.rewardLedger.findFirst({
      where: {
        refType: 'REFUND_RESTORE',
        refId: params.refundId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingRestore) return;

    const originalLedgers: DeductLedger[] = await tx.rewardLedger.findMany({
      where: {
        entryType: 'DEDUCT',
        meta: { path: ['groupId'], equals: params.deductionGroupId },
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (originalLedgers.length === 0) {
      this.logger.warn(`退款积分返还跳过：未找到原抵扣流水 groupId=${params.deductionGroupId}`);
      return;
    }

    const restoreLedgers: DeductLedger[] = await tx.rewardLedger.findMany({
      where: {
        refType: 'REFUND_RESTORE',
        meta: { path: ['groupId'], equals: params.deductionGroupId },
        deletedAt: null,
      },
    });

    const alreadyRestoredCents = restoreLedgers.reduce(
      (sum, ledger) => sum + yuanToCents(ledger.amount),
      0,
    );
    const remainingDeductCents = Math.max(0, originalDeductCents - alreadyRestoredCents);
    if (remainingDeductCents <= 0) return;

    const cumulativeGoodsRefundCents = yuanToCents(params.cumulativeGoodsRefundAmount);
    const isFinalRefund = params.isFinalRefund === true ||
      (cumulativeGoodsRefundCents > 0 && cumulativeGoodsRefundCents >= originalGoodsCents);
    const proportionalRefundCents = Math.round(
      (originalDeductCents * Math.min(goodsRefundCents, originalGoodsCents)) / originalGoodsCents,
    );
    const refundDeductCents = isFinalRefund
      ? remainingDeductCents
      : Math.min(proportionalRefundCents, remainingDeductCents);
    if (refundDeductCents <= 0) return;

    const portions = this.allocateRestorePortions(
      originalLedgers,
      restoreLedgers,
      refundDeductCents,
      isFinalRefund,
    );

    for (const { ledger, amountCents } of portions) {
      if (amountCents <= 0) continue;
      const amount = centsToYuan(amountCents);
      await tx.rewardAccount.updateMany({
        where: { id: ledger.accountId },
        data: { balance: { increment: amount } },
      });
      await tx.rewardLedger.create({
        data: {
          accountId: ledger.accountId,
          userId: ledger.userId,
          entryType: 'ADJUST',
          amount,
          status: 'AVAILABLE',
          refType: 'REFUND_RESTORE',
          refId: params.refundId,
          meta: {
            scheme: 'REFUND_RESTORE',
            groupId: params.deductionGroupId,
            orderId: params.orderId,
            sourceLedgerId: ledger.id,
            originalGoodsAmount: params.originalGoodsAmount,
            originalGoodsRefundAmount: params.originalGoodsRefundAmount,
          },
        },
      });
    }
  }

  private async calculateMaxDeductibleWithClient(
    client: any,
    userId: string,
    goodsAmount: number,
  ): Promise<{
    pointsBalance: number;
    pointsRatio: number;
    maxDeductible: number;
  }> {
    const rules = await this.getDeductionRules(client);
    const member = await client.memberProfile.findUnique({ where: { userId } });
    const ratio = member?.tier === 'VIP'
      ? rules.deductionRatioVip
      : rules.deductionRatioNormal;
    const [vip, normal] = await this.getRewardAccounts(client, userId);
    const balanceCents = yuanToCents(vip?.balance) + yuanToCents(normal?.balance);
    const goodsCents = yuanToCents(goodsAmount);
    const minOrderCents = yuanToCents(rules.deductionMinOrderAmount);
    const maxByRatioCents = goodsCents < minOrderCents
      ? 0
      : Math.floor(goodsCents * ratio);
    const maxDeductibleCents = Math.min(maxByRatioCents, balanceCents);

    return {
      pointsBalance: centsToYuan(balanceCents),
      pointsRatio: ratio,
      maxDeductible: centsToYuan(maxDeductibleCents),
    };
  }

  private async getDeductionRules(client: any): Promise<DeductionRules> {
    const rules = { ...DEFAULT_DEDUCTION_RULES };
    if (!client.ruleConfig?.findMany) return rules;

    const rows = await client.ruleConfig.findMany({
      where: { key: { in: Object.keys(RULE_KEY_MAP) } },
    });
    for (const row of rows ?? []) {
      const field = RULE_KEY_MAP[row.key];
      if (!field) continue;
      const value = unwrapRuleConfigValue(row.value);
      if (value !== null) {
        rules[field] = value;
      }
    }
    return rules;
  }

  private async getRewardAccounts(client: any, userId: string): Promise<[any, any]> {
    const vip = await client.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'VIP_REWARD' } },
    });
    const normal = await client.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
    });
    return [vip, normal];
  }

  private async reserveAccountBalance(
    tx: any,
    accountId: string,
    amountCents: number,
    errorMessage: string,
  ): Promise<void> {
    const amount = centsToYuan(amountCents);
    const updated = await tx.rewardAccount.updateMany({
      where: { id: accountId, balance: { gte: amount } },
      data: {
        balance: { decrement: amount },
        frozen: { increment: amount },
      },
    });
    if (updated.count === 0) {
      throw new BadRequestException(errorMessage);
    }
  }

  private async findReservedDeductLedgers(tx: any, groupId: string): Promise<DeductLedger[]> {
    return tx.rewardLedger.findMany({
      where: {
        status: 'RESERVED',
        entryType: 'DEDUCT',
        meta: { path: ['groupId'], equals: groupId },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private allocateRestorePortions(
    originalLedgers: DeductLedger[],
    restoreLedgers: DeductLedger[],
    refundDeductCents: number,
    isFinalRefund: boolean,
  ): Array<{ ledger: DeductLedger; amountCents: number }> {
    const restoredBySource = new Map<string, number>();
    for (const ledger of restoreLedgers) {
      const sourceLedgerId = ledger.meta?.sourceLedgerId;
      if (typeof sourceLedgerId !== 'string') continue;
      restoredBySource.set(
        sourceLedgerId,
        (restoredBySource.get(sourceLedgerId) ?? 0) + yuanToCents(ledger.amount),
      );
    }

    if (isFinalRefund && restoredBySource.size > 0) {
      const portions = originalLedgers.map((ledger) => ({
        ledger,
        amountCents: Math.max(
          0,
          yuanToCents(ledger.amount) - (restoredBySource.get(ledger.id) ?? 0),
        ),
      }));
      const total = portions.reduce((sum, item) => sum + item.amountCents, 0);
      if (total === refundDeductCents) return portions;
    }

    const originalTotalCents = originalLedgers.reduce(
      (sum, ledger) => sum + yuanToCents(ledger.amount),
      0,
    );
    let allocated = 0;
    return originalLedgers.map((ledger, index) => {
      const maxForLedger = Math.max(
        0,
        yuanToCents(ledger.amount) - (restoredBySource.get(ledger.id) ?? 0),
      );
      const amountCents = index === originalLedgers.length - 1
        ? refundDeductCents - allocated
        : Math.round((refundDeductCents * yuanToCents(ledger.amount)) / originalTotalCents);
      const capped = Math.min(maxForLedger, Math.max(0, amountCents));
      allocated += capped;
      return { ledger, amountCents: capped };
    });
  }
}
