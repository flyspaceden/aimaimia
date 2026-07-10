import { Injectable, Logger } from '@nestjs/common';
import { BonusConfig } from './bonus-config.service';

/** 订单项（含成本信息） */
export interface OrderItemForCalc {
  unitPrice: number;
  quantity: number;
  cost: number | null; // product.cost，可能为 null
}

/** 订单项（含成本信息 + 公司ID，用于普通/VIP 七分利润归属） */
export interface OrderItemForPoolCalc extends OrderItemForCalc {
  companyId: string | null;
}
/** @deprecated 使用 OrderItemForPoolCalc */
export type OrderItemForNormalCalc = OrderItemForPoolCalc;

/** VIP 池分配计算结果 */
export interface PoolCalculation {
  profit: number;
  rebatePool: number;
  rewardPool: number;
  platformPool: number;
  fundPool: number;
  pointsPool: number;
  ruleVersion: string;
  configSnapshot: Record<string, any>;
}

/** 普通用户七分池计算结果 */
export interface NormalPoolCalculation {
  profit: number;
  platformProfit: number;     // 49% — 平台利润（默认）
  rewardPool: number;         // 16% — 奖励分配（上溯祖辈）
  directReferralPool: number;  // 1%  — 普通直推持续佣金（Task 6 分配）
  industryFund: number;       // 16% — 产业基金（返还卖家）
  charityFund: number;        // 8%  — 慈善基金
  techFund: number;           // 8%  — 科技基金
  reserveFund: number;        // 2%  — 备用金（末池补差）
  /** 每个公司在本订单中的利润占比 { companyId: share }，用于产业基金按比例分配 */
  companyProfitShares: Record<string, number>;
  ruleVersion: string;
  configSnapshot: Record<string, any>;
}

/** VIP 七分池计算结果 */
export interface VipPoolCalculation {
  profit: number;
  platformProfit: number;     // VIP平台利润
  rewardPool: number;         // VIP奖励分配（上溯祖辈）
  directReferralPool: number;  // VIP直推持续佣金
  industryFund: number;       // VIP产业基金（返还卖家）
  charityFund: number;        // VIP慈善基金
  techFund: number;           // VIP科技基金
  reserveFund: number;        // VIP备用金（末池补差）
  companyProfitShares: Record<string, number>;
  ruleVersion: string;
  configSnapshot: Record<string, any>;
}

export interface SnapshotProfitRates {
  platform: number;
  reward: number;
  directReferral: number;
  industryFund: number;
  charity: number;
  tech: number;
  reserve: number;
}

export type SnapshotProfitRateSet = {
  vip: SnapshotProfitRates;
  normal: SnapshotProfitRates;
};

export interface SnapshotPoolCalculation extends VipPoolCalculation {
  platformRetained: number;
  externalNet: number;
}

export interface SnapshotTreeAncestor {
  depth: number;
  nodeId: string;
  userId: string | null;
  level: number;
}

export interface SnapshotTreeRoute {
  buyerPath: 'VIP' | 'NORMAL';
  ancestors: SnapshotTreeAncestor[];
}

@Injectable()
export class RewardCalculatorService {
  private readonly logger = new Logger(RewardCalculatorService.name);

