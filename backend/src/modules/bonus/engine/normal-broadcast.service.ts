import { Injectable, Logger } from '@nestjs/common';
import { BonusConfig } from './bonus-config.service';
import { PLATFORM_USER_ID } from './constants';

@Injectable()
export class NormalBroadcastService {
  private readonly logger = new Logger(NormalBroadcastService.name);

  /**
   * 普通广播分配（滑动窗口模型）
   *
   * 流程：
   * 1. 根据订单金额匹配桶
   * 2. 订单加入队列
   * 3. 取前面 X 笔订单
   * 4. 等额分配 rewardPool
   *
   * @param tx Prisma 事务客户端
   * @param allocationId 父 RewardAllocation ID
   * @param orderId 触发订单 ID
   * @param userId 买家 ID
   * @param orderAmount 订单金额
   * @param rewardPool 奖励池金额
   * @param config 分润配置
   * @returns 实际分配的奖励总额（可能因无受益人而为 0）
   */
  async distribute(
    tx: any,
    allocationId: string,
    orderId: string,
    userId: string,
    orderAmount: number,
    rewardPool: number,
    config: BonusConfig,
  ): Promise<number> {
    // 1. 确定 bucketKey
    const bucketKey = this.determineBucketKey(orderAmount, config.bucketRanges);
    this.logger.log(`订单 ${orderId} 金额 ${orderAmount} → 桶 ${bucketKey}`);

    // 2. 查找或创建桶
    const bucket = await this.findOrCreateBucket(tx, bucketKey, config.ruleVersion);

    // 3. 订单加入队列（幂等：如已加入则跳过）
    const queueMember = await this.joinQueue(tx, bucket.id, userId, orderId);

    // 4. 滑动窗口：取当前订单前面的 X 笔订单
    const beneficiaries = await tx.normalQueueMember.findMany({
      where: {
        bucketId: bucket.id,
        active: true,
        joinedAt: { lt: queueMember.joinedAt },
      },
      orderBy: { joinedAt: 'asc' }, // FIFO：最早加入队列的优先获得奖励
      take: config.normalBroadcastX,
      select: { id: true, userId: true, orderId: true },
    });

    // 5. 分配奖励
    if (beneficiaries.length === 0) {
      this.logger.log(`订单 ${orderId} 桶 ${bucketKey} 前面无订单，rewardPool 归入平台`);
      // P1-5: rewardPool 归入平台账户
      await this.creditToPlatform(tx, allocationId, orderId, rewardPool, bucketKey);
      return 0;
    }

    const perAmount = this.round2(rewardPool / beneficiaries.length);
    // 余额分给最后一位受益人，避免四舍五入精度丢失
    const remainder = this.round2(rewardPool - perAmount * beneficiaries.length);
    let totalDistributed = 0;

    for (let i = 0; i < beneficiaries.length; i++) {
      const ben = beneficiaries[i];
      const isLast = i === beneficiaries.length - 1;
      const amount = isLast ? perAmount + remainder : perAmount;

      // 确保受益者有 RewardAccount
      const account = await this.ensureRewardAccount(tx, ben.userId);

      // 创建 RewardLedger
      await tx.rewardLedger.create({
        data: {
          allocationId,
          accountId: account.id,
          userId: ben.userId,
          entryType: 'RELEASE',
          amount,
          status: 'AVAILABLE',
          refType: 'ORDER',
          refId: orderId,
          meta: {
            scheme: 'NORMAL_BROADCAST',
            sourceOrderId: orderId,
            sourceUserId: userId,
            bucketKey,
            beneficiaryOrderId: ben.orderId,
            windowSize: beneficiaries.length,
            perAmount: amount,
            rewardPool,
          },
        },
      });

      // 更新余额
      await tx.rewardAccount.update({
        where: { id: account.id },
        data: { balance: { increment: amount } },
      });

      totalDistributed += amount;
    }

    // 设置买家 normalEligible（首次参与普通奖励标记）
    await tx.memberProfile.upsert({
      where: { userId },
      create: { userId, normalEligible: true },
      update: { normalEligible: true },
    });

    this.logger.log(
      `订单 ${orderId} 普通广播完成：${beneficiaries.length} 人各获 ${perAmount} 元，共 ${totalDistributed} 元`,
    );

    return totalDistributed;
  }

  /** 根据订单金额确定桶 key */
  private determineBucketKey(
    amount: number,
    ranges: [number, number | null][],
  ): string {
    for (const [low, high] of ranges) {
      if (amount >= low && (high === null || amount < high)) {
        return high === null ? `${low}-INF` : `${low}-${high}`;
      }
    }
    // 兜底：放入最大桶
    const last = ranges[ranges.length - 1];
    return last[1] === null ? `${last[0]}-INF` : `${last[0]}-${last[1]}`;
  }

  /** 查找或创建桶 */
  private async findOrCreateBucket(
    tx: any,
    bucketKey: string,
    ruleVersion: string,
  ) {
    let bucket = await tx.normalBucket.findUnique({
      where: { bucketKey },
    });

    if (!bucket) {
      bucket = await tx.normalBucket.create({
        data: { bucketKey, ruleVersion },
      });
      this.logger.log(`创建新桶: ${bucketKey}`);
    }

    return bucket;
  }

  /** 订单加入队列（幂等） */
  private async joinQueue(
    tx: any,
    bucketId: string,
    userId: string,
    orderId: string,
  ) {
    // 检查该订单是否已在队列中
    const existing = await tx.normalQueueMember.findFirst({
      where: { bucketId, orderId },
    });

    if (existing) return existing;

    return tx.normalQueueMember.create({
      data: {
        bucketId,
        userId,
        orderId,
        joinedAt: new Date(),
        active: true,
      },
    });
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

  /** P1-5: 空桶 rewardPool 归入平台利润账户 */
  private async creditToPlatform(
    tx: any,
    allocationId: string,
    orderId: string,
    rewardPool: number,
    bucketKey: string,
  ) {
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
        amount: rewardPool,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: orderId,
        meta: {
          scheme: 'NORMAL_BROADCAST_EMPTY',
          reason: '空桶无受益人，rewardPool 归平台',
          bucketKey,
        },
      },
    });

    await tx.rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: rewardPool } },
    });
  }

  /** 四舍五入到分 */
  private round2(val: number): number {
    return Math.round(val * 100) / 100;
  }
}
