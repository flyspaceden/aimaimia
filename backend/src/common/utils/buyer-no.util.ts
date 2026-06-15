import { Prisma } from '@prisma/client';

export const BUYER_NO_PREFIX = 'AIMM';
export const BUYER_NO_DIGITS = 14;
export const BUYER_NO_MAX = 99_999_999_999_999;
export const BUYER_NO_REGEX = /^AIMM\d{14}$/;
export const BUYER_NO_LOCK_NAMESPACE = 0x41494d4d; // AIMM
export const BUYER_NO_LOCK_KEY = 0x42594e4f; // BYNO

type BuyerNoSequenceTx = {
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Promise<T>;
};

type BuyerNoLockTx = {
  $executeRaw(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Promise<number>;
};

type BuyerNoResolveTx = {
  user: {
    findUnique(args: { where: { buyerNo: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
};

export function formatBuyerNo(value: number | bigint): string {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1 || n > BUYER_NO_MAX) {
    throw new Error('buyerNo sequence out of range');
  }
  return `${BUYER_NO_PREFIX}${String(n).padStart(BUYER_NO_DIGITS, '0')}`;
}

export function normalizeBuyerNo(value: string): string {
  return value.trim().toUpperCase();
}

export function isBuyerNo(value: string | null | undefined): boolean {
  if (!value) return false;
  return BUYER_NO_REGEX.test(normalizeBuyerNo(value));
}

export async function acquireBuyerNoSequenceLock(tx: BuyerNoLockTx): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(${BUYER_NO_LOCK_NAMESPACE}::int, ${BUYER_NO_LOCK_KEY}::int)
  `;
}

export async function nextBuyerNo(tx: BuyerNoSequenceTx): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ nextval: bigint | number | string }>>`
    WITH buyer_no_lock AS (
      SELECT pg_advisory_xact_lock(${BUYER_NO_LOCK_NAMESPACE}::int, ${BUYER_NO_LOCK_KEY}::int)
    )
    SELECT nextval('buyer_no_seq') AS nextval
    FROM buyer_no_lock
  `;
  const raw = rows[0]?.nextval;
  return formatBuyerNo(typeof raw === 'bigint' ? raw : Number(raw));
}

export async function resolveBuyerUserId<T extends BuyerNoResolveTx>(
  tx: T,
  userIdOrBuyerNo: string,
): Promise<string> {
  const normalized = normalizeBuyerNo(userIdOrBuyerNo);
  if (!isBuyerNo(normalized)) return userIdOrBuyerNo;
  const user = await tx.user.findUnique({
    where: { buyerNo: normalized },
    select: { id: true },
  });
  return user?.id ?? userIdOrBuyerNo;
}
