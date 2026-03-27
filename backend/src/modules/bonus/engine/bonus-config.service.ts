import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** VIP分润系统配置（六分法） */
export interface VipBonusConfig {
  vipPlatformPercent: number;        // VIP平台分成比例 (50%)
  vipRewardPercent: number;          // VIP奖励分成比例 (30%)
  vipIndustryFundPercent: number;    // VIP产业基金(卖家)比例 (10%)
  vipCharityPercent: number;         // VIP慈善基金比例 (2%)
  vipTechPercent: number;            // VIP科技基金比例 (2%)
  vipReservePercent: number;         // VIP备用金比例 (6%)
  vipMinAmount: number;         // VIP 有效消费最低金额
  vipMaxLayers: number;         // VIP 最多收取层数
  vipBranchFactor: number;      // 三叉树分叉数
  vipFreezeDays: number;        // VIP冻结奖励过期天数
}

/** 普通用户分润系统配置（新增） */
export interface NormalBonusConfig {
  normalBranchFactor: number;          // 普通树叉数
  normalMaxLayers: number;             // 最大分配层数
  normalFreezeDays: number;            // 冻结奖励过期天数
  normalPlatformPercent: number;       // 平台分成比例 (50%)
  normalRewardPercent: number;         // 奖励分成比例 (16%)
  normalIndustryFundPercent: number;   // 产业基金(卖家)比例 (16%)
  normalCharityPercent: number;        // 慈善基金比例 (8%)
  normalTechPercent: number;           // 科技基金比例 (8%)
  normalReservePercent: number;        // 备用金比例 (2%)
}

/** 系统级配置 */
export interface SystemConfig {
  markupRate: number;           // 卖家商品加价率
  defaultShippingFee: number;   // 默认运费
  autoConfirmDays: number;      // 自动确认收货天数
  lotteryEnabled: boolean;      // 抽奖功能开关
  lotteryDailyChances: number;  // 每日抽奖次数
  vipRewardExpiryDays: number;        // VIP 已释放奖励有效期（天）
  normalRewardExpiryDays: number;     // 普通用户已释放奖励有效期（天）
  vipDiscountRate: number;         // VIP用户商品折扣率
  vipFreeShippingThreshold: number;    // VIP用户免运费门槛（元），0=无条件免运费
  normalFreeShippingThreshold: number; // 普通用户免运费门槛（元），0=无条件免运费
}

/** 完整分润系统配置（向后兼容） */
export interface BonusConfig extends VipBonusConfig, NormalBonusConfig, SystemConfig {
  /** @deprecated 旧VIP返利比例，NORMAL_BROADCAST遗留路径仍需要 */
  rebateRatio: number;
  /** @deprecated 旧VIP奖励池占比，NORMAL_BROADCAST遗留路径仍需要 */
  rewardPoolPercent: number;
  /** @deprecated 旧VIP平台利润占比，NORMAL_BROADCAST遗留路径仍需要 */
  platformPercent: number;
  /** @deprecated 旧VIP基金池占比，NORMAL_BROADCAST遗留路径仍需要 */
  fundPercent: number;
  /** @deprecated 旧VIP积分池占比，NORMAL_BROADCAST遗留路径仍需要 */
  pointsPercent: number;
  // @deprecated 废弃字段，保留兼容
  normalBroadcastX: number;
  bucketRanges: [number, number | null][];
  ruleVersion: string;
}

