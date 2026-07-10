import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  cloneCaptainSeafoodConfig,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
} from '../captain/captain.constants';
import type { CaptainSeafoodConfig } from '../captain/captain.types';
import {
  ProfitSafetyCandidate,
  ProfitSafetySku,
  ProfitSafetySummary,
  ProfitSafetyValidator,
} from './profit-safety-validator';

export interface ProfitSafetyCandidateChange {
  ruleUpdates?: Record<string, unknown>;
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
    return this.prisma.$transaction(async (tx) => {
      await this.takeSafetyLock(tx);
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async preview(change: ProfitSafetyCandidateChange = {}): Promise<ProfitSafetySummary> {
    return this.prisma.$transaction(async (tx) => {
      await this.takeSafetyLock(tx);
      return (await this.buildContext(tx, change, false)).summary;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getCurrentSummary(): Promise<ProfitSafetySummary> {
    return this.preview();
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
    const candidateSnapshot = {
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
    const summary = assertSafe
      ? this.validator.assertSafe(candidate)
      : this.validator.evaluate(candidate);
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
        product: { status: 'ACTIVE' },
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
      ordinary: (row.product.lotteryPrizes?.length ?? 0) === 0
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
    return cloneCaptainSeafoodConfig(DEFAULT_CAPTAIN_SEAFOOD_CONFIG);
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
}
