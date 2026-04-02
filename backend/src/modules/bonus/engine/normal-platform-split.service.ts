import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_USER_ID } from './constants';

/** 普通用户平台分割的 5 个池（奖励由 NormalUpstreamService 处理） */
interface NormalPlatformPools {
  platformProfit: number;  // 50%
  industryFund: number;    // 16%
  charityFund: number;     // 8%
  techFund: number;        // 8%
  reserveFund: number;     // 2%
}

@Injectable()
export class NormalPlatformSplitService {
  private readonly logger = new Logger(NormalPlatformSplitService.name);

  /**
   * 普通用户平台分割：处理除奖励外的 5 个池
   *
   * - PLATFORM_PROFIT (50%) → 平台用户账户
   * - INDUSTRY_FUND (16%) → 按商品利润占比分给各卖家公司 OWNER
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

    // 2. INDUSTRY_FUND → 按利润占比分给各卖家公司 OWNER
    await this.distributeIndustryFund(
      tx, allocationId, orderId, pools.industryFund, companyProfitShares,
    );

    // 3. CHARITY_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.charityFund, 'CHARITY_FUND', '慈善基金',
    );

    // 4. TECH_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.techFund, 'TECH_FUND', '科技基金',
    );

    // 5. RESERVE_FUND → 平台
    await this.creditPlatformAccount(
      tx, allocationId, orderId, pools.reserveFund, 'RESERVE_FUND', '备用金',
    );
  }

  /**
   * 产业基金分配：按各公司利润占比分给卖家 OWNER
   * 多公司订单按比例分割，末额补差；无 OWNER 则归平台
   */
  private async distributeIndustryFund(
    tx: any,
    allocationId: string,
    orderId: string,
    totalAmount: number,
    companyProfitShares: Record<string, number>,
  ): Promise<void> {
    if (totalAmount <= 0) return;

    const companyIds = Object.keys(companyProfitShares);
    if (companyIds.length === 0) {
      // 无公司信息，全额归平台
      await this.creditPlatformAccount(
        tx, allocationId, orderId, totalAmount, 'INDUSTRY_FUND', '产业基金（无卖家归属）',
      );
      return;
    }

    let distributed = 0;

    for (let i = 0; i < companyIds.length; i++) {
      const companyId = companyIds[i];
      const share = companyProfitShares[companyId];
      const isLast = i === companyIds.length - 1;

      // 末额补差：最后一个公司拿剩余金额，吸收浮点误差
      const amount = isLast
        ? this.round2(totalAmount - distributed)
        : this.round2(totalAmount * share);

      if (amount <= 0) continue;
      distributed += amount;

      // 查找公司 OWNER
      const ownerStaff = await tx.companyStaff.findFirst({
        where: { companyId, role: 'OWNER', status: 'ACTIVE' },
        select: { userId: true },
      });

      if (!ownerStaff) {
        // 无 OWNER 时归平台
        this.logger.warn(`公司 ${companyId} 无活跃 OWNER，产业基金 ${amount} 元归平台`);
        await this.creditPlatformAccount(
          tx, allocationId, orderId, amount, 'INDUSTRY_FUND', `产业基金（公司${companyId}无OWNER）`,
        );
        continue;
      }

      // 确保卖家 OWNER 有 INDUSTRY_FUND 账户
      const account = await this.ensureAccount(tx, ownerStaff.userId, 'INDUSTRY_FUND');

      await tx.rewardLedger.create({
        data: {
          allocationId,
          accountId: account.id,
          userId: ownerStaff.userId,
          entryType: 'RELEASE',
          amount,
          status: 'AVAILABLE',
          refType: 'ORDER',
          refId: orderId,
          meta: {
            scheme: 'NORMAL_PLATFORM_SPLIT',
            accountType: 'INDUSTRY_FUND',
            companyId,
            profitShare: share,
            sourceOrderId: orderId,
          },
        },
      });

      await tx.rewardAccount.update({
        where: { id: account.id },
        data: { balance: { increment: amount } },
      });

      this.logger.log(`产业基金入账：${amount} 元 → 卖家 ${ownerStaff.userId}（公司 ${companyId}）`);
    }
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
    let account = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type } },
    });

    if (!account) {
      account = await tx.rewardAccount.create({
        data: { userId, type },
      });
    }

    return account;
  }

  /** 四舍五入到分 */
  private round2(val: number): number {
    return Math.round(val * 100) / 100;
  }
}