/** 配置键 → BonusConfig 字段映射 */
const KEY_MAP: Record<string, keyof Omit<BonusConfig, 'ruleVersion'>> = {
  // VIP系统（六分法）
  VIP_PLATFORM_PERCENT: 'vipPlatformPercent',
  VIP_REWARD_PERCENT: 'vipRewardPercent',
  VIP_INDUSTRY_FUND_PERCENT: 'vipIndustryFundPercent',
  VIP_CHARITY_PERCENT: 'vipCharityPercent',
  VIP_TECH_PERCENT: 'vipTechPercent',
  VIP_RESERVE_PERCENT: 'vipReservePercent',
  VIP_MIN_AMOUNT: 'vipMinAmount',
  VIP_MAX_LAYERS: 'vipMaxLayers',
  VIP_BRANCH_FACTOR: 'vipBranchFactor',
  VIP_FREEZE_DAYS: 'vipFreezeDays',
  // @deprecated 旧VIP分配键，NORMAL_BROADCAST遗留路径仍需要
  REBATE_RATIO: 'rebateRatio',
  REWARD_POOL_PERCENT: 'rewardPoolPercent',
  PLATFORM_PERCENT: 'platformPercent',
  FUND_PERCENT: 'fundPercent',
  POINTS_PERCENT: 'pointsPercent',
  // 普通用户系统
  NORMAL_BRANCH_FACTOR: 'normalBranchFactor',
  NORMAL_MAX_LAYERS: 'normalMaxLayers',
  NORMAL_FREEZE_DAYS: 'normalFreezeDays',
  NORMAL_PLATFORM_PERCENT: 'normalPlatformPercent',
  NORMAL_REWARD_PERCENT: 'normalRewardPercent',
  NORMAL_INDUSTRY_FUND_PERCENT: 'normalIndustryFundPercent',
  NORMAL_CHARITY_PERCENT: 'normalCharityPercent',
  NORMAL_TECH_PERCENT: 'normalTechPercent',
  NORMAL_RESERVE_PERCENT: 'normalReservePercent',
  // 系统级配置
  MARKUP_RATE: 'markupRate',
  DEFAULT_SHIPPING_FEE: 'defaultShippingFee',
  AUTO_CONFIRM_DAYS: 'autoConfirmDays',
  LOTTERY_ENABLED: 'lotteryEnabled',
  LOTTERY_DAILY_CHANCES: 'lotteryDailyChances',
  VIP_REWARD_EXPIRY_DAYS: 'vipRewardExpiryDays',
  NORMAL_REWARD_EXPIRY_DAYS: 'normalRewardExpiryDays',
  VIP_DISCOUNT_RATE: 'vipDiscountRate',
  VIP_FREE_SHIPPING_THRESHOLD: 'vipFreeShippingThreshold',
  NORMAL_FREE_SHIPPING_THRESHOLD: 'normalFreeShippingThreshold',
  // @deprecated 废弃
  NORMAL_BROADCAST_X: 'normalBroadcastX',
  BUCKET_RANGES: 'bucketRanges',
};

/** VIP利润分配比例配置键集合（六分法） */
const VIP_RATIO_KEYS = new Set([
  'VIP_PLATFORM_PERCENT',
  'VIP_REWARD_PERCENT',
  'VIP_INDUSTRY_FUND_PERCENT',
  'VIP_CHARITY_PERCENT',
  'VIP_TECH_PERCENT',
  'VIP_RESERVE_PERCENT',
]);

/** 普通用户利润分配比例配置键集合 */
const NORMAL_RATIO_KEYS = new Set([
  'NORMAL_PLATFORM_PERCENT',
  'NORMAL_REWARD_PERCENT',
  'NORMAL_INDUSTRY_FUND_PERCENT',
  'NORMAL_CHARITY_PERCENT',
  'NORMAL_TECH_PERCENT',
  'NORMAL_RESERVE_PERCENT',
]);

/** 默认配置（兜底） */
const DEFAULTS: Omit<BonusConfig, 'ruleVersion'> = {
  // VIP系统（六分法）
  vipPlatformPercent: 0.50,
  vipRewardPercent: 0.30,
  vipIndustryFundPercent: 0.10,
  vipCharityPercent: 0.02,
  vipTechPercent: 0.02,
  vipReservePercent: 0.06,
  vipMinAmount: 100.0,
  vipMaxLayers: 15,
  vipBranchFactor: 3,
  vipFreezeDays: 30,
  // @deprecated 旧VIP分配默认值，NORMAL_BROADCAST遗留路径仍需要
  rebateRatio: 0.5,
  rewardPoolPercent: 0.60,
  platformPercent: 0.37,
  fundPercent: 0.01,
  pointsPercent: 0.02,
  // 普通用户系统
  normalBranchFactor: 3,
  normalMaxLayers: 15,
  normalFreezeDays: 30,
  normalPlatformPercent: 0.50,
  normalRewardPercent: 0.16,
  normalIndustryFundPercent: 0.16,
  normalCharityPercent: 0.08,
  normalTechPercent: 0.08,
  normalReservePercent: 0.02,
  // 系统级
  markupRate: 1.30,
  defaultShippingFee: 8.0,
  autoConfirmDays: 7,
  lotteryEnabled: true,
  lotteryDailyChances: 1,
  vipRewardExpiryDays: 30,
  normalRewardExpiryDays: 30,
  vipDiscountRate: 0.95,
  vipFreeShippingThreshold: 49.0,
  normalFreeShippingThreshold: 99.0,
  // @deprecated 废弃
  normalBroadcastX: 20,
  bucketRanges: [[0, 10], [10, 50], [50, 100], [100, 500], [500, null]],
};

