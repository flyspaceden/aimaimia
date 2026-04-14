import { Injectable, Logger } from '@nestjs/common';
import { BonusConfig } from './bonus-config.service';
import { PLATFORM_USER_ID, NORMAL_SCHEMES } from './constants';
import { InboxService } from '../../inbox/inbox.service';

@Injectable()
export class NormalUpstreamService {
  private readonly logger = new Logger(NormalUpstreamService.name);

  constructor(private inboxService: InboxService) {}

  /**
   * 普通树上溯分配
   *
   * 流程：
   * 1. 记录有效消费 → k = prevCount + 1
   * 2. k > normalMaxLayers → 奖励归平台
   * 3. NormalProgress.selfPurchaseCount += 1
   * 4. 创建 NormalEligibleOrder(effectiveIndex=k)
   * 5. 递归 CTE 找 NormalTreeNode 第 k 个祖先
   * 6. 祖先不存在 / userId=null / 是 VIP → 奖励归平台
   * 7. 判断解锁：ancestor.selfPurchaseCount >= k ? AVAILABLE : FROZEN
   * 8. 创建 RewardLedger + 更新 RewardAccount
   * 9. 解锁买家自身冻结奖励
   *
   * @returns 分配结果
   */
  async distribute(
    tx: any,
    allocationId: string,
    orderId: string,
    userId: string,
    orderAmount: number,
    rewardPool: number,
    config: BonusConfig,
  ): Promise<{ result: 'distributed' | 'no_ancestor' | 'over_max_layers' | 'vip_excluded'; ancestorUserId: string | null }> {
    // 1. 查历史有效消费数
    const prevCount = await tx.normalEligibleOrder.count({
      where: { userId, valid: true },
    });
    const k = prevCount + 1;

    // 2. k > normalMaxLayers → 奖励归平台
    if (k > config.normalMaxLayers) {
      this.logger.log(
        `k=${k} > NORMAL_MAX_LAYERS=${config.normalMaxLayers}，奖励 ${rewardPool} 元归平台`,
      );
      await this.creditToPlatform(tx, allocationId, orderId, rewardPool, 'over_max_layers');
      // 仍做解锁检查（selfPurchaseCount 不递增）
      const currentProgress = await tx.normalProgress.findUnique({ where: { userId } });
      await this.unlockFrozenRewards(tx, userId, currentProgress?.selfPurchaseCount ?? 0);
      return { result: 'over_max_layers', ancestorUserId: null };
    }

    // 3. NormalProgress.selfPurchaseCount += 1
    const progress = await tx.normalProgress.update({
      where: { userId },
      data: { selfPurchaseCount: { increment: 1 } },
    });
    const newSelfPurchaseCount = progress.selfPurchaseCount;

    this.logger.log(
      `用户 ${userId} 第 ${k} 笔普通有效消费，selfPurchaseCount=${newSelfPurchaseCount}`,
    );

    // 4. 创建 NormalEligibleOrder
    await tx.normalEligibleOrder.create({
      data: {
        userId,
        orderId,
        amount: orderAmount,
        effectiveIndex: k,
        valid: true,
      },
    });

    // 5. 找第 k 个祖先
    const ancestor = await this.findKthAncestor(tx, userId, k);

    if (!ancestor) {
      this.logger.log(`用户 ${userId} 第 ${k} 个普通树祖先不存在，奖励归平台`);
      await this.creditToPlatform(tx, allocationId, orderId, rewardPool, 'no_ancestor');
      await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);
      return { result: 'no_ancestor', ancestorUserId: null };
    }

    // 6. 祖先校验
    const ancestorUserId = ancestor.userId;

