import { ConflictException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

/**
 * 账号注销与买家写操作共享的事务级隔离屏障。
 *
 * 调用方必须处于 Serializable 事务内，并在任何业务写入、资金预留或
 * 第三方支付单落库之前调用。注销与普通写操作使用完全相同的 lock key：
 *
 * - 写操作先拿锁并提交：注销随后会看到新的 blocker；
 * - 注销先拿锁并提交：写操作随后在事务内看到 DELETED 并失败。
 */
export async function acquireUserWriteLock(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`AD-${userId}`}))`;
}

export async function isActiveUserInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  // FOR UPDATE 不只是行锁：如果 Serializable 事务的旧快照之后该用户已被
  // 注销事务更新，PostgreSQL 会返回 serialization failure，防止调用方在
  // 旧 ACTIVE 快照上继续记账。
  const rows = await tx.$queryRaw<Array<{
    status: UserStatus;
    deletionExecutedAt: Date | null;
  }>>`
    SELECT "status", "deletionExecutedAt"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;
  const user = rows[0];
  return Boolean(
    user
      && user.status === UserStatus.ACTIVE
      && !user.deletionExecutedAt,
  );
}

export async function assertActiveUserWriteBarrier(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await acquireUserWriteLock(tx, userId);
  if (!(await isActiveUserInTransaction(tx, userId))) {
    throw new ConflictException({
      code: 'USER_NOT_ACTIVE',
      message: '账号已注销或当前状态不允许继续操作',
    });
  }
}
