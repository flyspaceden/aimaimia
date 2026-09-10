import { IndustryFundService } from '../../fund-ledger/industry-fund.service';
import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_USER_ID } from './constants';

/** VIP平台分割的 5 个池（奖励由 VipUpstreamService 处理） */
interface VipPlatformPools {
  platformProfit: number;
  industryFund: number;
  charityFund: number;
  techFund: number;
  reserveFund: number;
}

@Injectable()
export class VipPlatformSplitService {
  private readonly logger = new Logger(VipPlatformSplitService.name);

  constructor(private readonly industryFund: IndustryFundService) {}

  /**
   * VIP平台分割：处理除奖励外的 5 个池
   *
   * - PLATFORM_PROFIT → 平台用户账户
   * - INDUSTRY_FUND → 平台暂存，按公司记入独立账本
   * - CHARITY_FUND → 平台账户
   * - TECH_FUND → 平台账户
   * - RESERVE_FUND → 平台账户
   */
  async split(
    tx: any,
    allocationId: string,
    orderId: string,
    pools: VipPlatformPools,
    companyProfitShares: Record<string, number>,
  ): Promise<void> {
    // 1. PLATFORM_PROFIT → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.platformProfit, 'PLATFORM_PROFIT', 'VIP平台利润',
    );

    // 2. INDUSTRY_FUND → 平台暂存，按公司记入独立账本
    await this.distributeIndustryFund(
      tx, allocationId, orderId, pools.industryFund, companyProfitShares,
    );

    // 3. CHARITY_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.charityFund, 'CHARITY_FUND', 'VIP慈善基金',
    );

    // 4. TECH_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.techFund, 'TECH_FUND', 'VIP科技基金',
    );

    // 5. RESERVE_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.reserveFund, 'RESERVE_FUND', 'VIP备用金',
    );
  }

  /**
   * 产业基金分配：按公司利润贡献记公司应付账
   * 多公司订单按比例分割，末额补差；公司归属缺失进入待归属账
   */
  private async distributeIndustryFund(
    tx: any,
    allocationId: string,
    orderId: string,
    totalAmount: number,
    companyProfitShares: Record<string, number>,
  ): Promise<void> {
    // 旧分配由既有 RewardAllocation 幂等键保护；只为本次新分配生成公司账。
    await this.industryFund.accrueInTransaction(tx, {
      allocationId, orderId, amount: totalAmount, companyProfitShares,
      scheme: 'VIP_PLATFORM_SPLIT',
    });
  }

  /** 平台账户入账（PLATFORM_PROFIT / CHARITY_FUND / TECH_FUND / RESERVE_FUND / INDUSTRY_FUND） */
  private async creditPlatformAccount(
    tx: any,
    allocationId: string,
    orderId: string,
    amount: number,
    accountType: string,
    label: string,
  ): Promise<void> {
    if (amount <= 0) return;

    const account = await this.ensureAccount(tx, PLATFORM_USER_ID, accountType);

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
          scheme: 'VIP_PLATFORM_SPLIT',
          accountType,
          sourceOrderId: orderId,
        },
      },
    });

    await tx.rewardAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount } },
    });

    this.logger.log(`${label}入账：${amount} 元`);
  }

  /** 确保账户存在 */
  private async ensureAccount(tx: any, userId: string, type: string) {
    // 平台账户由所有收货分配共享。冷启动时先查后建会在
    // (userId,type) 唯一键上竞态，失败事务不会得到可重试的分配结果。
    // upsert 将账户创建本身收口为调用方 Serializable 事务内的幂等操作。
    return tx.rewardAccount.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type },
      update: {},
    });
  }

  /** 截断到分（2 位小数，舍弃后续位数） */
  private round2(val: number): number {
    return Math.floor(val * 100) / 100;
  }
}
