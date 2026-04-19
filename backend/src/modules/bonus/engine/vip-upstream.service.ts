import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfig } from './bonus-config.service';
import { PLATFORM_USER_ID } from './constants';
import { InboxService } from '../../inbox/inbox.service';

@Injectable()
export class VipUpstreamService {
  private readonly logger = new Logger(VipUpstreamService.name);

  constructor(
    private prisma: PrismaService,
    private inboxService: InboxService,
  ) {}

  /**
   * VIP 上溯分配
   *
   * 流程：
   * 1. 记录有效消费 → effectiveIndex = k
   * 2. VipProgress.selfPurchaseCount += 1
   * 3. 找第 k 个祖先
   * 4. 检查祖先解锁状态 → AVAILABLE 或 FROZEN
   * 5. 创建 RewardLedger + 更新 RewardAccount
   * 6. 解锁检查：买家自己的 selfPurchaseCount 增加，可能释放冻结奖励
   *
   * @returns { result, ancestorUserId }
   */
  async distribute(
    tx: any,
    allocationId: string,
    orderId: string,
    userId: string,
    orderAmount: number,
    rewardPool: number,
    config: BonusConfig,
  ): Promise<{ result: 'distributed' | 'no_ancestor' | 'downgrade_normal'; ancestorUserId: string | null }> {
    // 1. 记录有效消费
    const prevCount = await tx.vipEligibleOrder.count({
      where: { userId, valid: true },
    });
    const effectiveIndex = prevCount + 1; // k

    await tx.vipEligibleOrder.create({
      data: {
        userId,
        orderId,
        amount: orderAmount,
        qualifies: true,
        effectiveIndex,
        valid: true,
      },
    });

    // 2. 检查 k 是否超过 VIP_MAX_LAYERS（在递增 selfPurchaseCount 之前判定）
    if (effectiveIndex > config.vipMaxLayers) {
      this.logger.log(
        `k=${effectiveIndex} > VIP_MAX_LAYERS=${config.vipMaxLayers}，降级为普通广播`,
      );
      // 降级路径不递增 selfPurchaseCount，用当前值做解锁检查
      const currentProgress = await tx.vipProgress.findUnique({ where: { userId } });
      await this.unlockFrozenRewards(tx, userId, currentProgress?.selfPurchaseCount ?? 0);
      return { result: 'downgrade_normal', ancestorUserId: null };
    }

    // 3. 非降级路径：VipProgress.selfPurchaseCount += 1
    const vipProgress = await tx.vipProgress.update({
      where: { userId },
      data: { selfPurchaseCount: { increment: 1 } },
    });
    const newSelfPurchaseCount = vipProgress.selfPurchaseCount;

    this.logger.log(
      `用户 ${userId} 第 ${effectiveIndex} 笔有效消费（k=${effectiveIndex}），selfPurchaseCount=${newSelfPurchaseCount}`,
    );

    // 4. 找第 k 个祖先
    const ancestor = await this.findKthAncestor(tx, userId, effectiveIndex);

    if (!ancestor) {
      this.logger.log(
        `用户 ${userId} 第 ${effectiveIndex} 个祖先不存在，rewardPool 归平台`,
      );
      // H6修复：创建平台收入流水记录，消除会计缺口
      await this.creditToPlatform(tx, allocationId, orderId, rewardPool, 'no_ancestor', {
        sourceUserId: userId,
        effectiveIndex,
      });
      // 解锁检查
      await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);
      return { result: 'no_ancestor', ancestorUserId: null };
    }