  /**
   * 根据订单项和分润配置，计算各池金额
   * profit = Σ (unitPrice - cost) * quantity
   * rebatePool = profit * rebateRatio
   * rewardPool = rebatePool * rewardPoolPercent
   * platformPool = rebatePool * platformPercent
   * fundPool = rebatePool * fundPercent
   * pointsPool = rebatePool * pointsPercent
   * @deprecated 使用 calculateVip() 替代。保留供 NORMAL_BROADCAST 遗留路径使用。
   */
  calculate(items: OrderItemForCalc[], config: BonusConfig): PoolCalculation {
    // 计算总利润
    let profit = 0;
    for (const item of items) {
      let cost = item.cost;
      if (cost === null || cost === undefined) {
        // 成本未设置时视为 cost=0，全额作为利润参与分润
        this.logger.warn(`商品成本未设置（unitPrice=${item.unitPrice}），按 cost=0 计算（全额利润）`);
        cost = 0;
      }
      const itemProfit = (item.unitPrice - cost) * item.quantity;
      if (itemProfit > 0) {
        profit += itemProfit;
      }
      // 负利润的项不计入（亏损品不扣减总池）
    }

    // 无利润则所有池为 0
    if (profit <= 0) {
      return {
        profit: 0,
        rebatePool: 0,
        rewardPool: 0,
        platformPool: 0,
        fundPool: 0,
        pointsPool: 0,
        ruleVersion: config.ruleVersion,
        configSnapshot: this.snapshot(config),
      };
    }

    const rebatePool = this.round2(profit * config.rebateRatio);
    // "末池补差"法：前 3 个池独立计算，第 4 个池 = 总额 - 前 3 之和，避免浮点精度丢失
    const rewardPool = this.round2(rebatePool * config.rewardPoolPercent);
    const platformPool = this.round2(rebatePool * config.platformPercent);
    const fundPool = this.round2(rebatePool * config.fundPercent);
    const pointsPool = this.round2(rebatePool - rewardPool - platformPool - fundPool);

    return {
      profit: this.round2(profit),
      rebatePool,
      rewardPool,
      platformPool,
      fundPool,
      pointsPool,
      ruleVersion: config.ruleVersion,
      configSnapshot: this.snapshot(config),
    };
  }

  /**
   * 普通用户七分利润计算
   * profit = Σ (unitPrice - cost) * quantity（与 VIP 利润计算逻辑一致）
   * 七池按 NORMAL_* 比例直接分割利润，末池（reserveFund）补差吸收浮点误差
   */
  calculateNormal(items: OrderItemForPoolCalc[], config: BonusConfig): NormalPoolCalculation {
    // 计算总利润 + 按公司分组利润
    let profit = 0;
    const companyProfits = new Map<string, number>();

    for (const item of items) {
      let cost = item.cost;
      if (cost === null || cost === undefined) {
        this.logger.warn(`商品成本未设置（unitPrice=${item.unitPrice}），按 cost=0 计算（全额利润）`);
        cost = 0;
      }
      const itemProfit = (item.unitPrice - cost) * item.quantity;
      if (itemProfit > 0) {
        profit += itemProfit;
        // 按公司归集利润（用于产业基金按比例分配）
        const cid = item.companyId || 'UNKNOWN';
        companyProfits.set(cid, (companyProfits.get(cid) ?? 0) + itemProfit);
      }
    }

    // 无利润则所有池为 0
    if (profit <= 0) {
      return {
        profit: 0,
        platformProfit: 0,
        rewardPool: 0,
        directReferralPool: 0,
        industryFund: 0,
        charityFund: 0,
        techFund: 0,
        reserveFund: 0,
        companyProfitShares: {},
        ruleVersion: config.ruleVersion,
        configSnapshot: this.snapshotNormal(config),
      };
    }

    profit = this.round2(profit);

    // 七分计算：前 6 个池独立计算，第 7 个池（reserveFund）= profit - 前 6 之和
    const platformProfit = this.round2(profit * config.normalPlatformPercent);
    const rewardPool = this.round2(profit * config.normalRewardPercent);
    const directReferralPool = this.round2(profit * config.normalDirectReferralPercent);
    const industryFund = this.round2(profit * config.normalIndustryFundPercent);
    const charityFund = this.round2(profit * config.normalCharityPercent);
    const techFund = this.round2(profit * config.normalTechPercent);
    const reserveFund = this.round2(
      profit - platformProfit - rewardPool - directReferralPool - industryFund - charityFund - techFund,
    );

    // 计算各公司利润占比
    const companyProfitShares: Record<string, number> = {};
    for (const [cid, cProfit] of companyProfits) {
      companyProfitShares[cid] = cProfit / profit;
    }

    return {
      profit,
      platformProfit,
      rewardPool,
      directReferralPool,
      industryFund,
      charityFund,
      techFund,
      reserveFund,
      companyProfitShares,
      ruleVersion: config.ruleVersion,
      configSnapshot: this.snapshotNormal(config),
    };
  }

