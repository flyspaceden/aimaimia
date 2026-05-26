import { PrismaService } from '../../prisma/prisma.service';

export type AvatarSource = 'UPLOAD' | 'WECHAT';

/**
 * 写入头像历史。逻辑：
 * - 空 url / preset:// 头像跳过（preset 在前端 grid 里本来就能选）
 * - 与最近一条相同跳过（防重复入库）
 * - 写入后清理：每用户仅保留最近 5 条
 *
 * 并发安全：整体走 Serializable 事务 + 用户级 advisory lock，避免快速重复保存导致
 * 「check + insert + prune」交错，出现重复 url 入库或历史超过 5 条。
 *
 * 调用点：
 * - updateProfile（用户上传 / 切换头像）
 * - syncWechatAvatar（手动同步微信头像）
 * - 微信首次登录创建账号时（首张微信头像入库）
 */
export async function recordAvatarHistory(
  prisma: PrismaService,
  userId: string,
  url: string,
  source: AvatarSource,
): Promise<void> {
  if (!url || url.startsWith('preset://')) return;

  await prisma.$transaction(
    async (tx) => {
      // 用户级 advisory lock，把同一用户的所有 recordAvatarHistory 串行化
      // hashtext(userId) 落入 pg_advisory_xact_lock 的 bigint 空间，事务结束自动释放
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
        `avatar-history:${userId}`,
      );

      const latest = await tx.avatarHistory.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { url: true },
      });
      if (latest?.url === url) return;

      await tx.avatarHistory.create({
        data: { userId, url, source },
      });

      // 保留最近 5 条，删旧
      const overflow = await tx.avatarHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: 5,
        select: { id: true },
      });
      if (overflow.length > 0) {
        await tx.avatarHistory.deleteMany({
          where: { id: { in: overflow.map((a) => a.id) } },
        });
      }
    },
    { isolationLevel: 'Serializable' },
  );
}

/** 列出最近 5 条头像历史（按时间倒序） */
export async function listAvatarHistory(prisma: PrismaService, userId: string) {
  return prisma.avatarHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, url: true, source: true, createdAt: true },
  });
}
