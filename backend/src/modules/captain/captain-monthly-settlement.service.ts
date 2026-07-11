import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CAPTAIN_SEAFOOD_PROGRAM_CODE } from './captain.constants';
import type { CaptainSeafoodConfigV3 } from './captain.types';

type Tx = Prisma.TransactionClient;

type MonthFacts = {
  grossEligibleGmv: number;
  refundedEligibleGmv: number;
  netEligibleGmv: number;
  directEffectiveBuyers: number;
  newEffectiveBuyers: number;
  refundRate: number;
};

type MetricInput = {
  captainUserId: string;
  month: string;
  programCode: string;
  personalGmv: number;
  teamGmv: number;
  directEffectiveBuyers: number;
  teamEffectiveMembers: number;
  newEffectiveMembers: number;
  refundRate: number;
  qualified: boolean;
  qualifiedTier: string | null;
  configSnapshot: Prisma.InputJsonValue;
};

type CategoryCents = {
  baseManagement: number;
  growth: number;
  cultivation: number;
  performance: number;
};

type OrderSettlementResult = {
  attribution: any;
  config: CaptainSeafoodConfigV3;
  configVersion: string;
  qualified: boolean;
  tier: string | null;
  profitBaseCents: number;
  reservedCents: number;
  releasedCents: number;
  holdLedgerId: string | null;
  categories: CategoryCents;
  totalCents: number;
  taxCents: number;
};

type MonthContext = {
  attributions: any[];
  facts: MonthFacts;
};