@Injectable()
export class BonusConfigService {
  private readonly logger = new Logger(BonusConfigService.name);
  private cache: BonusConfig | null = null;
  private cacheExpiry = 0;
  // 缓存有效期：60 秒
  private readonly cacheTtlMs = 60_000;

  constructor(private prisma: PrismaService) {}

  /** 获取当前分润配置（带内存缓存） */
  async getConfig(): Promise<BonusConfig> {
    if (this.cache && Date.now() < this.cacheExpiry) {
      return this.cache;
    }

    const config = await this.loadFromDb();
    this.cache = config;
    this.cacheExpiry = Date.now() + this.cacheTtlMs;
    return config;
  }

  /** 仅获取普通用户系统配置 */
  async getNormalConfig(): Promise<NormalBonusConfig> {
    const config = await this.getConfig();
    return {
      normalBranchFactor: config.normalBranchFactor,
      normalMaxLayers: config.normalMaxLayers,
      normalFreezeDays: config.normalFreezeDays,
      normalPlatformPercent: config.normalPlatformPercent,
      normalRewardPercent: config.normalRewardPercent,
      normalIndustryFundPercent: config.normalIndustryFundPercent,
      normalCharityPercent: config.normalCharityPercent,
      normalTechPercent: config.normalTechPercent,
      normalReservePercent: config.normalReservePercent,
    };
  }

  /** 仅获取VIP系统配置（六分法） */
  async getVipConfig(): Promise<VipBonusConfig> {
    const config = await this.getConfig();
    return {
      vipPlatformPercent: config.vipPlatformPercent,
      vipRewardPercent: config.vipRewardPercent,
      vipIndustryFundPercent: config.vipIndustryFundPercent,
      vipCharityPercent: config.vipCharityPercent,
      vipTechPercent: config.vipTechPercent,
      vipReservePercent: config.vipReservePercent,
      vipMinAmount: config.vipMinAmount,
      vipMaxLayers: config.vipMaxLayers,
      vipBranchFactor: config.vipBranchFactor,
      vipFreezeDays: config.vipFreezeDays,
    };
  }

  /** 仅获取系统级配置 */
  async getSystemConfig(): Promise<SystemConfig> {
    const config = await this.getConfig();
    return {
      markupRate: config.markupRate,
      defaultShippingFee: config.defaultShippingFee,
      autoConfirmDays: config.autoConfirmDays,
      lotteryEnabled: config.lotteryEnabled,
      lotteryDailyChances: config.lotteryDailyChances,
      vipRewardExpiryDays: config.vipRewardExpiryDays,
      normalRewardExpiryDays: config.normalRewardExpiryDays,
      vipDiscountRate: config.vipDiscountRate,
      vipFreeShippingThreshold: config.vipFreeShippingThreshold,
      normalFreeShippingThreshold: config.normalFreeShippingThreshold,
    };
  }

