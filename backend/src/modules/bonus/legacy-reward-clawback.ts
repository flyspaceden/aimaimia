import { ConflictException } from '@nestjs/common';
import { PLATFORM_USER_ID } from './engine/constants';
import {
  centsToYuan,
  nonNegativeYuanCapacityToCents,
  yuanToCents,
} from '../profit/money-allocation';

const PENDING_WHERE = {
  entryType: 'VOID',
  status: 'RETURN_FROZEN',
  refType: 'AFTER_SALE_CLAWBACK',
  amount: { lt: 0 },
} as const;
const RECOVERY_ACCOUNT_TYPES = ['VIP_REWARD', 'NORMAL_REWARD', 'INDUSTRY_FUND'] as const;
const recoveryPriority = (type: unknown) => {
  const index = RECOVERY_ACCOUNT_TYPES.indexOf(type as (typeof RECOVERY_ACCOUNT_TYPES)[number]);
  return index === -1 ? RECOVERY_ACCOUNT_TYPES.length : index;
};

async function listPending(client: any, userId: string) {
  if (!client.rewardLedger?.findMany) return [];
  const rows = await client.rewardLedger.findMany({
    where: { userId, ...PENDING_WHERE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // 兼容只按调用次数返回数据的旧单测桩；生产 Prisma 已由 where 精确过滤。
  return (rows ?? []).filter((ledger: any) =>
    ledger?.id
    && ledger?.accountId
    && ledger.entryType === 'VOID'
    && ledger.status === 'RETURN_FROZEN'
    && ledger.refType === 'AFTER_SALE_CLAWBACK'
    && Number(ledger.amount) < 0,
  );
}

export async function calculateUncoveredLegacyClawbackCents(
  client: any,
  userId: string,
): Promise<number> {
  const ledgers = await listPending(client, userId);
  if (ledgers.length === 0) return 0;
  const sourceAccountIds = [...new Set(ledgers.map((ledger: any) => ledger.accountId))];
  const accounts = await client.rewardAccount.findMany({
    where: {
      userId,
      OR: [
        { id: { in: sourceAccountIds } },
        { type: { in: [...RECOVERY_ACCOUNT_TYPES] } },
      ],
    },
    select: { id: true, balance: true, type: true },
  });
  const debtCents = ledgers.reduce(
    (total: number, ledger: any) => total + Math.abs(yuanToCents(Number(ledger.amount))),
    0,
  );
  const balanceCents = (accounts ?? []).reduce(
    (total: number, account: any) => total + nonNegativeYuanCapacityToCents(
      Math.max(0, Number(account.balance ?? 0)),
    ),
    0,
  );
  return Math.max(0, debtCents - balanceCents);
}

export async function calculatePendingLegacyClawbackCents(
  client: any,
  userId: string,
): Promise<number> {
  const ledgers = await listPending(client, userId);
  return ledgers.reduce(
    (total: number, ledger: any) => total + Math.abs(yuanToCents(Number(ledger.amount))),
    0,
  );
}

export async function calculateLegacyClawbackReservationsByAccountCents(
  client: any,
  userId: string,
): Promise<{ totalCents: number; byAccountId: Map<string, number> }> {
  const ledgers = await listPending(client, userId);
  const sourceAccountIds = [...new Set(ledgers.map((ledger: any) => ledger.accountId))];
  const accounts = ledgers.length > 0
    ? await client.rewardAccount.findMany({
        where: {
          userId,
          OR: [
            { id: { in: sourceAccountIds } },
            { type: { in: [...RECOVERY_ACCOUNT_TYPES] } },
          ],
        },
        select: { id: true, balance: true, type: true },
      })
    : [];
  const remainingBalance = new Map<string, number>(
    (accounts ?? []).map((account: any) => [
      String(account.id),
      nonNegativeYuanCapacityToCents(Math.max(0, Number(account.balance ?? 0))),
    ] as [string, number]),
  );
  const accountTypes = new Map<string, string>(
    (accounts ?? []).map((account: any) => [String(account.id), String(account.type ?? '')]),
  );
  const byAccountId = new Map<string, number>();
  let totalCents = 0;
  for (const ledger of ledgers) {
    const debtCents = Math.abs(yuanToCents(Number(ledger.amount)));
    totalCents += debtCents;
    let reservedCents = 0;
    const candidateIds = [...remainingBalance.keys()].sort((left, right) => {
      if (left === ledger.accountId) return -1;
      if (right === ledger.accountId) return 1;
      const priorityDelta = recoveryPriority(accountTypes.get(left)) - recoveryPriority(accountTypes.get(right));
      return priorityDelta || left.localeCompare(right);
    });
    for (const accountId of candidateIds) {
      const available = remainingBalance.get(accountId) ?? 0;
      const reserved = Math.min(debtCents - reservedCents, available);
      if (reserved <= 0) continue;
      remainingBalance.set(accountId, available - reserved);
      byAccountId.set(accountId, (byAccountId.get(accountId) ?? 0) + reserved);
      reservedCents += reserved;
      if (reservedCents === debtCents) break;
    }
  }
  return { totalCents, byAccountId };
}

/**
 * 在提现、积分抵扣或账号注销事务内，优先用同一奖励账户的后续收入偿还旧退款债权。
 * 所有读写以整数分裁决；pending ledger 的 amount 表示剩余债务（负数）。
 */
export async function settleLegacyRewardClawbacksInTransaction(
  tx: any,
  userId: string,
): Promise<{ recoveredCents: number; remainingCents: number }> {
  const ledgers = await listPending(tx, userId);
  const sourceAccountIds = [...new Set(ledgers.map((ledger: any) => ledger.accountId))];
  const accounts = ledgers.length > 0
    ? await tx.rewardAccount.findMany({
        where: {
          userId,
          OR: [
            { id: { in: sourceAccountIds } },
            { type: { in: [...RECOVERY_ACCOUNT_TYPES] } },
          ],
        },
        select: { id: true, balance: true, type: true },
      })
    : [];
  const accountBalances = new Map<string, number>(
    (accounts ?? []).map((account: any) => [
      String(account.id),
      nonNegativeYuanCapacityToCents(Math.max(0, Number(account.balance ?? 0))),
    ] as [string, number]),
  );
  const accountTypes = new Map<string, string>(
    (accounts ?? []).map((account: any) => [String(account.id), String(account.type ?? '')]),
  );
  let recoveredTotalCents = 0;
  let remainingTotalCents = 0;
  let platformAccount: { id: string } | null = null;

  for (const ledger of ledgers) {
    const outstandingCents = Math.abs(yuanToCents(Number(ledger.amount)));
    if (outstandingCents === 0) continue;
    let recoveredCents = 0;
    const candidateAccountIds = [...accountBalances.keys()].sort((left, right) => {
      if (left === ledger.accountId) return -1;
      if (right === ledger.accountId) return 1;
      const priorityDelta = recoveryPriority(accountTypes.get(left)) - recoveryPriority(accountTypes.get(right));
      return priorityDelta || left.localeCompare(right);
    });
    for (const accountId of candidateAccountIds) {
      const availableCents = accountBalances.get(accountId) ?? 0;
      const debitCents = Math.min(outstandingCents - recoveredCents, availableCents);
      if (debitCents <= 0) continue;
      const debitAmount = centsToYuan(debitCents);
      const debit = await tx.rewardAccount.updateMany({
        where: { id: accountId, balance: { gte: debitAmount } },
        data: { balance: { decrement: debitAmount } },
      });
      if (debit.count !== 1) {
        throw new ConflictException('待追偿奖励抵偿并发冲突，请重试');
      }
      accountBalances.set(accountId, availableCents - debitCents);
      recoveredCents += debitCents;
      if (recoveredCents === outstandingCents) break;
    }
    if (recoveredCents === 0) {
      remainingTotalCents += outstandingCents;
      continue;
    }

    const recoveredAmount = centsToYuan(recoveredCents);
    const remainingCents = outstandingCents - recoveredCents;
    const currentMeta = ledger.meta && typeof ledger.meta === 'object' && !Array.isArray(ledger.meta)
      ? ledger.meta
      : {};
    const priorRecoveredCents = yuanToCents(Number(currentMeta.recoveredAmount ?? 0));
    const ledgerCas = await tx.rewardLedger.updateMany({
      where: {
        id: ledger.id,
        status: 'RETURN_FROZEN',
        entryType: 'VOID',
        amount: ledger.amount,
      },
      data: {
        amount: remainingCents === 0 ? 0 : -centsToYuan(remainingCents),
        status: remainingCents === 0 ? 'VOIDED' : 'RETURN_FROZEN',
        meta: {
          ...currentMeta,
          clawbackStatus: remainingCents === 0 ? 'CLAWBACK_RECOVERED' : 'CLAWBACK_PENDING',
          recoveredAmount: centsToYuan(priorRecoveredCents + recoveredCents),
          recoveredAmountCents: priorRecoveredCents + recoveredCents,
          remainingClawbackAmount: centsToYuan(remainingCents),
          remainingClawbackCents: remainingCents,
          lastRecoveredAt: new Date().toISOString(),
        },
      },
    });
    if (ledgerCas.count !== 1) {
      throw new ConflictException('待追偿奖励状态已变更，请重试');
    }

    if (!platformAccount) {
      platformAccount = await tx.rewardAccount.upsert({
        where: { userId_type: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' } },
        update: {},
        create: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
        select: { id: true },
      });
    }
    const targetPlatformAccount = platformAccount as { id: string };
    await tx.rewardLedger.create({
      data: {
        accountId: targetPlatformAccount.id,
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount: recoveredAmount,
        status: 'AVAILABLE',
        refType: 'AFTER_SALE_CLAWBACK_RECOVERY',
        refId: ledger.refId,
        sourceLedgerId: ledger.id,
        idempotencyKey: `legacy-clawback-recovery:${ledger.id}:${outstandingCents}`,
        meta: {
          scheme: 'LEGACY_REFUND_CLAWBACK_RECOVERY',
          debtorUserId: userId,
          sourceClawbackLedgerId: ledger.id,
          recoveredAmount,
          remainingAmount: centsToYuan(remainingCents),
        },
      },
    });
    await tx.rewardAccount.update({
      where: { id: targetPlatformAccount.id },
      data: { balance: { increment: recoveredAmount } },
    });

    recoveredTotalCents += recoveredCents;
    remainingTotalCents += remainingCents;
  }

  return { recoveredCents: recoveredTotalCents, remainingCents: remainingTotalCents };
}
