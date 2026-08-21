import { ConflictException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

/** 账号注销与认证写入共用的事务级用户锁。 */
export async function acquireUserWriteLock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`AD-${userId}`}))`;
}

export async function assertActiveUserWriteBarrier(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await acquireUserWriteLock(tx, userId);
  const rows = await tx.$queryRaw<Array<{ status: UserStatus; deletionExecutedAt: Date | null }>>`
    SELECT "status", "deletionExecutedAt" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  if (!rows[0] || rows[0].status !== UserStatus.ACTIVE || rows[0].deletionExecutedAt) {
    throw new ConflictException({ code: 'USER_NOT_ACTIVE', message: '账号已注销或当前状态不允许继续操作' });
  }
}
