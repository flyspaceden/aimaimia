import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
} from './captain.constants';
import { CaptainConfigService } from './captain-config.service';
import type { CaptainSeafoodConfigV2 } from './captain.types';

type Tx = Prisma.TransactionClient;
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
  configSnapshot: CaptainSeafoodConfigV2;
};
type PerformanceBonusSummary = {
  amount: number;
  recipientUserId: string;
};

const SERIALIZABLE_MAX_RETRIES = 3;

@Injectable()
export class CaptainMonthlySettlementService {
  private readonly logger = new Logger(CaptainMonthlySettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: CaptainConfigService,
  ) {}

  async calculateMetrics(month: string, captainUserId?: string): Promise<MetricInput[]> {
    const config = await this.configService.getSnapshot();
    if (!config.enabled || config.schemaVersion !== 2) return [];

    return this.withSerializableRetry(async (tx) => {
      const captains = captainUserId
        ? [{ userId: captainUserId }]
        : await (tx as any).captainProfile.findMany({
            where: {
              programCode: config.programCode,
              status: 'ACTIVE',
            },
            select: { userId: true },
            orderBy: { createdAt: 'asc' },
          });

      const metrics: MetricInput[] = [];
      for (const captain of captains) {
        metrics.push(await this.calculateMetricInTx(tx, month, captain.userId, config));
      }
      return metrics;
    });
  }

