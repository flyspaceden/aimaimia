import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  cloneCaptainSeafoodConfig,
} from '../captain/captain.constants';
import type { CaptainSeafoodConfig } from '../captain/captain.types';
import {
  ProfitSafetyCandidate,
  ProfitSafetySku,
  ProfitSafetySummary,
  ProfitSafetyValidator,
  ProfitSafetyViolationError,
} from './profit-safety-validator';

export interface ProfitSafetyCandidateChange {
  ruleUpdates?: Record<string, unknown>;
  replaceRuleSnapshot?: Record<string, unknown>;
  captainConfig?: CaptainSeafoodConfig;
  skuUpserts?: ProfitSafetySku[];
  removeSkuIds?: string[];
  createdByAdminId?: string | null;
  changeNote?: string | null;
}

export interface ProfitSafetyWriteContext {
  candidateSnapshot: Record<string, unknown>;
  candidateSkus: ProfitSafetySku[];
  summary: ProfitSafetySummary;
}

export interface ProfitSafetyWriteResult<T> extends ProfitSafetyWriteContext {
  result: T;
  ruleVersion: unknown;
}

type Tx = Prisma.TransactionClient;

// Stable baseline from the system seed plus safety-critical and separately seeded keys.
// Unknown extension keys are preserved in snapshots too.
export const PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS = Object.freeze([
  'VIP_PLATFORM_PERCENT',
  'VIP_REWARD_PERCENT',
  'VIP_DIRECT_REFERRAL_PERCENT',
  'VIP_INDUSTRY_FUND_PERCENT',
  'VIP_CHARITY_PERCENT',
  'VIP_TECH_PERCENT',
  'VIP_RESERVE_PERCENT',
  'NORMAL_BROADCAST_X',
  'VIP_MIN_AMOUNT',
  'VIP_MAX_LAYERS',
  'VIP_BRANCH_FACTOR',
  'BUCKET_RANGES',
  'AUTO_CONFIRM_DAYS',
  'NORMAL_BRANCH_FACTOR',
  'NORMAL_MAX_LAYERS',
  'NORMAL_FREEZE_DAYS',
  'NORMAL_PLATFORM_PERCENT',
  'NORMAL_REWARD_PERCENT',
  'NORMAL_DIRECT_REFERRAL_PERCENT',
  'NORMAL_INDUSTRY_FUND_PERCENT',
  'NORMAL_CHARITY_PERCENT',
  'NORMAL_TECH_PERCENT',
  'NORMAL_RESERVE_PERCENT',
  'AUTO_VIP_BY_SPEND_ENABLED',
  'AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD',
  'VIP_FREEZE_DAYS',
  'VIP_REWARD_EXPIRY_DAYS',
  'NORMAL_REWARD_EXPIRY_DAYS',
  'MARKUP_RATE',
  'VIP_DISCOUNT_RATE',
  'DEFAULT_SHIPPING_FEE',
  'VIP_FREE_SHIPPING_THRESHOLD',
  'NORMAL_FREE_SHIPPING_THRESHOLD',
  'LOW_STOCK_DISPLAY_THRESHOLD',
  'LOTTERY_ENABLED',
  'LOTTERY_DAILY_CHANCES',
  'GROWTH_ENABLED',
  'GROWTH_POINTS_EXPIRE_DAYS',
  'GROWTH_POINTS_EXPIRE_REMIND_DAYS',
  'GROWTH_DAILY_POINTS_CAP',
  'GROWTH_MONTHLY_POINTS_CAP',
  'GROWTH_DAILY_SHARE_REWARD_USER_CAP',
  'GROWTH_MONTHLY_INVITE_FIRST_ORDER_CAP',
  'GROWTH_VIP_CHECKIN_POINTS_MULTIPLIER',
  'GROWTH_VIP_SHOPPING_GROWTH_MULTIPLIER',
  'GROWTH_REFUND_REVERSAL_ENABLED',
  'GROWTH_AUTO_SUSPEND_EXCHANGE_RISK',
  'RETURN_WINDOW_DAYS',
  'NORMAL_RETURN_DAYS',
  'FRESH_RETURN_HOURS',
  'RETURN_NO_SHIP_THRESHOLD',
  'RETURN_SHIPPING_FEE_DEFAULT',
  'SELLER_REVIEW_TIMEOUT_DAYS',
  'BUYER_SHIP_TIMEOUT_DAYS',
  'SELLER_RECEIVE_TIMEOUT_DAYS',
  'BUYER_CONFIRM_TIMEOUT_DAYS',
  'INVOICE_PROVIDER_MODE',
  'INVOICE_AUTO_ISSUE',
  'INVOICE_AUTO_ISSUE_MAX_ATTEMPTS',
  'INVOICE_ALLOW_VIP_PACKAGE',
  'INVOICE_LINE_MODE',
  'INVOICE_DEFAULT_TAX_RATE',
  'INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE',
  'INVOICE_DEFAULT_GOODS_NAME',
  'INVOICE_REMARK_TEMPLATE',
  'INVOICE_ISSUER_PROFILE',
  'WITHDRAW_TAX_RATE',
  'WITHDRAW_MIN_AMOUNT',
  'WITHDRAW_MAX_AMOUNT',
  'WITHDRAW_DAILY_MAX_COUNT',
  'WITHDRAW_COOLDOWN_SECONDS',
  'WITHDRAW_YEARLY_MAX_AMOUNT',
  'DEDUCTION_RATIO_NORMAL',
  'DEDUCTION_RATIO_VIP',
  'DEDUCTION_MIN_ORDER_AMOUNT',
  'DEDUCTION_ALLOW_COUPON_STACK',
  'WITHDRAW_PROVIDER_FEE_AMOUNT',
  'WITHDRAW_YEARLY_ALERT_THRESHOLD',
  'DIGITAL_ASSET_CREDIT_TIERS',
  'DIGITAL_ASSET_MODULE_SETTINGS',
  'GROUP_BUY_MAX_MONTHLY_LAUNCHES',
  'DISCOVERY_COMPANY_FILTERS',
  CAPTAIN_SEAFOOD_CONFIG_KEY,
] as const);