  /**
   * VIP 七分利润计算
   * profit = Σ (unitPrice - cost) * quantity（与普通利润计算逻辑一致）
   * 七池按 VIP_* 比例直接分割利润，末池（reserveFund）补差吸收浮点误差
   */
  calculateVip(items: OrderItemForPoolCalc[], config: BonusConfig): VipPoolCalculation {
    // 计算总利润 + 按公司分组利润
    let profit = 0;
    const companyProfits = new Map<string, number>();

    for (const item of items) {
      let cost = item.cost;
      if (cost === null || cost === undefined) {
        this.logger.warn(`商品成本未设置（unitPrice=${item.unitPrice}），按 cost=0 计算（全额利润）`);
        cost = 0;
      }
      const itemProfit = (item.unitPrice - cost) * item.quantity;
      if (itemProfit > 0) {
        profit += itemProfit;
        // 按公司归集利润（用于产业基金按比例分配）
        const cid = item.companyId || 'UNKNOWN';
        companyProfits.set(cid, (companyProfits.get(cid) ?? 0) + itemProfit);
      }
    }

    // 无利润则所有池为 0
    if (profit <= 0) {
      return {
        profit: 0,
        platformProfit: 0,
        rewardPool: 0,
        directReferralPool: 0,
        industryFund: 0,
        charityFund: 0,
        techFund: 0,
        reserveFund: 0,
        companyProfitShares: {},
        ruleVersion: config.ruleVersion,
        configSnapshot: this.snapshotVip(config),
      };
    }

    profit = this.round2(profit);

    // 七分计算：前 6 个池独立计算，第 7 个池（reserveFund）= profit - 前 6 之和
    const platformProfit = this.round2(profit * config.vipPlatformPercent);
    const rewardPool = this.round2(profit * config.vipRewardPercent);
    const directReferralPool = this.round2(profit * config.vipDirectReferralPercent);
    const industryFund = this.round2(profit * config.vipIndustryFundPercent);
    const charityFund = this.round2(profit * config.vipCharityPercent);
    const techFund = this.round2(profit * config.vipTechPercent);
    const reserveFund = this.round2(
      profit - platformProfit - rewardPool - directReferralPool - industryFund - charityFund - techFund,
    );

    // 计算各公司利润占比
    const companyProfitShares: Record<string, number> = {};
    for (const [cid, cProfit] of companyProfits) {
      companyProfitShares[cid] = cProfit / profit;
    }

    return {
      profit,
      platformProfit,
      rewardPool,
      directReferralPool,
      industryFund,
      charityFund,
      techFund,
      reserveFund,
      companyProfitShares,
      ruleVersion: config.ruleVersion,
      configSnapshot: this.snapshotVip(config),
    };
  }

  /**
   * V3 snapshot allocation. The immutable distributable profit is the only
   * monetary base; every bucket is calculated in cents and the explicit
   * platform bucket absorbs all rounding remainder.
   */
  calculateFromProfit(
    profit: number,
    path: 'VIP' | 'NORMAL',
    rates: SnapshotProfitRateSet,
    directRate: number,
    companyProfitShares: Record<string, number> = {},
    directClaimed = true,
    ruleVersion = 'snapshot',
  ): SnapshotPoolCalculation {
    const profitCents = Math.round(profit * 100);
    const selected = path === 'VIP' ? rates.vip : rates.normal;
    const appliedRates = {
      reward: selected.reward,
      directReferral: directRate,
      industryFund: selected.industryFund,
      charity: selected.charity,
      tech: selected.tech,
      reserve: selected.reserve,
    };

    if (
      !Number.isSafeInteger(profitCents)
      || profitCents < 0
      || Object.values(appliedRates).some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1)
    ) {
      throw new Error('Invalid payment profit snapshot allocation input');
    }