  async createDraftSettlements(
    month: string,
    captainUserId?: string,
    forceRecalculate = false,
  ): Promise<any[]> {
    const config = await this.configService.getSnapshot();
    if (!config.enabled || config.schemaVersion !== 2) return [];

    return this.withSerializableRetry(async (tx) => {
      const captains = captainUserId
        ? [{ userId: captainUserId }]
        : await (tx as any).captainProfile.findMany({
            where: {
              programCode: config.programCode,
              status: 'ACTIVE',
            },
            select: { userId: true },
            orderBy: { createdAt: 'asc' },
          });

      const settlements: any[] = [];
      for (const captain of captains) {
        const settlementWhere = {
          captainUserId_month_programCode: {
            captainUserId: captain.userId,
            month,
            programCode: config.programCode,
          },
        };
        const existingSettlement = await (tx as any).captainMonthlySettlement.findUnique({
          where: settlementWhere,
        });
        if (
          existingSettlement &&
          !forceRecalculate &&
          ['APPROVED', 'PAID'].includes(existingSettlement.status)
        ) {
          settlements.push(existingSettlement);
          continue;
        }

        const metricInput = await this.calculateMetricInTx(tx, month, captain.userId, config);
        const metric = await this.upsertMetric(tx, metricInput);
        const { performanceBonusSummary, ...amounts } = this.calculateSettlementAmounts(
          metricInput,
          config,
        );
        const updateData = {
          metricId: metric.id,
          status: 'DRAFT',
          ...amounts,
          reviewedByAdminId: null,
          paidByAdminId: null,
          reviewedAt: null,
          paidAt: null,
          rejectReason: null,
          configSnapshot: this.snapshot(config),
          meta: { performanceBonusSummary },
        };
        const settlement = existingSettlement
          ? await (tx as any).captainMonthlySettlement.update({
              where: settlementWhere,
              data: updateData,
            })
          : await (tx as any).captainMonthlySettlement.create({
              data: {
                captainUserId: captain.userId,
                metricId: metric.id,
                month,
                programCode: config.programCode,
                status: 'DRAFT',
                ...amounts,
                configSnapshot: this.snapshot(config),
                meta: { performanceBonusSummary },
              },
            });
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
      if (!['DRAFT', 'PENDING_REVIEW'].includes(settlement.status)) {
        if (settlement.status === 'APPROVED' || settlement.status === 'PAID') {
          return settlement;
        }
        throw new BadRequestException('当前结算状态无法审核通过');
      }

      const updated = await (tx as any).captainMonthlySettlement.update({
        where: { id: settlementId },
        data: {
          status: 'APPROVED',
          reviewedByAdminId: adminUserId,
          reviewedAt: new Date(),
        },
      });

      await this.createMonthlyRewardLedgers(tx, settlement);
      return updated;
    });
  }

  async markPaid(settlementId: string, adminUserId: string): Promise<any> {
    return this.withSerializableRetry(async (tx) => {
      const settlement = await (tx as any).captainMonthlySettlement.findUnique({
        where: { id: settlementId },
      });
      if (!settlement) throw new NotFoundException('团长月度结算不存在');
      if (settlement.status !== 'APPROVED') {
        if (settlement.status === 'PAID') return settlement;
        throw new BadRequestException('仅已审核结算可标记已支付');
      }

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
      let payoutTotal = 0;
      for (const ledger of ledgers ?? []) {
        const amount = this.roundMoney(Number(ledger.amount || 0));
        if (amount <= 0) continue;
        payoutTotal = this.roundMoney(payoutTotal + amount);
        payoutByAccount.set(
          ledger.accountId,
          this.roundMoney((payoutByAccount.get(ledger.accountId) ?? 0) + amount),
        );
      }
      const settlementTotal = this.roundMoney(Number(settlement.totalAmount || 0));
      if (Math.abs(payoutTotal - settlementTotal) > 0.01) {
        throw new BadRequestException('结算流水合计与结算金额不一致，不能标记已支付');
      }

      for (const [accountId, amount] of payoutByAccount.entries()) {
        const account = await (tx as any).captainAccount.findUnique({
          where: { id: accountId },
          select: { id: true, balance: true },
        });
        if (!account || this.roundMoney(Number(account.balance || 0)) < amount) {
          throw new BadRequestException('团长账户余额不足，无法标记已支付');
        }
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

    const [draft] = await this.createDraftSettlements(
      settlement.month,
      settlement.captainUserId,
      true,
    );
    if (!draft || draft.captainUserId !== settlement.captainUserId) {
      this.logger.warn(`团长结算重算未返回目标结算: settlementId=${settlementId}, adminUserId=${adminUserId}`);
    }
    return draft;
  }

  private async calculateMetricInTx(
    tx: Tx,
    month: string,
    captainUserId: string,
    config: CaptainSeafoodConfigV2,
  ): Promise<MetricInput> {
    const { start, end } = this.monthRange(month);
    const attributions = await (tx as any).captainOrderAttribution.findMany({
      where: {
        programCode: config.programCode,
        createdAt: { gte: start, lt: end },
        status: { not: 'VOIDED' },
        directCaptainUserId: captainUserId,
      },
      select: {
        id: true,
        buyerUserId: true,
        directCaptainUserId: true,
        commissionBase: true,
        refundAmount: true,
        createdAt: true,
      },
    });
    const personalGmv = this.sumNetGmv(attributions);
    // Keep legacy metric fields synchronized for audit compatibility; new data is direct-only.
    const teamGmv = personalGmv;
    const grossTeamGmv = attributions.reduce(
      (sum: number, item: any) => sum + Number(item.commissionBase || 0),
      0,
    );
    const refundAmount = attributions.reduce(
      (sum: number, item: any) => sum + Number(item.refundAmount || 0),
      0,
    );
    const directEffectiveBuyers = new Set(
      attributions
        .filter((item: any) => this.netGmv(item) > 0)
        .map((item: any) => item.buyerUserId),
    ).size;

    const relations = await (tx as any).captainRelation.findMany({
      where: {
        programCode: config.programCode,
        status: 'ACTIVE',
        directCaptainUserId: captainUserId,
      },
      select: {
        buyerUserId: true,
        directCaptainUserId: true,
        boundAt: true,
      },
    });
    const effectiveDirectBuyerIds = new Set(
      attributions
        .filter((item: any) => this.netGmv(item) > 0)
        .map((item: any) => item.buyerUserId),
    );
    const teamEffectiveMembers = new Set(
      relations
        .filter((relation: any) => effectiveDirectBuyerIds.has(relation.buyerUserId))
        .map((relation: any) => relation.buyerUserId),
    ).size;
    const newEffectiveMembers = new Set(
      relations
        .filter((relation: any) => {
          if (relation.boundAt && (relation.boundAt < start || relation.boundAt >= end)) {
            return false;
          }
          return effectiveDirectBuyerIds.has(relation.buyerUserId);
        })
        .map((relation: any) => relation.buyerUserId),
    ).size;
    const refundRate = grossTeamGmv > 0 ? this.roundMoney(refundAmount / grossTeamGmv) : 0;
    const qualified = this.isQualified({
      personalGmv,
      teamGmv,
      directEffectiveBuyers,
      teamEffectiveMembers,
      newEffectiveMembers,
      refundRate,
    }, config);

    return {
      captainUserId,
      month,
      programCode: config.programCode,
      personalGmv,
      teamGmv,
      directEffectiveBuyers,
      teamEffectiveMembers,
      newEffectiveMembers,
      refundRate,
      qualified,
      qualifiedTier: qualified ? this.resolveTier(teamGmv, config) : null,
      configSnapshot: this.snapshot(config),
    };
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

  private calculateSettlementAmounts(
    metric: MetricInput,
    config: CaptainSeafoodConfigV2,
  ): {
    baseManagementAmount: number;
    growthBonusAmount: number;
    cultivationBonusAmount: number;
    teamPoolAmount: number;
    totalAmount: number;
    taxAmount: number;
    netAmount: number;
    performanceBonusSummary: PerformanceBonusSummary;
  } {
    let baseManagementAmount = 0;
    let growthBonusAmount = 0;
    let cultivationBonusAmount = 0;
    let teamPoolAmount = 0;
    let performanceBonusSummary: PerformanceBonusSummary = {
      amount: 0,
      recipientUserId: metric.captainUserId,
    };

    if (metric.qualified && metric.personalGmv >= config.monthlyRewards.baseTierGmv) {
      baseManagementAmount = this.roundMoney(metric.personalGmv * config.monthlyRewards.baseManagementRate);
      teamPoolAmount = this.roundMoney(
        metric.personalGmv * config.monthlyRewards.performanceBonusRate,
      );
      performanceBonusSummary = {
        amount: teamPoolAmount,
        recipientUserId: metric.captainUserId,
      };
    }
    if (metric.qualified && metric.personalGmv >= config.monthlyRewards.growthTierGmv) {
      growthBonusAmount = this.roundMoney(metric.personalGmv * config.monthlyRewards.growthBonusRate);
    }
    if (metric.qualified && metric.personalGmv >= config.monthlyRewards.excellentTierGmv) {
      cultivationBonusAmount = this.roundMoney(metric.personalGmv * config.monthlyRewards.cultivationBonusRate);
    }

    const totalAmount = this.roundMoney(
      baseManagementAmount +
      growthBonusAmount +
      cultivationBonusAmount +
      teamPoolAmount,
    );
    const taxAmount = config.tax.enabled
      ? this.roundMoney(totalAmount * config.tax.withholdingRate)
      : 0;
    const netAmount = this.roundMoney(totalAmount - taxAmount);

    return {
      baseManagementAmount,
      growthBonusAmount,
      cultivationBonusAmount,
      teamPoolAmount,
      totalAmount,
      taxAmount,
      netAmount,
      performanceBonusSummary,
    };
  }

  private async createMonthlyRewardLedgers(tx: Tx, settlement: any): Promise<void> {
    const entries = [
      {
        userId: settlement.captainUserId,
        type: 'MANAGEMENT_ALLOWANCE',
        amount: settlement.baseManagementAmount,
        keySuffix: 'management',
      },
      {
        userId: settlement.captainUserId,
        type: 'GROWTH_BONUS',
        amount: settlement.growthBonusAmount,
        keySuffix: 'growth',
      },
      {
        userId: settlement.captainUserId,
        type: 'CULTIVATION_BONUS',
        amount: settlement.cultivationBonusAmount,
        keySuffix: 'cultivation',
      },
      {
        userId: settlement.captainUserId,
        type: 'PERFORMANCE_BONUS',
        amount: settlement.teamPoolAmount,
        keySuffix: 'performance',
      },
    ];

    for (const entry of entries) {
      const amount = this.roundMoney(Number(entry.amount || 0));
      if (amount <= 0) continue;
      await this.createMonthlyLedger(tx, settlement, {
        ...entry,
        amount,
      });
    }
  }

  private async createMonthlyLedger(
    tx: Tx,
    settlement: any,
    entry: {
      userId: string;
      type: string;
      amount: number;
      keySuffix: string;
    },
  ): Promise<void> {
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
    const balanceAfter = this.roundMoney(Number(account.balance || 0) + entry.amount);
    const idempotencyKey = `captain:month:${settlement.month}:${entry.userId}:${entry.keySuffix}`;

    try {
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
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
    }
  }

  private isQualified(
    metric: {
      personalGmv: number;
      teamGmv: number;
      directEffectiveBuyers: number;
      teamEffectiveMembers: number;
      newEffectiveMembers: number;
      refundRate: number;
    },
    config: CaptainSeafoodConfigV2,
  ): boolean {
    const qualification = config.monthlyQualification;
    if (metric.directEffectiveBuyers < qualification.minDirectEffectiveBuyers) return false;
    if (metric.personalGmv < qualification.minDirectMonthlyGmv) return false;
    if (metric.newEffectiveMembers < qualification.minNewEffectiveBuyers) return false;
    if (
      config.risk.holdSettlementOnRisk &&
      metric.refundRate > config.risk.maxMonthlyRefundRate
    ) {
      return false;
    }
    return true;
  }

  private resolveTier(teamGmv: number, config: CaptainSeafoodConfigV2): string {
    if (teamGmv >= config.monthlyRewards.excellentTierGmv) return 'EXCELLENT';
    if (teamGmv >= config.monthlyRewards.growthTierGmv) return 'GROWTH';
    if (teamGmv >= config.monthlyRewards.baseTierGmv) return 'BASE';
    return 'QUALIFIED';
  }

  private sumNetGmv(items: any[]): number {
    return this.roundMoney(items.reduce((sum, item) => sum + this.netGmv(item), 0));
  }

  private netGmv(item: any): number {
    return this.roundMoney(Math.max(
      0,
      Number(item.commissionBase || 0) - Number(item.refundAmount || 0),
    ));
  }

  private monthRange(month: string): { start: Date; end: Date } {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 必须是 YYYY-MM');
    }
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { start, end };
  }

  private snapshot(config: CaptainSeafoodConfigV2): CaptainSeafoodConfigV2 {
    return JSON.parse(JSON.stringify(config));
  }

  private async withSerializableRetry<T>(
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < SERIALIZABLE_MAX_RETRIES - 1) {
          this.logger.warn(`团长月度结算 Serializable 冲突，重试 ${attempt + 1}/${SERIALIZABLE_MAX_RETRIES}`);
          continue;
        }
        throw err;
      }
    }
    throw new Error('团长月度结算 Serializable 重试耗尽');
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
}
