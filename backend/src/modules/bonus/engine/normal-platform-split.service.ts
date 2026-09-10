import { IndustryFundService } from '../../fund-ledger/industry-fund.service';
import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_USER_ID } from './constants';

/** 普通用户平台/基金池分割（奖励池由 NormalUpstreamService 处理，直推池由支付时直推服务处理） */
interface NormalPlatformPools {
  platformProfit: number;      // 49% 默认
  directReferralPool: number;  // 1% 默认；订单支付时由直推佣金服务处理
  industryFund: number;    // 16%
  charityFund: number;     // 8%
  techFund: number;        // 8%
  reserveFund: number;     // 2%
}

@Injectable()
export class NormalPlatformSplitService {
  private readonly logger = new Logger(NormalPlatformSplitService.name);

  constructor(private readonly industryFund: IndustryFundService) {}

  /**
   * 普通用户平台分割：处理平台/基金池
   *
   * - PLATFORM_PROFIT (49% 默认) → 平台用户账户
   * - NORMAL_DIRECT_REFERRAL (1% 默认) → 订单支付时单独冻结给直推邀请人或路由平台
   * - INDUSTRY_FUND (16%) → 平台暂存，按公司记入独立账本
   * - CHARITY_FUND (8%) → 平台账户
   * - TECH_FUND (8%) → 平台账户
   * - RESERVE_FUND (2%) → 平台账户
   */
  async split(
    tx: any,
    allocationId: string,
    orderId: string,
    pools: NormalPlatformPools,
    companyProfitShares: Record<string, number>,
  ): Promise<void> {
    // 1. PLATFORM_PROFIT → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.platformProfit, 'PLATFORM_PROFIT', '普通用户平台利润',
    );

    // 2. NORMAL_DIRECT_REFERRAL 已在订单支付时处理；这里不再写平台占位账，避免重复入账

    // 3. INDUSTRY_FUND → 平台暂存，按公司记入独立账本
    await this.distributeIndustryFund(
      tx, allocationId, orderId, pools.industryFund, companyProfitShares,
    );

    // 4. CHARITY_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.charityFund, 'CHARITY_FUND', '慈善基金',
    );

    // 5. TECH_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.techFund, 'TECH_FUND', '科技基金',
    );

    // 6. RESERVE_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.reserveFund, 'RESERVE_FUND', '备用金',
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
      scheme: 'NORMAL_PLATFORM_SPLIT',
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
          scheme: 'NORMAL_PLATFORM_SPLIT',
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