    // 6a. 祖先是系统根节点（userId=null）→ 归平台
    if (!ancestorUserId) {
      this.logger.log(`第 ${k} 个普通树祖先是系统根节点，奖励归平台`);
      await this.creditToPlatform(tx, allocationId, orderId, rewardPool, 'system_root');
      await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);
      return { result: 'no_ancestor', ancestorUserId: null };
    }

    // 6b. 祖先是 VIP → 归平台（VIP/Normal 隔离）
    const ancestorMember = await tx.memberProfile.findUnique({
      where: { userId: ancestorUserId },
      select: { tier: true },
    });
    if (ancestorMember?.tier === 'VIP') {
      this.logger.log(`第 ${k} 个祖先 ${ancestorUserId} 是 VIP，奖励归平台`);
      await this.creditToPlatform(tx, allocationId, orderId, rewardPool, 'vip_excluded');
      await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);
      return { result: 'vip_excluded', ancestorUserId: null };
    }

    // 7. 判断解锁状态
    const ancestorProgress = await tx.normalProgress.findUnique({
      where: { userId: ancestorUserId },
    });
    const ancestorSelfCount = ancestorProgress?.selfPurchaseCount ?? 0;

    // selfPurchaseCount >= k → AVAILABLE，否则 RETURN_FROZEN（售后保护期冻结）
    const isUnlocked = ancestorSelfCount >= k;
    const status = isUnlocked ? 'AVAILABLE' : 'RETURN_FROZEN';
    const entryType = isUnlocked ? 'RELEASE' : 'FREEZE';

    this.logger.log(
      `祖先 ${ancestorUserId}（level ${ancestor.level}）selfPurchaseCount=${ancestorSelfCount}，k=${k} → ${status}`,
    );

    // 确保祖先有 NORMAL_REWARD 账户
    const account = await this.ensureNormalRewardAccount(tx, ancestorUserId);

    // 8. 创建 RewardLedger
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
          scheme: 'NORMAL_TREE',
          sourceOrderId: orderId,
          sourceUserId: userId,
          effectiveIndex: k,
          ancestorLevel: ancestor.level,
          ancestorNodeId: ancestor.id,
          locked: !isUnlocked,
          requiredLevel: isUnlocked ? undefined : k,
          expiresAt: isUnlocked
            ? undefined
            : new Date(Date.now() + config.normalFreezeDays * 86400000).toISOString(),
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

    // 9. 解锁检查：买家自身 selfPurchaseCount 增加，可能释放冻结奖励
    await this.unlockFrozenRewards(tx, userId, newSelfPurchaseCount);

    this.logger.log(
      `普通树上溯完成：${rewardPool} 元 → 祖先 ${ancestorUserId}（${status}）`,
    );

    return { result: 'distributed', ancestorUserId };
  }

  /**
   * 沿 parentId 向上找第 k 个祖先（递归 CTE，单次查询）
   */
  private async findKthAncestor(
    tx: any,
    userId: string,
    k: number,
  ): Promise<any | null> {
    // 找到买家的 NormalTreeNode
    const member = await tx.memberProfile.findUnique({
      where: { userId },
      select: { normalTreeNodeId: true },
    });

    if (!member?.normalTreeNodeId) {
      this.logger.warn(
        `普通树深度不足: userId=${userId}, 需要层级=${k}, 无 NormalTreeNode`,
      );
      return null;
    }

    const startId = member.normalTreeNodeId;
    const ancestors = await tx.$queryRaw`
      WITH RECURSIVE ancestors AS (
        SELECT id, "rootId", "userId", "parentId", level, position, "childrenCount", "createdAt", 0 AS depth,
               ARRAY[id]::text[] AS path
        FROM "NormalTreeNode" WHERE id = ${startId}
        UNION ALL
        SELECT ntn.id, ntn."rootId", ntn."userId", ntn."parentId", ntn.level, ntn.position, ntn."childrenCount", ntn."createdAt", a.depth + 1,
               a.path || ntn.id
        FROM "NormalTreeNode" ntn
        JOIN ancestors a ON ntn.id = a."parentId"
        WHERE a.depth < ${k}
          AND NOT (ntn.id = ANY(a.path))
      )
      SELECT id, "rootId", "userId", "parentId", level, position, "childrenCount", "createdAt"
      FROM ancestors WHERE depth = ${k} LIMIT 1
    `;

    const result = (ancestors as any[])?.[0];
    if (!result) {
      this.logger.warn(
        `普通树深度不足: userId=${userId}, 需要层级=${k}, CTE 未找到第 ${k} 层祖先`,
      );
      return null;
    }

    return result;
  }

  /**
   * 释放冻结奖励：当用户 selfPurchaseCount 增加到 newLevel 时，
   * 释放其名下 scheme='NORMAL_TREE' 且 meta.requiredLevel <= newLevel 的冻结奖励
   */
  async unlockFrozenRewards(
    tx: any,
    ancestorUserId: string,
    newLevel: number,
  ): Promise<number> {
    // 查找 NORMAL_TREE 冻结奖励
    const frozenLedgers = await tx.rewardLedger.findMany({
      where: {
        userId: ancestorUserId,
        status: 'FROZEN',
        entryType: 'FREEZE',
      },
    });

    // 过滤需要释放的（普通奖励 scheme 且 requiredLevel <= newLevel）
    const toRelease = frozenLedgers.filter((l: any) => {
      const meta = l.meta as any;
      return (NORMAL_SCHEMES as readonly string[]).includes(meta?.scheme) && meta?.requiredLevel && meta.requiredLevel <= newLevel;
    });

    if (toRelease.length === 0) return 0;

    // 批量更新
    const ids = toRelease.map((l: any) => l.id);
    await tx.rewardLedger.updateMany({
      where: {
        id: { in: ids },
        status: 'FROZEN',
        entryType: 'FREEZE',
      },
      data: { status: 'AVAILABLE', entryType: 'RELEASE' },
    });
    const totalReleased = toRelease.reduce((sum: number, l: any) => sum + l.amount, 0);

    // 更新 RewardAccount：frozen → balance
    if (totalReleased > 0) {
      const account = await this.ensureNormalRewardAccount(tx, ancestorUserId);
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

      this.logger.log(
        `释放普通树冻结奖励：用户 ${ancestorUserId}，${toRelease.length} 笔共 ${totalReleased} 元`,
      );
    }

    return totalReleased;
  }

  /**
   * 奖励归平台：创建 PLATFORM_PROFIT ledger
   */
  async creditToPlatform(
    tx: any,
    allocationId: string,
    orderId: string,
    amount: number,
    reason: string,
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
          scheme: 'NORMAL_TREE_FALLBACK',
          reason,
          sourceOrderId: orderId,
        },
      },
    });

    await tx.rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount } },
    });

    this.logger.log(`普通树奖励归平台：${amount} 元，原因=${reason}`);
  }

  /** 确保用户有 NORMAL_REWARD 类型的 RewardAccount */
  async ensureNormalRewardAccount(tx: any, userId: string) {
    let account = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
    });

    if (!account) {
      account = await tx.rewardAccount.create({
        data: { userId, type: 'NORMAL_REWARD' },
      });
    }

    return account;
  }
}