    // 5. 检查祖先解锁状态
    const ancestorUserId = ancestor.userId;
    if (!ancestorUserId) {
      // 祖先是系统节点（A1-A10），无用户，归平台
      this.logger.log(`第 ${effectiveIndex} 个祖先是系统节点，rewardPool 归平台`);
      // H6修复：创建平台收入流水记录，消除会计缺口
      await this.creditToPlatform(tx, allocationId, orderId, rewardPool, 'system_root', {
        sourceUserId: userId,
        effectiveIndex,
        ancestorNodeId: ancestor.id,
      });
      await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);
      return { result: 'no_ancestor', ancestorUserId: null };
    }

    const ancestorProgress = await tx.vipProgress.findUnique({
      where: { userId: ancestorUserId },
    });
    const ancestorSelfCount = ancestorProgress?.selfPurchaseCount ?? 0;

    // selfPurchaseCount >= k → AVAILABLE，否则 RETURN_FROZEN（售后保护期冻结）
    const isUnlocked = ancestorSelfCount >= effectiveIndex;
    const status = isUnlocked ? 'AVAILABLE' : 'RETURN_FROZEN';
    const entryType = isUnlocked ? 'RELEASE' : 'FREEZE';

    this.logger.log(
      `祖先 ${ancestorUserId}（level ${ancestor.level}）selfPurchaseCount=${ancestorSelfCount}，k=${effectiveIndex} → ${status}`,
    );

    // 确保祖先有 RewardAccount
    const account = await this.ensureRewardAccount(tx, ancestorUserId);

    // 创建 RewardLedger
    await tx.rewardLedger.create({
      data: {
        allocationId,
        accountId: account.id,
        userId: ancestorUserId,
        entryType,
        amount: rewardPool,
        status,
        refType: 'ORDER',
        refId: orderId,
        meta: {
          scheme: 'VIP_UPSTREAM',
          sourceOrderId: orderId,
          sourceUserId: userId,
          effectiveIndex,
          ancestorLevel: ancestor.level,
          ancestorNodeId: ancestor.id,
          locked: !isUnlocked,
          requiredLevel: isUnlocked ? undefined : effectiveIndex,
          expiresAt: isUnlocked
            ? undefined
            : new Date(Date.now() + config.vipFreezeDays * 86400000).toISOString(),
        },
      },
    });

    // 更新 RewardAccount
    // RETURN_FROZEN 状态对用户不可见，不计入账户 frozen（待 RETURN_FROZEN→FROZEN 时再计入）
    if (isUnlocked) {
      await tx.rewardAccount.update({
        where: { id: account.id },
        data: { balance: { increment: rewardPool } },
      });

      // C12: 分润到账通知
      setImmediate(() => {
        this.inboxService.send({
          userId: ancestorUserId,
          category: 'transaction',
          type: 'reward_credited',
          title: '分润奖励到账',
          content: `您收到 ${rewardPool.toFixed(2)} 元消费奖励，已到账可提现。`,
          target: { route: '/wallet' },
        }).catch(() => {});
      });
    }
    // RETURN_FROZEN: 不更新 RewardAccount（对用户完全不可见）

    // 7. 解锁检查：买家自身 selfPurchaseCount 增加，可能有下级冻结奖励等待释放
    await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);

    this.logger.log(
      `VIP 上溯完成：${rewardPool} 元 → 祖先 ${ancestorUserId}（${status}）`,
    );

    return { result: 'distributed', ancestorUserId };
  }

  /**
   * 沿 parentId 向上找第 k 个祖先（递归 CTE，单次查询替代 k 次循环）
   * M02 修复：当树深度不足时记录日志，明确差额归入平台池
   */
  private async findKthAncestor(
    tx: any,
    userId: string,
    k: number,
  ): Promise<any | null> {
    // 找到买家的 VipTreeNode
    const member = await tx.memberProfile.findUnique({
      where: { userId },
      select: { vipNodeId: true },
    });

    if (!member?.vipNodeId) {
      this.logger.warn(
        `VIP 树深度不足: userId=${userId}, 需要层级=${k}, 实际到达层级=0（无 VipTreeNode），差额归入平台池`,
      );
      return null;
    }

    // 递归 CTE：一次查询找到第 k 个祖先（替代原先 k 次 findUnique 循环）
    // M11修复：增加 path 去环，防止脏数据 parentId 环路导致返回错误祖先
    const startId = member.vipNodeId;
    const ancestors = await tx.$queryRaw`
      WITH RECURSIVE ancestors AS (
        SELECT id, "rootId", "userId", "parentId", level, position, "childrenCount", "createdAt", 0 AS depth,
               ARRAY[id]::text[] AS path
        FROM "VipTreeNode" WHERE id = ${startId}
        UNION ALL
        SELECT vtn.id, vtn."rootId", vtn."userId", vtn."parentId", vtn.level, vtn.position, vtn."childrenCount", vtn."createdAt", a.depth + 1,
               a.path || vtn.id
        FROM "VipTreeNode" vtn
        JOIN ancestors a ON vtn.id = a."parentId"
        WHERE a.depth < ${k}::int
          AND NOT (vtn.id = ANY(a.path))
      )
      SELECT id, "rootId", "userId", "parentId", level, position, "childrenCount", "createdAt"
      FROM ancestors WHERE depth = ${k}::int LIMIT 1
    `;

    const result = (ancestors as any[])?.[0];
    if (!result) {
      // M02: 树深度不足，记录日志
      this.logger.warn(
        `VIP 树深度不足: userId=${userId}, 需要层级=${k}, CTE 未找到第 ${k} 层祖先，差额归入平台池`,
      );
      return null;
    }

    return result;
  }

  /**
   * 释放冻结奖励：当用户 selfPurchaseCount 增加到 newLevel 时，
   * 释放其名下 meta.requiredLevel <= newLevel 的冻结奖励
   */
  async unlockFrozenRewards(
    tx: any,
    ancestorUserId: string,
    newLevel: number,
  ): Promise<number> {
    // 查找冻结的 VIP 奖励
    const frozenLedgers = await tx.rewardLedger.findMany({
      where: {
        userId: ancestorUserId,
        status: 'FROZEN',
        entryType: 'FREEZE',
      },
    });

    // 过滤需要释放的（scheme='VIP_UPSTREAM' 且 requiredLevel <= newLevel）
    // 安全修复：按 scheme 过滤，防止 VIP 解锁时误释放 NORMAL_TREE 冻结奖励
    const toRelease = frozenLedgers.filter((l: any) => {
      const meta = l.meta as any;
      return meta?.scheme === 'VIP_UPSTREAM' && meta?.requiredLevel && meta.requiredLevel <= newLevel;
    });

    if (toRelease.length === 0) return 0;

    // 批量更新替代循环（N 次→1 次）
    const ids = toRelease.map((l: any) => l.id);
    await tx.rewardLedger.updateMany({
      where: {
        id: { in: ids },
        status: 'FROZEN',      // S18修复：限定来源状态
        entryType: 'FREEZE',   // S18修复：限定来源 entryType
      },
      data: { status: 'AVAILABLE', entryType: 'RELEASE' },
    });
    const totalReleased = toRelease.reduce((sum: number, l: any) => sum + l.amount, 0);

    // 更新 RewardAccount：frozen → balance
    if (totalReleased > 0) {
      const account = await this.ensureRewardAccount(tx, ancestorUserId);
      await tx.rewardAccount.update({
        where: { id: account.id },
        data: {
          balance: { increment: totalReleased },
          frozen: { decrement: totalReleased },
        },
      });

      // C12: 奖励解冻通知
      setImmediate(() => {
        this.inboxService.send({
          userId: ancestorUserId,
          category: 'transaction',
          type: 'reward_unfrozen',
          title: '奖励已解锁',
          content: `您有 ${totalReleased.toFixed(2)} 元奖励已解锁，可提现。`,
          target: { route: '/wallet' },
        }).catch(() => {});
      });

      // P1-6: 更新 VipProgress.unlockedLevel
      await tx.vipProgress.updateMany({
        where: { userId: ancestorUserId, unlockedLevel: { lt: newLevel } },
        data: { unlockedLevel: newLevel },
      });

      this.logger.log(
        `释放冻结奖励：用户 ${ancestorUserId}，${toRelease.length} 笔共 ${totalReleased} 元，unlockedLevel→${newLevel}`,
      );
    }

    return totalReleased;
  }

  /**
   * 出局判定（异步，不在主事务中）
   *
   * H11修复：使用独立 Serializable 事务 + CAS 保护，防止并发更新 exitedAt。
   * 包含 P2034 重试逻辑。
   *
   * 检查祖先在每层（1~VIP_MAX_LAYERS）已收到的奖励数量，
   * 若所有层都已满（received >= 3^k），标记 exitedAt
   */
  async checkExit(ancestorUserId: string, config: BonusConfig): Promise<void> {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // CAS：在事务内读取最新状态
          const vipProgress = await tx.vipProgress.findUnique({
            where: { userId: ancestorUserId },
          });

          // 已退出则跳过
          if (!vipProgress || vipProgress.exitedAt) return;

          // 查询该祖先收到的所有 VIP_UPSTREAM 奖励
          const ledgers = await tx.rewardLedger.findMany({
            where: {
              userId: ancestorUserId,
              status: { in: ['AVAILABLE', 'FROZEN', 'RETURN_FROZEN'] },
            },
            select: { meta: true },
          });

          // 按 effectiveIndex（层级）分组计数
          const layerCounts = new Map<number, number>();
          for (const l of ledgers) {
            const meta = l.meta as any;
            if (meta?.scheme !== 'VIP_UPSTREAM') continue;
            const idx = meta.effectiveIndex as number;
            if (idx && idx >= 1 && idx <= config.vipMaxLayers) {
              layerCounts.set(idx, (layerCounts.get(idx) ?? 0) + 1);
            }
          }

          // 检查每一层是否都满了
          let allFull = true;
          for (let k = 1; k <= config.vipMaxLayers; k++) {
            const capacity = Math.pow(config.vipBranchFactor, k); // 3^k
            const received = layerCounts.get(k) ?? 0;
            if (received < capacity) {
              allFull = false;
              break;
            }
          }

          if (allFull) {
            // CAS：仅当 exitedAt 仍为 null 时才更新
            await tx.vipProgress.updateMany({
              where: { userId: ancestorUserId, exitedAt: null },
              data: { exitedAt: new Date() },
            });
            this.logger.log(`用户 ${ancestorUserId} 已出局：${config.vipMaxLayers} 层全部满员`);
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        return; // 成功则退出重试循环
      } catch (err: any) {
        // P2034: Serializable 序列化冲突，重试
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(`出局判定序列化冲突，重试 attempt=${attempt + 1}: userId=${ancestorUserId}`);
          continue;
        }
        this.logger.error(`出局判定失败（${ancestorUserId}）: ${(err as Error).message}`);
        return; // 非重试错误也不抛出，保持原有的容错行为
      }
    }
  }

  /**
   * H6修复：VIP rewardPool 归平台时创建 PLATFORM_PROFIT 流水记录
   *
   * 当 VIP 上溯遇到祖先不存在（树深度不足）或祖先是系统根节点（A1-A10）时，
   * rewardPool 归入平台。此方法确保每笔归平台的金额都有对应的 RewardLedger 记录，
   * 消除会计缺口。模式参考 NormalUpstreamService.creditToPlatform。
   *
   * @param tx 事务上下文
   * @param allocationId 父 RewardAllocation ID
   * @param orderId 触发订单 ID
   * @param amount 归平台金额
   * @param reason 归平台原因（如 'no_ancestor', 'system_root'）
   * @param extraMeta 额外元数据（sourceUserId, effectiveIndex 等）
   */
  async creditToPlatform(
    tx: any,
    allocationId: string,
    orderId: string,
    amount: number,
    reason: string,
    extraMeta: Record<string, any> = {},
  ): Promise<void> {
    if (amount <= 0) return;

    // 确保平台的 PLATFORM_PROFIT 账户存在
    let account = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' } },
    });
    if (!account) {
      account = await tx.rewardAccount.create({
        data: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
      });
    }

    await tx.rewardLedger.create({
      data: {
        allocationId,
        accountId: account.id,
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: orderId,
        meta: {
          scheme: 'VIP_UPSTREAM_FALLBACK',
          reason,
          sourceOrderId: orderId,
          ...extraMeta,
        },
      },
    });

    await tx.rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount } },
    });

    this.logger.log(`VIP 奖励归平台：${amount} 元，原因=${reason}`);
  }

  /** 确保用户有 VIP_REWARD 类型的 RewardAccount */
  private async ensureRewardAccount(tx: any, userId: string) {
    let account = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'VIP_REWARD' } },
    });

    if (!account) {
      account = await tx.rewardAccount.create({
        data: { userId, type: 'VIP_REWARD' },
      });
    }

    return account;
  }
}