  /** 清除缓存（管理员修改配置后调用） */
  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }

  /**
   * 校验配置更新后利润分配比例总和是否仍为 1.0
   * 在管理员更新单个配置项时调用，提前拦截非法配置
   * @param key 即将更新的配置键
   * @param newValue 新值
   */
  async validateRatioUpdate(key: string, newValue: any): Promise<void> {
    const isVipRatio = VIP_RATIO_KEYS.has(key);
    const isNormalRatio = NORMAL_RATIO_KEYS.has(key);
    if (!isVipRatio && !isNormalRatio) return;

    // 从数据库加载当前所有配置
    const rows = await this.prisma.ruleConfig.findMany();
    const current: Record<string, number> = {};
    for (const row of rows) {
      const stored = row.value as any;
      const val = stored?.value ?? stored;
      if (val !== undefined && val !== null) {
        current[row.key] = Number(val);
      }
    }

    // 用新值覆盖即将更新的键
    const parsedNew = typeof newValue === 'object' && newValue?.value !== undefined
      ? Number(newValue.value)
      : Number(newValue);
    current[key] = parsedNew;

    if (isVipRatio) {
      // 校验VIP利润分配比例（六分法）
      const sum =
        (current['VIP_PLATFORM_PERCENT'] ?? DEFAULTS.vipPlatformPercent) +
        (current['VIP_REWARD_PERCENT'] ?? DEFAULTS.vipRewardPercent) +
        (current['VIP_INDUSTRY_FUND_PERCENT'] ?? DEFAULTS.vipIndustryFundPercent) +
        (current['VIP_CHARITY_PERCENT'] ?? DEFAULTS.vipCharityPercent) +
        (current['VIP_TECH_PERCENT'] ?? DEFAULTS.vipTechPercent) +
        (current['VIP_RESERVE_PERCENT'] ?? DEFAULTS.vipReservePercent);
      if (Math.abs(sum - 1.0) > 0.001) {
        throw new BadRequestException(
          `VIP利润分配比例总和为 ${sum.toFixed(4)}，应为 1.0（VIP_PLATFORM_PERCENT + VIP_REWARD_PERCENT + VIP_INDUSTRY_FUND_PERCENT + VIP_CHARITY_PERCENT + VIP_TECH_PERCENT + VIP_RESERVE_PERCENT）`,
        );
      }
    }

    if (isNormalRatio) {
      // 校验普通用户利润分配比例
      const sum =
        (current['NORMAL_PLATFORM_PERCENT'] ?? DEFAULTS.normalPlatformPercent) +
        (current['NORMAL_REWARD_PERCENT'] ?? DEFAULTS.normalRewardPercent) +
        (current['NORMAL_INDUSTRY_FUND_PERCENT'] ?? DEFAULTS.normalIndustryFundPercent) +
        (current['NORMAL_CHARITY_PERCENT'] ?? DEFAULTS.normalCharityPercent) +
        (current['NORMAL_TECH_PERCENT'] ?? DEFAULTS.normalTechPercent) +
        (current['NORMAL_RESERVE_PERCENT'] ?? DEFAULTS.normalReservePercent);
      if (Math.abs(sum - 1.0) > 0.001) {
        throw new BadRequestException(
          `普通用户利润分配比例总和为 ${sum.toFixed(4)}，应为 1.0`,
        );
      }
    }
  }

  /**
   * 校验一组配置快照中的利润分配比例总和
   * 用于版本回滚时的整体校验
   * @param snapshot 完整配置快照
   */
  validateSnapshotRatios(snapshot: Record<string, any>): void {
    // 解析快照值（可能是 { value: xxx } 格式或直接值）
    const getValue = (key: string, fallback: number): number => {
      const stored = snapshot[key];
      if (stored === undefined || stored === null) return fallback;
      const val = typeof stored === 'object' && stored?.value !== undefined
        ? stored.value
        : stored;
      return Number(val);
    };

    // 校验VIP利润分配比例（自动检测旧/新格式）
    const isOldVipFormat = snapshot['REWARD_POOL_PERCENT'] !== undefined;
    const isNewVipFormat = snapshot['VIP_PLATFORM_PERCENT'] !== undefined;

    if (isOldVipFormat && !isNewVipFormat) {
      // 旧格式快照：4键校验
      const vipSum =
        getValue('REWARD_POOL_PERCENT', DEFAULTS.rewardPoolPercent) +
        getValue('PLATFORM_PERCENT', DEFAULTS.platformPercent) +
        getValue('FUND_PERCENT', DEFAULTS.fundPercent) +
        getValue('POINTS_PERCENT', DEFAULTS.pointsPercent);
      if (Math.abs(vipSum - 1.0) > 0.001) {
        throw new BadRequestException(
          `快照中VIP利润分配比例总和为 ${vipSum.toFixed(4)}，应为 1.0（旧格式）`,
        );
      }
    } else {
      // 新格式快照：6键校验（六分法）
      const vipSum =
        getValue('VIP_PLATFORM_PERCENT', DEFAULTS.vipPlatformPercent) +
        getValue('VIP_REWARD_PERCENT', DEFAULTS.vipRewardPercent) +
        getValue('VIP_INDUSTRY_FUND_PERCENT', DEFAULTS.vipIndustryFundPercent) +
        getValue('VIP_CHARITY_PERCENT', DEFAULTS.vipCharityPercent) +
        getValue('VIP_TECH_PERCENT', DEFAULTS.vipTechPercent) +
        getValue('VIP_RESERVE_PERCENT', DEFAULTS.vipReservePercent);
      if (Math.abs(vipSum - 1.0) > 0.001) {
        throw new BadRequestException(
          `快照中VIP利润分配比例总和为 ${vipSum.toFixed(4)}，应为 1.0`,
        );
      }
    }

    // 校验普通用户利润分配比例
    const normalSum =
      getValue('NORMAL_PLATFORM_PERCENT', DEFAULTS.normalPlatformPercent) +
      getValue('NORMAL_REWARD_PERCENT', DEFAULTS.normalRewardPercent) +
      getValue('NORMAL_INDUSTRY_FUND_PERCENT', DEFAULTS.normalIndustryFundPercent) +
      getValue('NORMAL_CHARITY_PERCENT', DEFAULTS.normalCharityPercent) +
      getValue('NORMAL_TECH_PERCENT', DEFAULTS.normalTechPercent) +
      getValue('NORMAL_RESERVE_PERCENT', DEFAULTS.normalReservePercent);
    if (Math.abs(normalSum - 1.0) > 0.001) {
      throw new BadRequestException(
        `快照中普通用户利润分配比例总和为 ${normalSum.toFixed(4)}，应为 1.0`,
      );
    }
  }

  /** 从数据库加载配置 */
  private async loadFromDb(): Promise<BonusConfig> {
    const [rows, latestVersion] = await Promise.all([
      this.prisma.ruleConfig.findMany(),
      this.prisma.ruleVersion.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);

    // 以默认值为基础
    const result: any = { ...DEFAULTS };

    for (const row of rows) {
      const field = KEY_MAP[row.key];
      if (!field) continue;

      // RuleConfig.value 存储为 { value: xxx, description: xxx }
      const stored = row.value as any;
      const val = stored?.value ?? stored;

      if (val !== undefined && val !== null) {
        result[field] = val;
      }
    }

    result.ruleVersion = latestVersion?.version ?? 'initial';

    // 校验VIP利润分配比例总和 = 1.0（六分法，容差 0.001）
    const vipSum =
      result.vipPlatformPercent +
      result.vipRewardPercent +
      result.vipIndustryFundPercent +
      result.vipCharityPercent +
      result.vipTechPercent +
      result.vipReservePercent;
    if (Math.abs(vipSum - 1.0) > 0.001) {
      this.logger.error(
        `VIP利润分配比例总和异常: ${vipSum}（应为 1.0），使用默认值`,
      );
      result.vipPlatformPercent = DEFAULTS.vipPlatformPercent;
      result.vipRewardPercent = DEFAULTS.vipRewardPercent;
      result.vipIndustryFundPercent = DEFAULTS.vipIndustryFundPercent;
      result.vipCharityPercent = DEFAULTS.vipCharityPercent;
      result.vipTechPercent = DEFAULTS.vipTechPercent;
      result.vipReservePercent = DEFAULTS.vipReservePercent;
    }

    // 校验普通用户利润分配比例总和 = 1.0（容差 0.001）
    const normalSum =
      result.normalPlatformPercent +
      result.normalRewardPercent +
      result.normalIndustryFundPercent +
      result.normalCharityPercent +
      result.normalTechPercent +
      result.normalReservePercent;
    if (Math.abs(normalSum - 1.0) > 0.001) {
      this.logger.error(
        `普通用户利润分配比例总和异常: ${normalSum}（应为 1.0），使用默认值`,
      );
      result.normalPlatformPercent = DEFAULTS.normalPlatformPercent;
      result.normalRewardPercent = DEFAULTS.normalRewardPercent;
      result.normalIndustryFundPercent = DEFAULTS.normalIndustryFundPercent;
      result.normalCharityPercent = DEFAULTS.normalCharityPercent;
      result.normalTechPercent = DEFAULTS.normalTechPercent;
      result.normalReservePercent = DEFAULTS.normalReservePercent;
    }

    this.logger.log(`分润配置已加载，版本: ${result.ruleVersion}`);
    return result as BonusConfig;
  }
}
