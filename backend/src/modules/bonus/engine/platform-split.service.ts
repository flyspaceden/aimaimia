import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_USER_ID } from './constants';

/** 平台分润的三个账户类型 */
const SPLIT_ACCOUNTS = [
  { type: 'PLATFORM_PROFIT' as const, field: 'platformPool' as const, label: '平台利润' },
  { type: 'FUND_POOL' as const, field: 'fundPool' as const, label: '基金池' },
  { type: 'POINTS' as const, field: 'pointsPool' as const, label: '积分池' },
];

@Injectable()
export class PlatformSplitService {
  private readonly logger = new Logger(PlatformSplitService.name);

  /**
   * 平台分润：将 rebatePool 中的平台/基金/积分部分入账
   *
   * @param tx Prisma 事务客户端
   * @param allocationId 父 RewardAllocation ID
   * @param orderId 触发订单 ID
   * @param pools 各池金额（platformPool / fundPool / pointsPool）
   */
  async split(
    tx: any,
    allocationId: string,
    orderId: string,
    pools: { platformPool: number; fundPool: number; pointsPool: number },
  ): Promise<void> {
    for (const { type, field, label } of SPLIT_ACCOUNTS) {
      const amount = pools[field];
      if (amount <= 0) continue;

      // 确保平台账户存在
      const account = await this.ensurePlatformAccount(tx, type);

      // 创建 RewardLedger 流水
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
            scheme: 'PLATFORM_SPLIT',
            accountType: type,
            sourceOrderId: orderId,
          },
        },
      });

      // 更新余额
      await tx.rewardAccount.update({
        where: { id: account.id },
        data: { balance: { increment: amount } },
      });

      this.logger.log(`${label}入账：${amount} 元`);
    }
  }

  /** 确保平台账户存在 */
  private async ensurePlatformAccount(tx: any, type: string) {
    let account = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId: PLATFORM_USER_ID, type } },
    });

    if (!account) {
      account = await tx.rewardAccount.create({
        data: { userId: PLATFORM_USER_ID, type },
      });
    }

    return account;
  }
}
