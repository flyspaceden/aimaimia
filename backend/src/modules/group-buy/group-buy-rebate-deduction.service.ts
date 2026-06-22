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

const centsToYuan = (cents: number): number => Math.round(cents) / 100;

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
export class GroupBuyRebateDeductionService {
  private readonly logger = new Logger(GroupBuyRebateDeductionService.name);

  constructor(private prisma: PrismaService) {}

  async calculateMaxDeductible(
    userId: string,
    goodsAmount: number,
  ): Promise<{
    rebateBalance: number;
    rebateRatio: number;
    maxDeductible: number;
  }> {
    return this.calculateMaxDeductibleWithClient(this.prisma as any, userId, goodsAmount);
  }

  async reserveDeduction(
    tx: any,
    userId: string,
    goodsAmount: number,
    requestedAmount: number,
  ): Promise<{ groupId: string; ledgerId: string; amount: number } | null> {
    const requestedCents = yuanToCents(requestedAmount);
    if (requestedCents <= 0) return null;

    const max = await this.calculateMaxDeductibleWithClient(tx, userId, goodsAmount);
    if (requestedCents > yuanToCents(max.maxDeductible)) {
      throw new BadRequestException('团购返还余额抵扣金额超出上限');
    }

    const account = await tx.groupBuyRebateAccount.findUnique({ where: { userId } });
    const balanceCents = yuanToCents(account?.balance);
    if (!account || requestedCents > balanceCents) {
      throw new BadRequestException('团购返还余额不足');
    }

    const amount = centsToYuan(requestedCents);
    const updated = await tx.groupBuyRebateAccount.updateMany({
      where: { id: account.id, balance: { gte: amount } },
      data: {
        balance: { decrement: amount },
        reserved: { increment: amount },
      },
    });
    if (updated.count === 0) {
      throw new BadRequestException('团购返还余额扣减并发失败，请重试');
    }

    const groupId = `GBD-${randomUUID()}`;
    const balanceBefore = centsToYuan(balanceCents);
    const balanceAfter = centsToYuan(balanceCents - requestedCents);
    const ledger = await tx.groupBuyRebateLedger.create({
      data: {
        accountId: account.id,
        userId,
        type: 'DEDUCT',
        status: 'RESERVED',
        amount,
        balanceBefore,
        balanceAfter,
        idempotencyKey: `GROUP_BUY_DEDUCT:${groupId}`,
        refType: 'CHECKOUT',
        refId: null,
        meta: {
          scheme: 'GROUP_BUY_REBATE_DEDUCTION',
          groupId,
        },
      },
    });

    return { groupId, ledgerId: ledger.id, amount };
  }

  async confirmDeduction(tx: any, groupId: string): Promise<void> {
    const ledgers = await this.findReservedDeductLedgers(tx, groupId);
    if (ledgers.length === 0) return;

    for (const ledger of ledgers) {
      const amount = centsToYuan(yuanToCents(ledger.amount));
      const updated = await tx.groupBuyRebateAccount.updateMany({
        where: { id: ledger.accountId, reserved: { gte: amount } },
        data: {
          reserved: { decrement: amount },
          deducted: { increment: amount },
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException('团购返还余额抵扣确认失败，请重试');
      }
    }

    await tx.groupBuyRebateLedger.updateMany({
      where: {
        status: 'RESERVED',
        type: 'DEDUCT',
        meta: { path: ['groupId'], equals: groupId },
      },
      data: { status: 'COMPLETED' },
    });
  }

  async releaseDeduction(tx: any, groupId: string): Promise<void> {
    const ledgers = await this.findReservedDeductLedgers(tx, groupId);
    if (ledgers.length === 0) return;

    for (const ledger of ledgers) {
      const amount = centsToYuan(yuanToCents(ledger.amount));
      const updated = await tx.groupBuyRebateAccount.updateMany({
        where: { id: ledger.accountId, reserved: { gte: amount } },
        data: {
          reserved: { decrement: amount },
          balance: { increment: amount },
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException('团购返还余额抵扣释放失败，请重试');
      }
    }

    await tx.groupBuyRebateLedger.updateMany({
      where: {
        status: 'RESERVED',
        type: 'DEDUCT',
        meta: { path: ['groupId'], equals: groupId },
      },
      data: { status: 'VOIDED' },
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

    const existingRestore = await tx.groupBuyRebateLedger.findFirst({
      where: {
        refType: 'REFUND_RESTORE',
        refId: params.refundId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingRestore) return;

    const originalLedgers: DeductLedger[] = await tx.groupBuyRebateLedger.findMany({
      where: {
        type: 'DEDUCT',
        meta: { path: ['groupId'], equals: params.deductionGroupId },
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (originalLedgers.length === 0) {
      this.logger.warn(`团购返还退款抵扣返还跳过：未找到原抵扣流水 groupId=${params.deductionGroupId}`);
      return;
    }

    const restoreLedgers: DeductLedger[] = await tx.groupBuyRebateLedger.findMany({
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
      await tx.groupBuyRebateAccount.updateMany({
        where: { id: ledger.accountId },
        data: {
          balance: { increment: amount },
          deducted: { decrement: amount },
        },
      });
      await tx.groupBuyRebateLedger.create({
        data: {
          accountId: ledger.accountId,
          userId: ledger.userId,
          type: 'REFUND_RETURN',
          status: 'AVAILABLE',
          amount,
          balanceBefore: 0,
          balanceAfter: 0,
          refType: 'REFUND_RESTORE',
          refId: params.refundId,
          idempotencyKey: `GROUP_BUY_REFUND_RETURN:${params.refundId}:${ledger.id}`,
          meta: {
            scheme: 'GROUP_BUY_REBATE_REFUND_RETURN',
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
  ) {
    const rules = await this.getDeductionRules(client);
    const member = await client.memberProfile.findUnique({ where: { userId } });
    const ratio = member?.tier === 'VIP'
      ? rules.deductionRatioVip
      : rules.deductionRatioNormal;
    const account = await client.groupBuyRebateAccount.findUnique({ where: { userId } });
    const balanceCents = yuanToCents(account?.balance);
    const goodsCents = yuanToCents(goodsAmount);
    const minOrderCents = yuanToCents(rules.deductionMinOrderAmount);
    const maxByRatioCents = goodsCents < minOrderCents
      ? 0
      : Math.floor(goodsCents * ratio);
    const maxDeductibleCents = Math.min(maxByRatioCents, balanceCents);

    return {
      rebateBalance: centsToYuan(balanceCents),
      rebateRatio: ratio,
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

  private async findReservedDeductLedgers(tx: any, groupId: string): Promise<DeductLedger[]> {
    return tx.groupBuyRebateLedger.findMany({
      where: {
        status: 'RESERVED',
        type: 'DEDUCT',
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