const SERIALIZABLE_MAX_RETRIES = 3;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class CaptainMonthlySettlementService {
  private readonly logger = new Logger(CaptainMonthlySettlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateMetrics(month: string, captainUserId?: string): Promise<MetricInput[]> {
    return this.withSerializableRetry(async (tx) => {
      const captainIds = await this.listCaptainIds(
        tx,
        month,
        CAPTAIN_SEAFOOD_PROGRAM_CODE,
        captainUserId,
      );
      const metrics: MetricInput[] = [];
      for (const id of captainIds) {
        const context = await this.loadMonthContext(
          tx,
          month,
          id,
          CAPTAIN_SEAFOOD_PROGRAM_CODE,
        );
        if (context.attributions.length === 0) continue;
        const results = context.attributions.map((attribution) =>
          this.calculateOrderSettlement(attribution, context.facts));
        const metric = this.toMetricInput(
          month,
          id,
          CAPTAIN_SEAFOOD_PROGRAM_CODE,
          context,
          results,
        );
        await this.upsertMetric(tx, metric);
        metrics.push(metric);
      }
      return metrics;
    });
  }

  async getReviewBlockReason(settlement: any): Promise<string | null> {
    return this.findReviewBlockReason(this.prisma as unknown as Tx, settlement);
  }

  async createDraftSettlements(
    month: string,
    captainUserId?: string,
    forceRecalculate = false,
  ): Promise<any[]> {
    this.assertMonthClosed(month);
    return this.withSerializableRetry(async (tx) => {
      const captainIds = await this.listCaptainIds(
        tx,
        month,
        CAPTAIN_SEAFOOD_PROGRAM_CODE,
        captainUserId,
      );
      const settlements: any[] = [];

      for (const id of captainIds) {
        const context = await this.loadMonthContext(
          tx,
          month,
          id,
          CAPTAIN_SEAFOOD_PROGRAM_CODE,
        );
        if (context.attributions.length === 0) continue;
        await this.assertNoPendingReconciliation(tx, {
          captainUserId: id,
          month,
          configSnapshot: { schemaVersion: 3 },
        });

        const existing = await (tx as any).captainMonthlySettlement.findUnique({
          where: {
            captainUserId_month_programCode: {
              captainUserId: id,
              month,
              programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
            },
          },
        });
        if (existing && ['APPROVED', 'PAID'].includes(existing.status)) {
          settlements.push(existing);
          continue;
        }
        if (existing && !this.isV3Settlement(existing)) {
          throw new BadRequestException('历史 V2 结算不可重新计算');
        }
        if (existing && !['DRAFT', 'PENDING_REVIEW'].includes(existing.status)) {
          throw new BadRequestException('当前结算状态不可重新计算');
        }

        const sourceFingerprint = this.sourceFingerprint(context);
        if (
          existing
          && !forceRecalculate
          && existing.meta?.sourceFingerprint === sourceFingerprint
        ) {
          settlements.push(existing);
          continue;
        }

        const orderResults = context.attributions.map((attribution) =>
          this.calculateOrderSettlement(attribution, context.facts));
        const metricInput = this.toMetricInput(
          month,
          id,
          CAPTAIN_SEAFOOD_PROGRAM_CODE,
          context,
          orderResults,
        );
        const metric = await this.upsertMetric(tx, metricInput);
        const aggregate = this.aggregateOrderResults(orderResults);
        const configSnapshot = this.monthConfigSnapshot(orderResults);
        const settlementData = {
          metricId: metric.id,
          status: 'DRAFT',
          baseManagementAmount: this.fromCents(aggregate.categories.baseManagement),
          growthBonusAmount: this.fromCents(aggregate.categories.growth),
          cultivationBonusAmount: this.fromCents(aggregate.categories.cultivation),
          teamPoolAmount: this.fromCents(aggregate.categories.performance),
          totalAmount: this.fromCents(aggregate.totalCents),
          taxAmount: this.fromCents(aggregate.taxCents),
          netAmount: this.fromCents(Math.max(0, aggregate.totalCents - aggregate.taxCents)),
          reviewedByAdminId: null,
          paidByAdminId: null,
          reviewedAt: null,
          paidAt: null,
          rejectReason: null,
          configSnapshot,
          meta: {
            calculationModel: 'PROFIT_V3_ORDER_SNAPSHOT',
            monthFacts: context.facts,
            configVersions: [...new Set(orderResults.map((item) => item.configVersion))],
            orderCount: orderResults.length,
            sourceFingerprint,
          },
        };

        let settlement: any;
        if (existing) {
          await (tx as any).captainMonthlySettlementOrder.deleteMany({
            where: { settlementId: existing.id },
          });
          settlement = await (tx as any).captainMonthlySettlement.update({
            where: { id: existing.id },
            data: settlementData,
          });
        } else {
          settlement = await (tx as any).captainMonthlySettlement.create({
            data: {
              captainUserId: id,
              month,
              programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
              ...settlementData,
            },
          });
        }

        for (const result of orderResults) {
          await this.upsertSettlementOrder(tx, settlement.id, result);
          await this.syncUnusedReserveRelease(tx, settlement, result);
        }
        settlements.push(settlement);
      }

      return settlements;
    });
  }

  async approveSettlement(settlementId: string, adminUserId: string): Promise<any> {
    return this.withSerializableRetry(async (tx) => {
      const settlement = await (tx as any).captainMonthlySettlement.findUnique({
        where: { id: settlementId },
      });
      if (!settlement) throw new NotFoundException('团长月度结算不存在');
      this.assertMonthClosed(settlement.month);
      if (!['DRAFT', 'PENDING_REVIEW'].includes(settlement.status)) {
        if (settlement.status === 'APPROVED' || settlement.status === 'PAID') return settlement;
        throw new BadRequestException('当前结算状态无法审核通过');
      }

      await this.assertDraftCurrent(tx, settlement);
      await this.assertNoPendingReconciliation(tx, settlement);
      await this.createMonthlyRewardLedgers(tx, settlement);
      return (tx as any).captainMonthlySettlement.update({
        where: { id: settlementId },
        data: {
          status: 'APPROVED',
          reviewedByAdminId: adminUserId,
          reviewedAt: new Date(),
        },
      });
    });
  }

  async markPaid(settlementId: string, adminUserId: string): Promise<any> {
    return this.withSerializableRetry(async (tx) => {
      const settlement = await (tx as any).captainMonthlySettlement.findUnique({
        where: { id: settlementId },
      });
      if (!settlement) throw new NotFoundException('团长月度结算不存在');
      this.assertMonthClosed(settlement.month);
      if (settlement.status !== 'APPROVED') {
        if (settlement.status === 'PAID') return settlement;
        throw new BadRequestException('仅已审核结算可标记已支付');
      }

      await this.assertNoPendingReconciliation(tx, settlement);
      const ledgers = await (tx as any).captainCommissionLedger.findMany({
        where: {
          settlementId,
          status: 'AVAILABLE',
          deletedAt: null,
        },
        select: {
          accountId: true,
          amount: true,
        },
      });
      const payoutByAccount = new Map<string, number>();
      let payoutTotalCents = 0;
      for (const ledger of ledgers ?? []) {
        const amountCents = this.toNonNegativeCents(ledger.amount, '月度佣金流水金额');
        if (amountCents === 0) continue;
        payoutTotalCents += amountCents;
        payoutByAccount.set(
          ledger.accountId,
          (payoutByAccount.get(ledger.accountId) ?? 0) + amountCents,
        );
      }
      const settlementTotalCents = this.toNonNegativeCents(settlement.totalAmount, '月度结算总额');
      if (payoutTotalCents !== settlementTotalCents) {
        throw new BadRequestException('结算流水合计与结算金额不一致，不能标记已支付');
      }

      for (const [accountId, amountCents] of payoutByAccount.entries()) {
        const account = await (tx as any).captainAccount.findUnique({
          where: { id: accountId },
          select: { id: true, balance: true },
        });
        if (!account || this.toNonNegativeCents(account.balance, '团长账户余额') < amountCents) {
          throw new BadRequestException('团长账户余额不足，无法标记已支付');
        }
        const amount = this.fromCents(amountCents);
        await (tx as any).captainAccount.update({
          where: { id: accountId },
          data: {
            balance: { decrement: amount },
            withdrawn: { increment: amount },
          },
        });
      }

      await (tx as any).captainCommissionLedger.updateMany({
        where: {
          settlementId,
          status: 'AVAILABLE',
          deletedAt: null,
        },
        data: { status: 'WITHDRAWN' },
      });

      return (tx as any).captainMonthlySettlement.update({
        where: { id: settlementId },
        data: {
          status: 'PAID',
          paidByAdminId: adminUserId,
          paidAt: new Date(),
        },
      });
    });
  }

  async recalculateSettlement(settlementId: string, adminUserId: string): Promise<any> {
    const settlement = await (this.prisma as any).captainMonthlySettlement.findUnique({
      where: { id: settlementId },
    });
    if (!settlement) throw new NotFoundException('团长月度结算不存在');
    if (settlement.status === 'APPROVED' || settlement.status === 'PAID') {
      throw new BadRequestException('已审核或已支付结算不可重算');
    }
    if (!this.isV3Settlement(settlement)) {
      throw new BadRequestException('历史 V2 结算仅可审核或支付，不可重新计算');
    }

    const [draft] = await this.createDraftSettlements(
      settlement.month,
      settlement.captainUserId,
      true,
    );
    if (!draft || draft.captainUserId !== settlement.captainUserId) {
      this.logger.warn(`团长结算重算未返回目标结算: settlementId=${settlementId}, adminUserId=${adminUserId}`);
      throw new BadRequestException('团长结算重算失败');
    }
    return draft;
  }

  private async listCaptainIds(
    tx: Tx,
    month: string,
    programCode: string,
    captainUserId?: string,
  ): Promise<string[]> {
    const { start, end } = this.monthRange(month);
    const rows = await (tx as any).captainOrderAttribution.findMany({
      where: {
        programCode,
        calculationModel: 'PROFIT_V3',
        order: { paidAt: { gte: start, lt: end } },
        ...(captainUserId ? { directCaptainUserId: captainUserId } : {}),
      },
      select: { directCaptainUserId: true },
      distinct: ['directCaptainUserId'],
    });
    const captainIds = new Set<string>();
    for (const row of rows ?? []) {
      if (typeof row.directCaptainUserId === 'string' && row.directCaptainUserId.length > 0) {
        captainIds.add(row.directCaptainUserId);
      }
    }
    return [...captainIds];
  }

  private async loadMonthContext(
    tx: Tx,
    month: string,
    captainUserId: string,
    programCode: string,
  ): Promise<MonthContext> {
    const { start, end } = this.monthRange(month);
    const attributions = await (tx as any).captainOrderAttribution.findMany({
      where: {
        programCode,
        calculationModel: 'PROFIT_V3',
        directCaptainUserId: captainUserId,
        order: { paidAt: { gte: start, lt: end } },
      },
      include: {
        order: {
          select: { paidAt: true },
        },
        profitSnapshot: {
          select: {
            fundingLedgers: {
              where: {
                type: {
                  in: [
                    'CAPTAIN_MONTHLY_HOLD',
                    'CAPTAIN_MONTHLY_RELEASE',
                    'REFUND_ADJUSTMENT',
                  ],
                },
              },
              select: { id: true, type: true, amount: true, sourceLedgerId: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const buyerNetCents = new Map<string, number>();
    let grossCents = 0;
    let refundCents = 0;
    for (const attribution of attributions ?? []) {
      const eligibleCents = this.toNonNegativeCents(
        attribution.eligibleGoodsAmount,
        '团长可计入商品 GMV',
      );
      const rawRefundCents = this.toNonNegativeCents(
        attribution.refundAmount,
        '团长订单退款金额',
      );
      const validRefundCents = Math.min(eligibleCents, rawRefundCents);
      const netCents = eligibleCents - validRefundCents;
      grossCents += eligibleCents;
      refundCents += validRefundCents;
      this.assertSafeCents(grossCents, '团长月度总 GMV');
      this.assertSafeCents(refundCents, '团长月度退款总额');
      buyerNetCents.set(
        attribution.buyerUserId,
        (buyerNetCents.get(attribution.buyerUserId) ?? 0) + netCents,
      );
    }
    const effectiveBuyerIds = new Set(
      [...buyerNetCents.entries()]
        .filter(([, amount]) => amount > 0)
        .map(([buyerUserId]) => buyerUserId),
    );
    const relations = effectiveBuyerIds.size > 0
      ? await (tx as any).captainRelation.findMany({
        where: {
          programCode,
          directCaptainUserId: captainUserId,
          buyerUserId: { in: [...effectiveBuyerIds] },
        },
        select: { buyerUserId: true, boundAt: true },
      })
      : [];
    const newEffectiveBuyerIds = new Set(
      (relations ?? [])
        .filter((relation: any) => {
          const boundAt = relation.boundAt instanceof Date
            ? relation.boundAt
            : new Date(relation.boundAt);
          return effectiveBuyerIds.has(relation.buyerUserId)
            && Number.isFinite(boundAt.getTime())
            && boundAt >= start
            && boundAt < end;
        })
        .map((relation: any) => relation.buyerUserId),
    );
    const netCents = grossCents - refundCents;

    return {
      attributions: attributions ?? [],
      facts: {
        grossEligibleGmv: this.fromCents(grossCents),
        refundedEligibleGmv: this.fromCents(refundCents),
        netEligibleGmv: this.fromCents(netCents),
        directEffectiveBuyers: effectiveBuyerIds.size,
        newEffectiveBuyers: newEffectiveBuyerIds.size,
        refundRate: grossCents > 0 ? refundCents / grossCents : 0,
      },
    };
  }

  private calculateOrderSettlement(
    attribution: any,
    facts: MonthFacts,
  ): OrderSettlementResult {
    const config = attribution.configSnapshot as CaptainSeafoodConfigV3;
    if (!config || config.schemaVersion !== 3 || config.programCode !== attribution.programCode) {
      throw new BadRequestException('团长 V3 订单缺少有效的配置快照');
    }
    const configVersion = typeof attribution.profitConfigVersion === 'string'
      ? attribution.profitConfigVersion
      : '';
    if (!configVersion) throw new BadRequestException('团长 V3 订单缺少利润配置版本');

    const originalProfitBaseCents = this.toNonNegativeCents(
      attribution.profitBaseAmount,
      '团长订单利润基数',
    );
    const {
      cents: reservedCents,
      originalCents: originalReservedCents,
      ledgerId: holdLedgerId,
    } = this.monthlyReserve(attribution);
    const profitBaseCents = originalReservedCents > 0
      ? this.scaleCents(originalProfitBaseCents, reservedCents, originalReservedCents)
      : originalProfitBaseCents;
    if (profitBaseCents === 0 && reservedCents !== 0) {
      throw new BadRequestException('零利润团长订单不应存在月度预留');
    }

    const qualified = this.isQualified(facts, config);
    const tier = qualified ? this.resolveTier(facts.netEligibleGmv, config) : null;
    const rates = this.monthlyRates(config, tier);
    const requestedCents = this.roundRateAmount(profitBaseCents, Object.values(rates)
      .reduce((sum, rate) => sum + rate, 0));
    const totalCents = Math.min(reservedCents, requestedCents);
    const categories = this.allocateCategories(totalCents, rates);
    const taxCents = config.tax?.enabled
      ? this.roundRateAmount(totalCents, this.readRate(config.tax.withholdingRate, '劳务个税代扣率'))
      : 0;

    return {
      attribution,
      config,
      configVersion,
      qualified,
      tier,
      profitBaseCents,
      reservedCents,
      releasedCents: reservedCents - totalCents,
      holdLedgerId,
      categories,
      totalCents,
      taxCents,
    };
  }

  private monthlyReserve(attribution: any): {
    cents: number;
    originalCents: number;
    ledgerId: string | null;
  } {
    const ledgers = attribution.profitSnapshot?.fundingLedgers ?? [];
    const holds = ledgers.filter((item: any) => item.type === 'CAPTAIN_MONTHLY_HOLD');
    if (holds.length > 0) {
      let signedCents = 0;
      let originalSignedCents = 0;
      for (const hold of holds) {
        const holdCents = this.toSignedCents(hold.amount, '团长月度预留流水');
        signedCents += holdCents;
        originalSignedCents += holdCents;
        for (const adjustment of ledgers.filter((item: any) => (
          item.type === 'REFUND_ADJUSTMENT' && item.sourceLedgerId === hold.id
        ))) {
          signedCents += this.toSignedCents(adjustment.amount, '团长月度预留退款调整');
        }
        if (!Number.isSafeInteger(signedCents) || !Number.isSafeInteger(originalSignedCents)) {
          throw new BadRequestException('团长月度预留净额超出安全范围');
        }
      }
      if (signedCents > 0 || originalSignedCents > 0) {
        throw new BadRequestException('团长月度预留流水方向错误');
      }
      return {
        cents: Math.abs(signedCents),
        originalCents: Math.abs(originalSignedCents),
        ledgerId: holds[0].id ?? null,
      };
    }
    const fallbackCents = this.toNonNegativeCents(
      attribution.meta?.monthlyMaximum ?? 0,
      '团长月度预留上限',
    );
    return {
      cents: fallbackCents,
      originalCents: fallbackCents,
      ledgerId: null,
    };
  }

  private isQualified(facts: MonthFacts, config: CaptainSeafoodConfigV3): boolean {
    const qualification = config.monthlyQualification;
    if (!qualification) throw new BadRequestException('团长 V3 配置缺少月度资格条件');
    if (facts.directEffectiveBuyers < qualification.minDirectEffectiveBuyers) return false;
    if (facts.netEligibleGmv < qualification.minDirectMonthlyGmv) return false;
    if (facts.newEffectiveBuyers < qualification.minNewEffectiveBuyers) return false;
    if (
      config.risk?.holdSettlementOnRisk
      && facts.refundRate > this.readRate(config.risk.maxMonthlyRefundRate, '月度最高退款率')
    ) {
      return false;
    }
    return true;
  }

  private resolveTier(teamGmv: number, config: CaptainSeafoodConfigV3): string {
    if (teamGmv >= config.monthlyRewards.excellentTierGmv) return 'EXCELLENT';
    if (teamGmv >= config.monthlyRewards.growthTierGmv) return 'GROWTH';
    if (teamGmv >= config.monthlyRewards.baseTierGmv) return 'BASE';
    return 'QUALIFIED';
  }

  private monthlyRates(config: CaptainSeafoodConfigV3, tier: string | null): Record<keyof CategoryCents, number> {
    const rewards = config.monthlyRewards;
    const zero = { baseManagement: 0, growth: 0, cultivation: 0, performance: 0 };
    if (!tier || tier === 'QUALIFIED') return zero;
    return {
      baseManagement: this.readRate(rewards.baseManagementProfitRate, '管理津贴利润率'),
      growth: tier === 'GROWTH' || tier === 'EXCELLENT'
        ? this.readRate(rewards.growthBonusProfitRate, '增长奖利润率')
        : 0,
      cultivation: tier === 'EXCELLENT'
        ? this.readRate(rewards.cultivationBonusProfitRate, '培育奖利润率')
        : 0,
      performance: this.readRate(rewards.performanceBonusProfitRate, '绩效奖利润率'),
    };
  }

  private allocateCategories(
    totalCents: number,
    rates: Record<keyof CategoryCents, number>,
  ): CategoryCents {
    const keys: (keyof CategoryCents)[] = [
      'baseManagement',
      'growth',
      'cultivation',
      'performance',
    ];
    const totalRate = keys.reduce((sum, key) => sum + rates[key], 0);
    const result: CategoryCents = {
      baseManagement: 0,
      growth: 0,
      cultivation: 0,
      performance: 0,
    };
    if (totalCents === 0 || totalRate === 0) return result;

    const shares = keys.map((key, index) => {
      const raw = totalCents * rates[key] / totalRate;
      const floor = Math.floor(raw);
      result[key] = floor;
      return { key, index, remainder: raw - floor };
    });
    let remaining = totalCents - keys.reduce((sum, key) => sum + result[key], 0);
    shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let index = 0; index < remaining; index++) {
      result[shares[index % shares.length].key] += 1;
    }
    return result;
  }

  private aggregateOrderResults(results: OrderSettlementResult[]) {
    const categories: CategoryCents = {
      baseManagement: 0,
      growth: 0,
      cultivation: 0,
      performance: 0,
    };
    let totalCents = 0;
    let taxCents = 0;
    for (const result of results) {
      categories.baseManagement += result.categories.baseManagement;
      categories.growth += result.categories.growth;
      categories.cultivation += result.categories.cultivation;
      categories.performance += result.categories.performance;
      totalCents += result.totalCents;
      taxCents += result.taxCents;
      this.assertSafeCents(totalCents, '团长月度奖励总额');
      this.assertSafeCents(taxCents, '团长月度代扣个税');
    }
    return { categories, totalCents, taxCents };
  }

  private toMetricInput(
    month: string,
    captainUserId: string,
    programCode: string,
    context: MonthContext,
    results: OrderSettlementResult[],
  ): MetricInput {
    const qualifiedResults = results.filter((item) => item.qualified);
    const qualifiedTier = qualifiedResults
      .map((item) => item.tier)
      .sort((a, b) => this.tierRank(b) - this.tierRank(a))[0] ?? null;
    return {
      captainUserId,
      month,
      programCode,
      personalGmv: context.facts.netEligibleGmv,
      teamGmv: context.facts.netEligibleGmv,
      directEffectiveBuyers: context.facts.directEffectiveBuyers,
      teamEffectiveMembers: context.facts.directEffectiveBuyers,
      newEffectiveMembers: context.facts.newEffectiveBuyers,
      refundRate: context.facts.refundRate,
      qualified: qualifiedResults.length > 0,
      qualifiedTier,
      configSnapshot: this.monthConfigSnapshot(results),
    };
  }

  private tierRank(tier: string | null): number {
    return ({ QUALIFIED: 1, BASE: 2, GROWTH: 3, EXCELLENT: 4 } as Record<string, number>)[tier ?? ''] ?? 0;
  }

  private monthConfigSnapshot(results: OrderSettlementResult[]): Prisma.InputJsonValue {
    return {
      schemaVersion: 3,
      calculationModel: 'PROFIT_V3_ORDER_SNAPSHOT',
      configVersions: [...new Set(results.map((item) => item.configVersion))],
    } as Prisma.InputJsonValue;
  }

  private async upsertMetric(tx: Tx, input: MetricInput): Promise<any> {
    const data = {
      personalGmv: input.personalGmv,
      teamGmv: input.teamGmv,
      directEffectiveBuyers: input.directEffectiveBuyers,
      teamEffectiveMembers: input.teamEffectiveMembers,
      newEffectiveMembers: input.newEffectiveMembers,
      refundRate: input.refundRate,
      qualified: input.qualified,
      qualifiedTier: input.qualifiedTier,
      configSnapshot: input.configSnapshot,
    };
    return (tx as any).captainMonthlyMetric.upsert({
      where: {
        captainUserId_month_programCode: {
          captainUserId: input.captainUserId,
          month: input.month,
          programCode: input.programCode,
        },
      },
      update: data,
      create: {
        captainUserId: input.captainUserId,
        month: input.month,
        programCode: input.programCode,
        ...data,
      },
    });
  }

  private async upsertSettlementOrder(
    tx: Tx,
    settlementId: string,
    result: OrderSettlementResult,
  ): Promise<void> {
    const data = {
      settlementId,
      configVersion: result.configVersion,
      profitBaseAmount: this.fromCents(result.profitBaseCents),
      baseManagementAmount: this.fromCents(result.categories.baseManagement),
      growthBonusAmount: this.fromCents(result.categories.growth),
      cultivationBonusAmount: this.fromCents(result.categories.cultivation),
      performanceBonusAmount: this.fromCents(result.categories.performance),
      reservedAmount: this.fromCents(result.reservedCents),
      releasedAmount: this.fromCents(result.releasedCents),
      reversedAmount: 0,
    };
    await (tx as any).captainMonthlySettlementOrder.upsert({
      where: { orderAttributionId: result.attribution.id },
      update: data,
      create: {
        orderAttributionId: result.attribution.id,
        ...data,
      },
    });
  }

  private async syncUnusedReserveRelease(
    tx: Tx,
    settlement: any,
    result: OrderSettlementResult,
  ): Promise<void> {
    const idempotencyKey = `captain:v3:funding:${result.attribution.orderId}:monthly-release:${result.attribution.id}`;
    const existing = await (tx as any).orderProfitFundingLedger.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (!existing && result.releasedCents === 0) return;
    const ledgers = result.attribution.profitSnapshot?.fundingLedgers ?? [];
    const releaseAdjustmentCents = existing
      ? ledgers
          .filter((ledger: any) => (
            ledger.type === 'REFUND_ADJUSTMENT' && ledger.sourceLedgerId === existing.id
          ))
          .reduce(
            (sum: number, ledger: any) => sum
              + this.toSignedCents(ledger.amount, '团长月度释放退款调整'),
            0,
          )
      : 0;
    const sourceReleaseCents = result.releasedCents - releaseAdjustmentCents;
    if (!Number.isSafeInteger(sourceReleaseCents) || sourceReleaseCents < 0) {
      throw new BadRequestException('团长月度释放源金额无效');
    }
    const amount = this.fromCents(sourceReleaseCents);
    const data = {
      amount,
      configVersion: result.configVersion,
      sourceLedgerId: result.holdLedgerId,
      meta: {
        calculationModel: 'PROFIT_V3_MONTHLY_SETTLEMENT',
        settlementId: settlement.id,
        month: settlement.month,
        orderAttributionId: result.attribution.id,
        reservedAmount: this.fromCents(result.reservedCents),
        actualMonthlyAmount: this.fromCents(result.totalCents),
      },
    };
    await (tx as any).orderProfitFundingLedger.upsert({
      where: { idempotencyKey },
      update: data,
      create: {
        snapshotId: result.attribution.profitSnapshotId,
        orderId: result.attribution.orderId,
        type: 'CAPTAIN_MONTHLY_RELEASE',
        idempotencyKey,
        ...data,
      },
    });
  }

  private async assertNoPendingReconciliation(tx: Tx, settlement: any): Promise<void> {
    const reason = await this.findReviewBlockReason(tx, settlement);
    if (reason) throw new BadRequestException(reason);
  }

  private async findReviewBlockReason(tx: Tx, settlement: any): Promise<string | null> {
    if (!this.isV3Settlement(settlement)) return null;
    const { start, end } = this.monthRange(settlement.month);
    const where: Prisma.OrderProfitReconciliationTaskWhereInput = {
      status: 'PENDING',
      order: {
        paidAt: { gte: start, lt: end },
      },
      sourceSnapshot: {
        ruleSnapshot: {
          path: ['captain', 'directCaptainUserId'],
          equals: settlement.captainUserId,
        },
      },
    };
    const pending = await (tx as any).orderProfitReconciliationTask.findFirst({
      where,
      select: { id: true },
    });
    if (pending) {
      return '结算订单存在未解决的利润对账任务，不可审核或支付';
    }
    const pendingAdjustment = await (tx as any).orderProfitAdjustmentDraft.findFirst({
      where: {
        status: 'PENDING',
        order: {
          paidAt: { gte: start, lt: end },
        },
        targetSnapshot: {
          ruleSnapshot: {
            path: ['captain', 'directCaptainUserId'],
            equals: settlement.captainUserId,
          },
        },
      },
      select: { id: true },
    });
    if (pendingAdjustment) {
      return '结算订单存在待审批的利润补差，不可审核或支付';
    }
    return null;
  }

  private async assertDraftCurrent(tx: Tx, settlement: any): Promise<void> {
    if (!this.isV3Settlement(settlement)) return;
    const context = await this.loadMonthContext(
      tx,
      settlement.month,
      settlement.captainUserId,
      settlement.programCode,
    );
    const savedFingerprint = settlement.meta?.sourceFingerprint;
    const currentFingerprint = this.sourceFingerprint(context);
    if (
      typeof savedFingerprint !== 'string'
      || savedFingerprint.length === 0
      || savedFingerprint !== currentFingerprint
    ) {
      throw new BadRequestException('月结草稿数据已变化，请重新生成后再审核');
    }
  }

  private sourceFingerprint(context: MonthContext): string {
    const rows = context.attributions.map((attribution) => ({
      id: attribution.id,
      orderId: attribution.orderId,
      paidAt: attribution.order?.paidAt instanceof Date
        ? attribution.order.paidAt.toISOString()
        : String(attribution.order?.paidAt ?? ''),
      updatedAt: attribution.updatedAt instanceof Date
        ? attribution.updatedAt.toISOString()
        : String(attribution.updatedAt ?? ''),
      eligibleGoodsAmount: attribution.eligibleGoodsAmount,
      refundAmount: attribution.refundAmount,
      profitBaseAmount: attribution.profitBaseAmount,
      profitConfigVersion: attribution.profitConfigVersion,
      status: attribution.status,
      monthlyHolds: (attribution.profitSnapshot?.fundingLedgers ?? []).map((ledger: any) => ({
        id: ledger.id,
        amount: ledger.amount,
      })),
    }));
    return createHash('sha256')
      .update(JSON.stringify({ facts: context.facts, rows }))
      .digest('hex');
  }

  private async createMonthlyRewardLedgers(tx: Tx, settlement: any): Promise<void> {
    const entries = [
      { type: 'MANAGEMENT_ALLOWANCE', amount: settlement.baseManagementAmount, keySuffix: 'management' },
      { type: 'GROWTH_BONUS', amount: settlement.growthBonusAmount, keySuffix: 'growth' },
      { type: 'CULTIVATION_BONUS', amount: settlement.cultivationBonusAmount, keySuffix: 'cultivation' },
      { type: 'PERFORMANCE_BONUS', amount: settlement.teamPoolAmount, keySuffix: 'performance' },
    ];
    for (const entry of entries) {
      const amountCents = this.toNonNegativeCents(entry.amount, '团长月度奖励金额');
      await this.createMonthlyLedger(tx, settlement, {
        userId: settlement.captainUserId,
        type: entry.type,
        amount: this.fromCents(amountCents),
        keySuffix: entry.keySuffix,
      });
    }
  }

  private async createMonthlyLedger(
    tx: Tx,
    settlement: any,
    entry: { userId: string; type: string; amount: number; keySuffix: string },
  ): Promise<void> {
    const idempotencyKey = `captain:month:${settlement.month}:${entry.userId}:${entry.keySuffix}`;
    const existing = await (tx as any).captainCommissionLedger.findUnique?.({
      where: { idempotencyKey },
      select: { id: true, accountId: true, amount: true, status: true, meta: true },
    });
    if (existing) {
      await this.reviseMonthlyLedger(tx, existing, entry.amount);
      return;
    }
    if (entry.amount === 0) return;
    const account = await (tx as any).captainAccount.upsert({
      where: {
        userId_programCode: {
          userId: entry.userId,
          programCode: settlement.programCode,
        },
      },
      update: {},
      create: {
        userId: entry.userId,
        programCode: settlement.programCode,
      },
    });
    const balanceAfter = this.fromCents(
      this.toNonNegativeCents(account.balance, '团长账户余额')
      + this.toNonNegativeCents(entry.amount, '团长月度奖励金额'),
    );
    await (tx as any).captainCommissionLedger.create({
      data: {
        accountId: account.id,
        userId: entry.userId,
        settlementId: settlement.id,
        programCode: settlement.programCode,
        type: entry.type,
        status: 'AVAILABLE',
        amount: entry.amount,
        balanceAfter,
        idempotencyKey,
        refType: 'MONTHLY_SETTLEMENT',
        refId: settlement.id,
        configSnapshot: settlement.configSnapshot,
        meta: {
          month: settlement.month,
          sourceCaptainUserId: settlement.captainUserId,
        },
      },
    });
    await (tx as any).captainAccount.update({
      where: { id: account.id },
      data: { balance: { increment: entry.amount } },
    });
  }

  private async reviseMonthlyLedger(
    tx: Tx,
    existing: any,
    targetAmount: number,
  ): Promise<void> {
    if (!['AVAILABLE', 'CLAWBACK_PENDING', 'VOIDED'].includes(existing.status)) {
      throw new BadRequestException('已支付的团长月奖流水不可修订');
    }
    const beforeCents = this.toNonNegativeCents(existing.amount, '团长月奖原金额');
    const targetCents = this.toNonNegativeCents(targetAmount, '团长月奖目标金额');
    const deltaCents = targetCents - beforeCents;
    if (deltaCents === 0) return;
    const trackedClawbackCents = existing.status === 'CLAWBACK_PENDING'
      ? Number(existing.meta?.monthlyClawbackCents)
      : 0;
    if (
      !Number.isSafeInteger(trackedClawbackCents)
      || trackedClawbackCents < 0
      || (existing.status === 'CLAWBACK_PENDING' && trackedClawbackCents === 0)
    ) {
      throw new BadRequestException('团长月奖待追缴流水缺少可归属的 clawback 金额');
    }

    const account = await (tx as any).captainAccount.findUnique({
      where: { id: existing.accountId },
      select: { id: true, balance: true, clawback: true },
    });
    if (!account) throw new BadRequestException('团长月奖账户不存在');
    const currentBalanceCents = this.toNonNegativeCents(account.balance, '团长账户余额');
    let nextBalanceCents = currentBalanceCents;
    const accountData: Record<string, unknown> = {};
    let clawbackCents = trackedClawbackCents;
    if (deltaCents > 0) {
      const accountClawbackCents = this.toNonNegativeCents(
        account.clawback ?? 0,
        '团长账户待追缴金额',
      );
      const repaidCents = Math.min(deltaCents, trackedClawbackCents);
      if (accountClawbackCents < repaidCents) {
        throw new BadRequestException('团长月奖流水与账户 clawback 不一致');
      }
      const creditedCents = deltaCents - repaidCents;
      clawbackCents -= repaidCents;
      if (repaidCents > 0) {
        accountData.clawback = { decrement: this.fromCents(repaidCents) };
      }
      if (creditedCents > 0) {
        accountData.balance = { increment: this.fromCents(creditedCents) };
        nextBalanceCents += creditedCents;
      }
    } else {
      const requestedCents = Math.abs(deltaCents);
      const recoveredCents = Math.min(currentBalanceCents, requestedCents);
      const addedClawbackCents = requestedCents - recoveredCents;
      clawbackCents += addedClawbackCents;
      if (recoveredCents > 0) {
        accountData.balance = { decrement: this.fromCents(recoveredCents) };
        nextBalanceCents -= recoveredCents;
      }
      if (addedClawbackCents > 0) {
        accountData.clawback = { increment: this.fromCents(addedClawbackCents) };
      }
    }
    await (tx as any).captainCommissionLedger.update({
      where: { id: existing.id },
      data: {
        amount: targetAmount,
        balanceAfter: this.fromCents(nextBalanceCents),
        status: clawbackCents > 0
          ? 'CLAWBACK_PENDING'
          : targetCents === 0 ? 'VOIDED' : 'AVAILABLE',
        meta: {
          ...(existing.meta ?? {}),
          monthlyClawbackCents: clawbackCents,
        },
      },
    });
    if (Object.keys(accountData).length > 0) {
      await (tx as any).captainAccount.update({
        where: { id: existing.accountId },
        data: accountData,
      });
    }
  }

  private isV3Settlement(settlement: any): boolean {
    return settlement?.configSnapshot?.schemaVersion === 3
      || settlement?.meta?.calculationModel === 'PROFIT_V3_ORDER_SNAPSHOT';
  }

  private monthRange(month: string): { start: Date; end: Date } {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    const year = match ? Number(match[1]) : NaN;
    const monthNumber = match ? Number(match[2]) : NaN;
    if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) {
      throw new BadRequestException('month 必须是 YYYY-MM');
    }
    return {
      start: new Date(Date.UTC(year, monthNumber - 1, 1) - SHANGHAI_OFFSET_MS),
      end: new Date(Date.UTC(year, monthNumber, 1) - SHANGHAI_OFFSET_MS),
    };
  }

  private assertMonthClosed(month: string): void {
    const { end } = this.monthRange(month);
    if (Date.now() < end.getTime()) {
      throw new BadRequestException('结算月份尚未闭合，不可审核或支付');
    }
  }

  private readRate(value: unknown, label: string): number {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new BadRequestException(`${label}无效`);
    }
    return rate;
  }

  private roundRateAmount(baseCents: number, rate: number): number {
    const amount = Math.round(baseCents * rate);
    this.assertSafeCents(amount, '团长月度奖励计算结果');
    return amount;
  }

  private scaleCents(amountCents: number, numerator: number, denominator: number): number {
    if (amountCents === 0 || numerator === 0) return 0;
    if (denominator <= 0 || numerator > denominator) {
      throw new BadRequestException('团长订单剩余利润比例无效');
    }
    const scaled = BigInt(amountCents) * BigInt(numerator);
    const divisor = BigInt(denominator);
    const result = (scaled * 2n + divisor) / (2n * divisor);
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BadRequestException('团长订单利润基数超出安全范围');
    }
    return Number(result);
  }

  private toNonNegativeCents(value: unknown, label: string): number {
    const cents = this.toSignedCents(value, label);
    if (cents < 0) throw new BadRequestException(`${label}不能为负数`);
    return cents;
  }

  private toSignedCents(value: unknown, label: string): number {
    const amount = Number(value);
    if (!Number.isFinite(amount)) throw new BadRequestException(`${label}无效`);
    const cents = Math.round((amount + Math.sign(amount) * Number.EPSILON) * 100);
    if (!Number.isSafeInteger(cents)) throw new BadRequestException(`${label}超出安全范围`);
    return cents;
  }

  private assertSafeCents(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException(`${label}超出安全范围`);
    }
  }

  private fromCents(cents: number): number {
    return cents / 100;
  }

  private async withSerializableRetry<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err: any) {
        if (
          (err?.code === 'P2034' || err?.code === 'P2002')
          && attempt < SERIALIZABLE_MAX_RETRIES - 1
        ) {
          this.logger.warn(`团长月度结算并发冲突，重试 ${attempt + 1}/${SERIALIZABLE_MAX_RETRIES}`);
          continue;
        }
        throw err;
      }
    }
    throw new Error('团长月度结算 Serializable 重试耗尽');
  }
}