    const rewardCents = this.rateCents(profitCents, appliedRates.reward);
    const directCents = this.rateCents(profitCents, appliedRates.directReferral);
    const industryCents = this.rateCents(profitCents, appliedRates.industryFund);
    const charityCents = this.rateCents(profitCents, appliedRates.charity);
    const techCents = this.rateCents(profitCents, appliedRates.tech);
    const reserveCents = this.rateCents(profitCents, appliedRates.reserve);
    const nonPlatformCents = rewardCents
      + directCents
      + industryCents
      + charityCents
      + techCents
      + reserveCents;
    const platformCents = profitCents - nonPlatformCents;
    if (platformCents < 0) {
      throw new Error('Payment profit snapshot allocation exceeds distributable profit');
    }

    const externalNetCents = rewardCents + industryCents + (directClaimed ? directCents : 0);
    const platformRetainedCents = profitCents - externalNetCents;
    const toYuan = (cents: number) => cents / 100;

    return {
      profit: toYuan(profitCents),
      platformProfit: toYuan(platformCents),
      rewardPool: toYuan(rewardCents),
      directReferralPool: toYuan(directCents),
      industryFund: toYuan(industryCents),
      charityFund: toYuan(charityCents),
      techFund: toYuan(techCents),
      reserveFund: toYuan(reserveCents),
      platformRetained: toYuan(platformRetainedCents),
      externalNet: toYuan(externalNetCents),
      companyProfitShares,
      ruleVersion,
      configSnapshot: {
        buyerPath: path,
        rates,
        effectiveDirectRate: directRate,
        directClaimed,
        ruleVersion,
      },
    };
  }

  private rateCents(profitCents: number, rate: number): number {
    return Math.round(profitCents * rate);
  }

  /** 截断到分（2 位小数，舍弃后续位数） */
  private round2(val: number): number {
    return Math.floor(val * 100) / 100;
  }

  /** VIP 配置快照（用于审计） @deprecated 供 NORMAL_BROADCAST 遗留路径使用 */
  private snapshot(config: BonusConfig): Record<string, any> {
    return {
      rebateRatio: config.rebateRatio,
      rewardPoolPercent: config.rewardPoolPercent,
      platformPercent: config.platformPercent,
      fundPercent: config.fundPercent,
      pointsPercent: config.pointsPercent,
      normalBroadcastX: config.normalBroadcastX,
      vipMaxLayers: config.vipMaxLayers,
      ruleVersion: config.ruleVersion,
    };
  }

  /** 普通用户配置快照（用于审计） */
  private snapshotNormal(config: BonusConfig): Record<string, any> {
    return {
      normalPlatformPercent: config.normalPlatformPercent,
      normalRewardPercent: config.normalRewardPercent,
      normalDirectReferralPercent: config.normalDirectReferralPercent,
      normalIndustryFundPercent: config.normalIndustryFundPercent,
      normalCharityPercent: config.normalCharityPercent,
      normalTechPercent: config.normalTechPercent,
      normalReservePercent: config.normalReservePercent,
      normalMaxLayers: config.normalMaxLayers,
      normalBranchFactor: config.normalBranchFactor,
      normalFreezeDays: config.normalFreezeDays,
      ruleVersion: config.ruleVersion,
    };
  }

  /** VIP 七分法配置快照（用于审计） */
  private snapshotVip(config: BonusConfig): Record<string, any> {
    return {
      vipPlatformPercent: config.vipPlatformPercent,
      vipRewardPercent: config.vipRewardPercent,
      vipDirectReferralPercent: config.vipDirectReferralPercent,
      vipIndustryFundPercent: config.vipIndustryFundPercent,
      vipCharityPercent: config.vipCharityPercent,
      vipTechPercent: config.vipTechPercent,
      vipReservePercent: config.vipReservePercent,
      vipMaxLayers: config.vipMaxLayers,
      vipBranchFactor: config.vipBranchFactor,
      vipMinAmount: config.vipMinAmount,
      ruleVersion: config.ruleVersion,
    };
  }
}