const CONFIG_DEFAULTS = {
  MARKUP_RATE: 1.35,
  VIP_DISCOUNT_RATE: 0.95,
  VIP_REWARD_PERCENT: 0.3,
  VIP_DIRECT_REFERRAL_PERCENT: 0,
  VIP_INDUSTRY_FUND_PERCENT: 0.1,
  NORMAL_REWARD_PERCENT: 0.16,
  NORMAL_DIRECT_REFERRAL_PERCENT: 0.01,
  NORMAL_INDUSTRY_FUND_PERCENT: 0.16,
} as const;

@Injectable()
export class ProfitSafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: ProfitSafetyValidator = new ProfitSafetyValidator(),
  ) {}

  async withCandidateChange<T>(
    change: ProfitSafetyCandidateChange,
    write: (tx: Tx, context: ProfitSafetyWriteContext) => Promise<T>,
  ): Promise<ProfitSafetyWriteResult<T>> {
    return this.withSafetyLock(async (tx) => {
      const context = await this.buildContext(tx, change, true);
      const result = await write(tx, context);
      const ruleVersion = await (tx as any).ruleVersion.create({
        data: {
          version: `profit-safety-${Date.now()}-${randomUUID()}`,
          snapshot: context.candidateSnapshot as Prisma.InputJsonValue,
          createdByAdminId: change.createdByAdminId ?? null,
          changeNote: change.changeNote ?? null,
          isComplete: true,
          safetySummary: context.summary as unknown as Prisma.InputJsonValue,
        },
      });
      return { ...context, result, ruleVersion };
    });
  }

  async preview(change: ProfitSafetyCandidateChange = {}): Promise<ProfitSafetySummary> {
    return this.withSafetyLock(async (tx) => {
      return (await this.buildContext(tx, change, false)).summary;
    });
  }

  async getCurrentSummary(): Promise<ProfitSafetySummary> {
    return this.preview();
  }

  async withSafetyLock<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.takeSafetyLock(tx);
          return work(tx);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        });
      } catch (error) {
        if (!this.isSerializationFailure(error) || attempt === maxAttempts) throw error;
      }
    }
    throw new Error('profit safety transaction retry exhausted');
  }

  private async buildContext(
    tx: Tx,
    change: ProfitSafetyCandidateChange,
    assertSafe: boolean,
  ): Promise<ProfitSafetyWriteContext> {
    const [currentSnapshot, currentSkus] = await Promise.all([
      this.loadRuleSnapshot(tx),
      this.loadActiveSkus(tx),
    ]);
    const candidateSnapshot = change.replaceRuleSnapshot
      ? { ...change.replaceRuleSnapshot }
      : {
          ...currentSnapshot,
          ...(change.ruleUpdates ?? {}),
        };
    if (change.captainConfig) {
      candidateSnapshot[CAPTAIN_SEAFOOD_CONFIG_KEY] = cloneCaptainSeafoodConfig(
        change.captainConfig,
      );
    }
    const candidateSkus = this.mergeSkuChanges(
      currentSkus,
      change.skuUpserts ?? [],
      change.removeSkuIds ?? [],
    );
    const candidate = this.toValidatorCandidate(candidateSnapshot, candidateSkus);
    const summary = this.validator.evaluate(candidate);
    const missingKeys = PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS.filter(
      (key) => !Object.prototype.hasOwnProperty.call(candidateSnapshot, key),
    );
    summary.ruleConfigCompleteness = {
      complete: missingKeys.length === 0,
      requiredKeys: [...PROFIT_SAFETY_REQUIRED_RULE_CONFIG_KEYS],
      presentKeys: Object.keys(candidateSnapshot).sort(),
      missingKeys: [...missingKeys],
    };
    if (missingKeys.length > 0) {
      summary.safe = false;
      summary.errors = [
        ...summary.errors,
        `INCOMPLETE_RULE_CONFIG_SNAPSHOT:${missingKeys.join(',')}`,
      ];
    }
    if (assertSafe && !summary.safe) {
      throw new ProfitSafetyViolationError(summary);
    }
    return { candidateSnapshot, candidateSkus, summary };
  }

  private async takeSafetyLock(tx: Tx): Promise<void> {
    await (tx as any).$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext('profit-safety-config-v1'))",
    );
  }

  private async loadRuleSnapshot(tx: Tx): Promise<Record<string, unknown>> {
    const rows = await (tx as any).ruleConfig.findMany({
      select: { key: true, value: true },
      orderBy: { key: 'asc' },
    });
    return Object.fromEntries(
      (rows ?? []).map((row: any) => [row.key, this.unwrapRuleValue(row.value)]),
    );
  }

  private async loadActiveSkus(tx: Tx): Promise<ProfitSafetySku[]> {
    const rows = await (tx as any).productSKU.findMany({
      where: {
        status: 'ACTIVE',
        product: { status: 'ACTIVE', company: { isPlatform: false } },
      },
      select: {
        id: true,
        price: true,
        cost: true,
        status: true,
        vipGiftItems: { select: { id: true }, take: 1 },
        product: {
          select: {
            id: true,
            companyId: true,
            categoryId: true,
            status: true,
            type: true,
            company: { select: { isPlatform: true } },
            lotteryPrizes: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    return (rows ?? []).map((row: any) => ({
      id: row.id,
      productId: row.product.id,
      companyId: row.product.companyId,
      categoryId: row.product.categoryId ?? null,
      price: Number(row.price),
      cost: row.cost === null || row.cost === undefined ? null : Number(row.cost),
      active: row.status === 'ACTIVE' && row.product.status === 'ACTIVE',
      ordinary: row.product.company?.isPlatform !== true
        && (row.product.lotteryPrizes?.length ?? 0) === 0
        && (row.vipGiftItems?.length ?? 0) === 0,
      vipDiscountEligible: !row.product.company?.isPlatform,
    }));
  }

  private mergeSkuChanges(
    current: ProfitSafetySku[],
    upserts: ProfitSafetySku[],
    removeIds: string[],
  ): ProfitSafetySku[] {
    const removed = new Set(removeIds);
    const merged = new Map(
      current.filter((sku) => !removed.has(sku.id)).map((sku) => [sku.id, sku]),
    );
    for (const sku of upserts) {
      if (!removed.has(sku.id)) merged.set(sku.id, { ...sku });
    }
    return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private toValidatorCandidate(
    snapshot: Record<string, unknown>,
    skus: ProfitSafetySku[],
  ): ProfitSafetyCandidate {
    const captainConfig = this.readCaptainConfig(snapshot[CAPTAIN_SEAFOOD_CONFIG_KEY]);
    return {
      markupRate: this.readNumber(snapshot.MARKUP_RATE, CONFIG_DEFAULTS.MARKUP_RATE),
      vipDiscountRate: this.readNumber(
        snapshot.VIP_DISCOUNT_RATE,
        CONFIG_DEFAULTS.VIP_DISCOUNT_RATE,
      ),
      vip: {
        rewardProfitRate: this.readNumber(
          snapshot.VIP_REWARD_PERCENT,
          CONFIG_DEFAULTS.VIP_REWARD_PERCENT,
        ),
        directReferralProfitRate: this.readNumber(
          snapshot.VIP_DIRECT_REFERRAL_PERCENT,
          CONFIG_DEFAULTS.VIP_DIRECT_REFERRAL_PERCENT,
        ),
        industryFundProfitRate: this.readNumber(
          snapshot.VIP_INDUSTRY_FUND_PERCENT,
          CONFIG_DEFAULTS.VIP_INDUSTRY_FUND_PERCENT,
        ),
      },
      normal: {
        rewardProfitRate: this.readNumber(
          snapshot.NORMAL_REWARD_PERCENT,
          CONFIG_DEFAULTS.NORMAL_REWARD_PERCENT,
        ),
        directReferralProfitRate: this.readNumber(
          snapshot.NORMAL_DIRECT_REFERRAL_PERCENT,
          CONFIG_DEFAULTS.NORMAL_DIRECT_REFERRAL_PERCENT,
        ),
        industryFundProfitRate: this.readNumber(
          snapshot.NORMAL_INDUSTRY_FUND_PERCENT,
          CONFIG_DEFAULTS.NORMAL_INDUSTRY_FUND_PERCENT,
        ),
      },
      captainConfig,
      skus,
    };
  }

  private readCaptainConfig(value: unknown): CaptainSeafoodConfig {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return cloneCaptainSeafoodConfig(value as CaptainSeafoodConfig);
    }
    return value as CaptainSeafoodConfig;
  }

  private readNumber(value: unknown, fallback: number): number {
    return value === undefined ? fallback : Number(value);
  }

  private unwrapRuleValue(value: unknown): unknown {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, 'value')
    ) {
      return (value as { value: unknown }).value;
    }
    return value;
  }

  private isSerializationFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
    return candidate.code === 'P2034'
      || candidate.code === '40001'
      || candidate.meta?.code === '40001'
      || (typeof candidate.message === 'string'
        && candidate.message.includes('could not serialize access'));
  }
}
