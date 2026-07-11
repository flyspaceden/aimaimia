import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { VipDirectReferralCommissionService } from '../../bonus/engine/vip-direct-referral-commission.service';
import { PLATFORM_USER_ID } from '../../bonus/engine/constants';
import { CaptainAttributionService } from '../../captain/captain-attribution.service';
import { calculateCaptainProfitFunding } from '../../profit/captain-profit-funding';
import {
  allocateCentsByLargestRemainder,
  centsToYuan,
  yuanToCents,
} from '../../profit/money-allocation';
import { allocateProfitRateBuckets } from '../../profit/profit-rate-allocation';
import { OrderProfitRefundService } from '../../profit/order-profit-refund.service';
import { OrderProfitSnapshotCalculator } from '../../profit/order-profit-snapshot-calculator';

interface CostCorrectionInput {
  orderItemId: string;
  unitCostCents: number;
}

export interface RecalculateProfitInput {
  reason: string;
  costCorrections: CostCorrectionInput[];
}

export interface ReviewProfitInput {
  note: string;
}

type AdjustmentKind = 'REWARD' | 'CAPTAIN' | 'FUNDING';

interface AdjustmentComponent {
  key: string;
  kind: AdjustmentKind;
  sourceLedgerId: string | null;
  accountId?: string | null;
  userId?: string | null;
  accountType?: string | null;
  fundingType?: string;
  bucket?: 'frozen' | 'balance' | 'none';
  canonicalSource?: boolean;
  sourceAllocationId?: string | null;
  sourceAllocationRuleType?: string | null;
  sourceAllocationRuleVersion?: string | null;
  sourceStatus?: string | null;
  sourceEntryType?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  sourceType?: string | null;
  orderAttributionId?: string | null;
  programCode?: string | null;
  sourceLedgerIds?: string[];
  sourceBasisSnapshotId?: string | null;
  beforeCents: number;
  targetCents: number;
  deltaCents: number;
}

interface ExistingSourceBasis {
  reward: Map<string, string>;
  captain: Map<string, string>;
  funding: Map<string, string>;
}

@Injectable()
export class AdminProfitReconciliationService {
  private readonly calculator = new OrderProfitSnapshotCalculator();

  constructor(
    private readonly prisma: PrismaService,
    private readonly directAttribution: VipDirectReferralCommissionService,
    private readonly captainAttribution: CaptainAttributionService,
    private readonly profitRefund: OrderProfitRefundService,
  ) {}

  async listReconciliations(query: { status?: string; page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.status ? { status: query.status as any } : {};
    const [items, total] = await Promise.all([
      this.prisma.orderProfitReconciliationTask.findMany({
        where,
        include: {
          order: { select: { id: true, userId: true, paidAt: true } },
          sourceSnapshot: true,
          resolvedSnapshot: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.orderProfitReconciliationTask.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getReconciliation(taskId: string) {
    const task = await this.prisma.orderProfitReconciliationTask.findUnique({
      where: { id: taskId },
      include: {
        order: { include: { items: true } },
        sourceSnapshot: true,
        resolvedSnapshot: true,
      },
    });
    if (!task) throw new NotFoundException('利润对账任务不存在');
    const adjustmentDrafts = await this.prisma.orderProfitAdjustmentDraft.findMany({
      where: { orderId: task.orderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { ...task, adjustmentDrafts };
  }

  async listAdjustments(query: { status?: string; page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.status ? { status: query.status as any } : {};
    const [items, total] = await Promise.all([
      this.prisma.orderProfitAdjustmentDraft.findMany({
        where,
        include: {
          order: { select: { id: true, userId: true, paidAt: true } },
          sourceSnapshot: true,
          targetSnapshot: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.orderProfitAdjustmentDraft.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async recalculate(taskId: string, adminId: string, input: RecalculateProfitInput) {
    return this.prisma.$transaction(
      async (tx) => {
        const task = await (tx as any).orderProfitReconciliationTask.findUnique({
          where: { id: taskId },
          include: { sourceSnapshot: true, resolvedSnapshot: true },
        });
        if (!task) throw new NotFoundException('利润对账任务不存在');
        if (task.status === 'RESOLVED') {
          const originalDraft = await (tx as any).orderProfitAdjustmentDraft.findFirst({
            where: {
              idempotencyKey: `profit:reconcile:${task.id}:${task.resolvedSnapshotId}`,
            },
            orderBy: { createdAt: 'desc' },
          });
          const adjustmentDraft = await this.followReplacementDraft(tx, originalDraft);
          return this.resolutionResult(task, task.resolvedSnapshot, adjustmentDraft);
        }
        if (task.status !== 'PENDING') {
          throw new ConflictException('利润对账任务已结束，不能重算');
        }

        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext('order-profit-reconcile'),
            hashtext(${task.orderId})
          )
        `;

        const current = await (tx as any).orderProfitSnapshot.findFirst({
          where: { orderId: task.orderId, isCurrent: true },
          orderBy: { revision: 'desc' },
        });
        if (!current || current.id !== task.sourceSnapshotId) {
          throw new ConflictException('利润快照已发生变化，请刷新后重试');
        }
        const order = await (tx as any).order.findUnique({
          where: { id: task.orderId },
          select: {
            id: true,
            items: { select: { id: true, quantity: true, unitPrice: true, isPrize: true } },
          },
        });
        if (!order) throw new NotFoundException('订单不存在');

        const reason = this.requireNote(input.reason, '重算原因');
        const corrections = this.validateCorrections(order.items, input.costCorrections);
        const calculation = this.recalculateSnapshot(current, order.items, corrections);
        if (calculation.status !== 'READY') {
          throw new BadRequestException({
            code: calculation.errorCode ?? 'ORDER_PROFIT_RECONCILIATION_CONFLICT',
            message: '修正成本后利润快照仍无法通过守恒校验',
            errorMeta: calculation.errorMeta ?? null,
          });
        }

        const retired = await (tx as any).orderProfitSnapshot.updateMany({
          where: { id: current.id, isCurrent: true },
          data: { isCurrent: false },
        });
        if (retired.count !== 1) {
          throw new ConflictException('利润快照已被其他操作修订');
        }

        const resolvedSnapshot = await (tx as any).orderProfitSnapshot.create({
          data: {
            orderId: current.orderId,
            revision: current.revision + 1,
            isCurrent: true,
            supersedesSnapshotId: current.id,
            status: calculation.status,
            grossGoodsAmount: centsToYuan(calculation.grossGoodsAmountCents),
            shippingAmount: current.shippingAmount,
            vipDiscountAmount: centsToYuan(calculation.vipDiscountCents),
            couponDiscountAmount: centsToYuan(calculation.couponDiscountCents),
            rewardDeductionAmount: centsToYuan(calculation.rewardDeductionCents),
            groupBuyRebateDeductionAmount: centsToYuan(
              calculation.groupBuyRebateDeductionCents,
            ),
            otherGoodsDiscountAmount: centsToYuan(calculation.otherGoodsDiscountCents),
            netGoodsRevenue: centsToYuan(calculation.netGoodsRevenueCents),
            productCostAmount: centsToYuan(calculation.productCostCents),
            distributableProfitAmount: centsToYuan(calculation.distributableProfitCents),
            captainEligibleProfitAmount: centsToYuan(
              calculation.captainEligibleProfitCents,
            ),
            calculationVersion: current.calculationVersion,
            itemBreakdown: calculation.itemBreakdown as unknown as Prisma.InputJsonValue,
            ruleSnapshot: {
              ...this.asRecord(current.ruleSnapshot),
              reconciliation: {
                taskId,
                sourceSnapshotId: current.id,
                reason,
                correctedByAdminId: adminId,
                correctedAt: new Date().toISOString(),
              },
            } as unknown as Prisma.InputJsonValue,
            errorCode: null,
            errorMeta: Prisma.JsonNull,
            createdByAdminId: adminId,
          },
        });

        const resolvedAt = new Date();
        const taskCas = await (tx as any).orderProfitReconciliationTask.updateMany({
          where: { id: task.id, status: 'PENDING' },
          data: {
            status: 'RESOLVED',
            itemCostCorrections: input.costCorrections as unknown as Prisma.InputJsonValue,
            resolutionNote: reason,
            resolvedSnapshotId: resolvedSnapshot.id,
            resolvedByAdminId: adminId,
            resolvedAt,
          },
        });
        if (taskCas.count !== 1) {
          throw new ConflictException('利润对账任务已被其他操作处理');
        }
        Object.assign(task, {
          status: 'RESOLVED',
          itemCostCorrections: input.costCorrections,
          resolutionNote: reason,
          resolvedSnapshotId: resolvedSnapshot.id,
          resolvedSnapshot,
          resolvedByAdminId: adminId,
          resolvedAt,
        });

        let adjustmentDraft = null;
        if (await this.hasMoneySources(tx, task.orderId)) {
          const sourceBasis = await this.captureExistingSourceBasis(
            tx,
            task.orderId,
            current.id,
          );
          await this.ensureMissingAttributions(tx, task.orderId);
          adjustmentDraft = await this.createAdjustmentDraft(
            tx,
            task,
            current,
            resolvedSnapshot,
            reason,
            sourceBasis,
          );
        } else {
          await this.directAttribution.createFrozenForPaidOrder(tx, task.orderId);
          await this.captainAttribution.createFrozenForPaidOrder(tx, task.orderId);
        }
        await this.replayHistoricalRefunds(tx, task.orderId);

        return this.resolutionResult(task, resolvedSnapshot, adjustmentDraft);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  }

  async approveAndApplyAdjustment(draftId: string, adminId: string, input: ReviewProfitInput) {
    return this.prisma.$transaction(
      async (tx) => {
        const draft = await (tx as any).orderProfitAdjustmentDraft.findUnique({
          where: { id: draftId },
        });
        if (!draft) throw new NotFoundException('利润补差草稿不存在');
        if (draft.status !== 'PENDING') {
          throw new ConflictException(`利润补差草稿状态为 ${draft.status}，不能批准`);
        }
        const note = this.requireNote(input.note, '审批备注');
        const plan = this.asRecord(draft.adjustments);
        if (plan?.approvalBlockedReason) {
          throw new ConflictException({
            code: plan.approvalBlockedReason,
            message: '该订单已进入团长月结，需先完成月结人工调整',
            monthlySettlement: plan.monthlySettlement ?? null,
          });
        }

        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext('order-profit-reconcile'),
            hashtext(${draft.orderId})
          )
        `;
        const components = this.readAdjustmentComponents(draft.adjustments);
        const reviewedAt = new Date();
        const reviewedPlan = this.registerOutstandingClawback(
          plan,
          adminId,
          reviewedAt,
        );
        const cas = await (tx as any).orderProfitAdjustmentDraft.updateMany({
          where: { id: draft.id, status: 'PENDING' },
          data: {
            status: 'APPLIED',
            adjustments: reviewedPlan as unknown as Prisma.InputJsonValue,
            reviewNote: note,
            reviewedByAdminId: adminId,
            reviewedAt,
            appliedAt: reviewedAt,
          },
        });
        if (cas.count !== 1) {
          throw new ConflictException('利润补差草稿已被其他操作处理');
        }

        for (const component of components) {
          if (component.deltaCents === 0 && !component.canonicalSource) continue;
          if (component.kind === 'REWARD') {
            await this.applyRewardAdjustment(tx, draft, component);
          } else if (component.kind === 'CAPTAIN') {
            await this.applyCaptainAdjustment(tx, draft, component);
          } else {
            await this.applyFundingAdjustment(tx, draft, component);
          }
        }
        await this.applyAttributionRevision(tx, draft, plan, adminId, reviewedAt);
        await this.reopenMonthlySettlement(tx, plan);
        Object.assign(draft, {
          status: 'APPLIED',
          adjustments: reviewedPlan,
          reviewNote: note,
          reviewedByAdminId: adminId,
          reviewedAt,
          appliedAt: reviewedAt,
        });
        return draft;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  }

  async rejectReconciliation(taskId: string, adminId: string, input: ReviewProfitInput) {
    const note = this.requireNote(input.note, '拒绝备注');
    return this.prisma.$transaction(
      async (tx) => {
        const task = await (tx as any).orderProfitReconciliationTask.findUnique({
          where: { id: taskId },
        });
        if (!task) throw new NotFoundException('利润对账任务不存在');
        if (task.status === 'REJECTED') return task;
        if (task.status !== 'PENDING') {
          throw new ConflictException('已解决的利润对账任务不能拒绝');
        }
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext('order-profit-reconcile'),
            hashtext(${task.orderId})
          )
        `;
        const resolvedAt = new Date();
        const cas = await (tx as any).orderProfitReconciliationTask.updateMany({
          where: { id: task.id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            resolutionNote: note,
            resolvedByAdminId: adminId,
            resolvedAt,
          },
        });
        if (cas.count !== 1) {
          throw new ConflictException('利润对账任务已被其他操作处理');
        }
        Object.assign(task, {
          status: 'REJECTED',
          resolutionNote: note,
          resolvedByAdminId: adminId,
          resolvedAt,
        });
        return task;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async rejectAdjustment(draftId: string, adminId: string, input: ReviewProfitInput) {
    const note = this.requireNote(input.note, '拒绝备注');
    return this.prisma.$transaction(
      async (tx) => {
        const draft = await (tx as any).orderProfitAdjustmentDraft.findUnique({
          where: { id: draftId },
        });
        if (!draft) throw new NotFoundException('利润补差草稿不存在');
        if (draft.status === 'REJECTED') return draft;
        if (draft.status !== 'PENDING') {
          throw new ConflictException(`利润补差草稿状态为 ${draft.status}，不能拒绝`);
        }
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext('order-profit-reconcile'),
            hashtext(${draft.orderId})
          )
        `;
        const reviewedAt = new Date();
        const cas = await (tx as any).orderProfitAdjustmentDraft.updateMany({
          where: { id: draft.id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            reviewNote: note,
            reviewedByAdminId: adminId,
            reviewedAt,
          },
        });
        if (cas.count !== 1) {
          throw new ConflictException('利润补差草稿已被其他操作处理');
        }
        Object.assign(draft, {
          status: 'REJECTED',
          reviewNote: note,
          reviewedByAdminId: adminId,
          reviewedAt,
        });
        return draft;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getAdjustment(draftId: string) {
    const draft = await this.prisma.orderProfitAdjustmentDraft.findUnique({
      where: { id: draftId },
      include: {
        order: { select: { id: true, paidAt: true } },
        sourceSnapshot: true,
        targetSnapshot: true,
      },
    });
    if (!draft) throw new NotFoundException('利润补差草稿不存在');
    const orderDrafts = await this.prisma.orderProfitAdjustmentDraft.findMany({
      where: { orderId: draft.orderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const byId = new Map(orderDrafts.map((row: any) => [row.id, row]));
    const predecessorBySuccessor = new Map<string, any>();
    for (const row of orderDrafts as any[]) {
      if (row.supersededByDraftId) predecessorBySuccessor.set(row.supersededByDraftId, row);
    }
    const chain: any[] = [draft];
    let predecessor = predecessorBySuccessor.get(draft.id);
    const seen = new Set([draft.id]);
    while (predecessor && !seen.has(predecessor.id)) {
      seen.add(predecessor.id);
      chain.unshift(predecessor);
      predecessor = predecessorBySuccessor.get(predecessor.id);
    }
    let successorId = draft.supersededByDraftId;
    while (successorId && !seen.has(successorId)) {
      const successor = byId.get(successorId);
      if (!successor) break;
      seen.add(successor.id);
      chain.push(successor);
      successorId = successor.supersededByDraftId;
    }
    return {
      ...draft,
      replacementChain: chain.map((row) => ({
        id: row.id,
        status: row.status,
        supersededByDraftId: row.supersededByDraftId ?? null,
        createdAt: row.createdAt,
        adjustments: row.adjustments,
      })),
    };
  }

  private async followReplacementDraft(
    tx: Prisma.TransactionClient,
    draft: any,
  ): Promise<any> {
    let current = draft;
    const seen = new Set<string>();
    while (
      current
      && typeof current.id === 'string'
      && typeof current.supersededByDraftId === 'string'
      && current.supersededByDraftId.length > 0
    ) {
      if (seen.has(current.id)) {
        throw new ConflictException('利润补差替换链存在循环');
      }
      seen.add(current.id);
      const replacement = await (tx as any).orderProfitAdjustmentDraft.findUnique({
        where: { id: current.supersededByDraftId },
      });
      if (!replacement) {
        throw new ConflictException('利润补差替换稿不存在');
      }
      current = replacement;
    }
    return current;
  }

  private validateCorrections(orderItems: any[], values: CostCorrectionInput[]): Map<string, number> {
    if (!Array.isArray(values)) throw new BadRequestException('必须提交完整的订单项成本');
    const itemById = new Map(orderItems.map((item) => [item.id, item]));
    const expectedIds = orderItems.filter((item) => !item.isPrize).map((item) => item.id).sort();
    const corrections = new Map<string, number>();

    for (const correction of values) {
      if (!correction || typeof correction.orderItemId !== 'string') {
        throw new BadRequestException('订单项成本格式不正确');
      }
      if (corrections.has(correction.orderItemId)) {
        throw new BadRequestException(`订单项成本重复: ${correction.orderItemId}`);
      }
      const item = itemById.get(correction.orderItemId);
      if (!item) throw new BadRequestException(`未知订单项: ${correction.orderItemId}`);
      if (item.isPrize) throw new BadRequestException(`奖品订单项不能提交成本: ${correction.orderItemId}`);
      if (!Number.isSafeInteger(correction.unitCostCents) || correction.unitCostCents <= 0) {
        throw new BadRequestException(`订单项成本必须为正整数分: ${correction.orderItemId}`);
      }
      if (!Number.isSafeInteger(correction.unitCostCents * item.quantity)) {
        throw new BadRequestException(`订单项总成本超过安全整数范围: ${correction.orderItemId}`);
      }
      corrections.set(correction.orderItemId, correction.unitCostCents);
    }

    const actualIds = [...corrections.keys()].sort();
    if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
      throw new BadRequestException('必须提交每个非奖品订单项的完整成本');
    }
    return corrections;
  }

  private readAdjustmentComponents(value: unknown): AdjustmentComponent[] {
    const record = this.asRecord(value);
    if (
      record?.reason === 'CLAWBACK_PENDING'
      && !Array.isArray(record.components)
      && Array.isArray(record.sources)
      && record.sources.length > 0
    ) {
      return [];
    }
    if (!record || record.version !== 1 || !Array.isArray(record.components)) {
      throw new BadRequestException('利润补差草稿结构无效');
    }
    const seen = new Set<string>();
    return record.components.map((raw: unknown) => {
      const component = this.asRecord(raw);
      if (
        !component
        || typeof component.key !== 'string'
        || component.key.length === 0
        || seen.has(component.key)
        || !['REWARD', 'CAPTAIN', 'FUNDING'].includes(component.kind)
        || !Number.isSafeInteger(component.beforeCents)
        || !Number.isSafeInteger(component.targetCents)
        || !Number.isSafeInteger(component.deltaCents)
        || component.targetCents - component.beforeCents !== component.deltaCents
      ) {
        throw new BadRequestException('利润补差 component 无效');
      }
      if (
        component.kind !== 'FUNDING'
        && (typeof component.userId !== 'string' || typeof component.accountType !== 'string')
      ) {
        throw new BadRequestException('利润补差账户信息不完整');
      }
      if (component.kind === 'FUNDING' && typeof component.fundingType !== 'string') {
        throw new BadRequestException('利润补差资金类型不完整');
      }
      if (
        component.kind !== 'FUNDING'
        && component.bucket !== 'frozen'
        && component.bucket !== 'balance'
        && component.bucket !== 'none'
      ) {
        throw new BadRequestException('利润补差账户桶无效');
      }
      seen.add(component.key);
      return component as unknown as AdjustmentComponent;
    });
  }

  private registerOutstandingClawback(
    plan: Record<string, any> | null,
    adminId: string,
    reviewedAt: Date,
  ): Record<string, any> {
    if (!plan) throw new BadRequestException('利润补差草稿结构无效');
    if (!Array.isArray(plan.sources) || plan.sources.length === 0) return plan;
    let amountCents = 0;
    const sources = plan.sources.map((raw: unknown) => {
      const source = this.asRecord(raw);
      if (
        !source
        || typeof source.sourceLedgerId !== 'string'
        || typeof source.sourceLedgerType !== 'string'
        || typeof source.userId !== 'string'
        || !Number.isSafeInteger(source.amountCents)
        || source.amountCents <= 0
      ) {
        throw new BadRequestException('利润补差追缴来源无效');
      }
      amountCents += source.amountCents;
      if (!Number.isSafeInteger(amountCents)) {
        throw new BadRequestException('利润补差追缴金额超出安全范围');
      }
      return {
        sourceLedgerId: source.sourceLedgerId,
        sourceLedgerType: source.sourceLedgerType,
        userId: source.userId,
        amountCents: source.amountCents,
      };
    });
    return {
      ...plan,
      clawbackDisposition: {
        status: 'REGISTERED_OUTSTANDING',
        amountCents,
        sources,
        reviewedByAdminId: adminId,
        reviewedAt: reviewedAt.toISOString(),
      },
    };
  }

  private async applyRewardAdjustment(
    tx: Prisma.TransactionClient,
    draft: any,
    component: AdjustmentComponent,
  ) {
    const account = component.accountId
      ? await (tx as any).rewardAccount.findUnique({ where: { id: component.accountId } })
      : await (tx as any).rewardAccount.upsert({
          where: {
            userId_type: { userId: component.userId, type: component.accountType },
          },
          update: {},
          create: { userId: component.userId, type: component.accountType },
        });
    if (!account || account.userId !== component.userId || account.type !== component.accountType) {
      throw new ConflictException('奖励账户与补差草稿不一致');
    }
    const amount = centsToYuan(component.deltaCents);
    const accountMutation = this.rewardAccountMutation(account, component);
    if (component.canonicalSource) {
      const allocationId = await this.ensureCanonicalRewardAllocation(
        tx,
        draft,
        component,
      );
      if (component.sourceStatus === 'WITHDRAWN' && component.deltaCents > 0) {
        await (tx as any).rewardLedger.create({
          data: {
            allocationId,
            accountId: account.id,
            userId: component.userId,
            entryType: 'ADJUST',
            amount,
            status: component.bucket === 'frozen' ? 'FROZEN' : 'AVAILABLE',
            refType: 'ORDER',
            refId: draft.orderId,
            idempotencyKey: `profit:adjust:${draft.id}:${component.key}:upgrade-delta`,
            sourceLedgerId: component.sourceLedgerId,
            meta: {
              ...(component.sourceMeta ?? {}),
              calculationModel: 'PROFIT_RECONCILIATION_REVISION',
              adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA',
              adjustmentDraftId: draft.id,
              beforeCents: component.beforeCents,
              targetCents: component.targetCents,
              deltaCents: component.deltaCents,
            },
          },
        });
        await (tx as any).rewardAccount.update({
          where: { id: account.id },
          data: accountMutation.data,
        });
        return;
      }
      if (component.sourceLedgerId) {
        const superseded = await (tx as any).rewardLedger.updateMany({
          where: { id: component.sourceLedgerId, status: component.sourceStatus },
          data: { status: 'VOIDED', entryType: 'VOID' },
        });
        if (superseded.count !== 1) {
          throw new ConflictException('奖励来源已发生变化，不能应用利润修订');
        }
      }
      if (component.targetCents > 0) {
        await (tx as any).rewardLedger.create({
          data: {
            allocationId,
            accountId: account.id,
            userId: component.userId,
            entryType: component.sourceEntryType ?? (component.bucket === 'balance' ? 'RELEASE' : 'FREEZE'),
            amount: centsToYuan(component.targetCents),
            status: component.sourceStatus
              ?? (component.bucket === 'balance'
                ? 'AVAILABLE'
                : component.bucket === 'none' ? 'RETURN_FROZEN' : 'FROZEN'),
            refType: 'ORDER',
            refId: draft.orderId,
            idempotencyKey: `profit:adjust:${draft.id}:${component.key}:canonical`,
            sourceLedgerId: component.sourceLedgerId,
            meta: {
              ...(component.sourceMeta ?? {}),
              calculationModel: 'PROFIT_RECONCILIATION_REVISION',
              adjustmentDraftId: draft.id,
              supersedesLedgerId: component.sourceLedgerId,
              beforeCents: component.beforeCents,
              targetCents: component.targetCents,
              deltaCents: component.deltaCents,
              recoveredAmount: centsToYuan(accountMutation.recoveredCents),
              clawbackAmount: centsToYuan(accountMutation.clawbackCents),
            },
          },
        });
      }
      if (accountMutation.clawbackCents > 0) {
        await this.createRewardClawbackLedger(tx, draft, component, account, accountMutation);
      }
      if (Object.keys(accountMutation.data).length > 0) {
        await (tx as any).rewardAccount.update({
          where: { id: account.id },
          data: accountMutation.data,
        });
      }
      return;
    }
    await (tx as any).rewardLedger.create({
      data: {
        allocationId: null,
        accountId: account.id,
        userId: component.userId,
        entryType: 'ADJUST',
        amount,
        status: accountMutation.clawbackCents > 0
          ? 'RETURN_FROZEN'
          : component.bucket === 'frozen' ? 'FROZEN' : 'AVAILABLE',
        refType: 'ADMIN',
        refId: draft.id,
        idempotencyKey: `profit:adjust:${draft.id}:${component.key}`,
        sourceLedgerId: component.sourceLedgerId,
        meta: {
          reason: 'PROFIT_RECONCILIATION',
          adjustmentDraftId: draft.id,
          beforeCents: component.beforeCents,
          targetCents: component.targetCents,
          deltaCents: component.deltaCents,
          recoveredAmount: centsToYuan(accountMutation.recoveredCents),
          clawbackAmount: centsToYuan(accountMutation.clawbackCents),
        },
      },
    });
    if (Object.keys(accountMutation.data).length > 0) {
      await (tx as any).rewardAccount.update({
        where: { id: account.id },
        data: accountMutation.data,
      });
    }
  }

  private async applyCaptainAdjustment(
    tx: Prisma.TransactionClient,
    draft: any,
    component: AdjustmentComponent,
  ) {
    const account = component.accountId
      ? await (tx as any).captainAccount.findUnique({ where: { id: component.accountId } })
      : await (tx as any).captainAccount.upsert({
          where: {
            userId_programCode: {
              userId: component.userId,
              programCode: component.accountType,
            },
          },
          update: {},
          create: { userId: component.userId, programCode: component.accountType },
        });
    if (
      !account
      || account.userId !== component.userId
      || account.programCode !== component.accountType
    ) {
      throw new ConflictException('团长账户与补差草稿不一致');
    }
    const amount = centsToYuan(component.deltaCents);
    const accountMutation = this.captainAccountMutation(account, component);
    if (component.canonicalSource) {
      if (component.sourceStatus === 'WITHDRAWN' && component.deltaCents > 0) {
        await (tx as any).captainCommissionLedger.create({
          data: {
            accountId: account.id,
            userId: component.userId,
            orderAttributionId: component.orderAttributionId,
            orderId: draft.orderId,
            programCode: component.programCode ?? component.accountType,
            type: component.sourceType ?? 'DIRECT_ORDER',
            status: component.bucket === 'frozen' ? 'FROZEN' : 'AVAILABLE',
            amount,
            idempotencyKey: `profit:adjust:${draft.id}:${component.key}:upgrade-delta`,
            refType: 'ORDER',
            refId: draft.orderId,
            meta: {
              ...(component.sourceMeta ?? {}),
              calculationModel: 'PROFIT_RECONCILIATION_REVISION',
              adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA',
              adjustmentDraftId: draft.id,
              beforeCents: component.beforeCents,
              targetCents: component.targetCents,
              deltaCents: component.deltaCents,
            },
          },
        });
        await (tx as any).captainAccount.update({
          where: { id: account.id },
          data: accountMutation.data,
        });
        return;
      }
      if (component.sourceLedgerId) {
        const supersededAt = new Date();
        const superseded = await (tx as any).captainCommissionLedger.updateMany({
          where: { id: component.sourceLedgerId, deletedAt: null },
          data: { deletedAt: supersededAt },
        });
        if (superseded.count !== 1) {
          throw new ConflictException('团长来源已发生变化，不能应用利润修订');
        }
      }
      if (component.targetCents > 0) {
        await (tx as any).captainCommissionLedger.create({
          data: {
            accountId: account.id,
            userId: component.userId,
            orderAttributionId: component.orderAttributionId,
            orderId: draft.orderId,
            programCode: component.programCode ?? component.accountType,
            type: component.sourceType ?? 'DIRECT_ORDER',
            status: accountMutation.clawbackCents > 0
              ? 'CLAWBACK_PENDING'
              : component.sourceStatus ?? (component.bucket === 'frozen' ? 'FROZEN' : 'AVAILABLE'),
            amount: centsToYuan(component.targetCents),
            idempotencyKey: `profit:adjust:${draft.id}:${component.key}:canonical`,
            refType: 'ORDER',
            refId: draft.orderId,
            meta: {
              ...(component.sourceMeta ?? {}),
              calculationModel: 'PROFIT_RECONCILIATION_REVISION',
              adjustmentDraftId: draft.id,
              supersedesLedgerId: component.sourceLedgerId,
              beforeCents: component.beforeCents,
              targetCents: component.targetCents,
              deltaCents: component.deltaCents,
              clawbackCents: accountMutation.clawbackCents,
            },
          },
        });
      }
      if (Object.keys(accountMutation.data).length > 0) {
        await (tx as any).captainAccount.update({
          where: { id: account.id },
          data: accountMutation.data,
        });
      }
      return;
    }
    await (tx as any).captainCommissionLedger.create({
      data: {
        accountId: account.id,
        userId: component.userId,
        orderId: draft.orderId,
        programCode: component.accountType,
        type: 'ADJUSTMENT',
        status: accountMutation.clawbackCents > 0
          ? 'CLAWBACK_PENDING'
          : component.bucket === 'frozen' ? 'FROZEN' : 'AVAILABLE',
        amount,
        idempotencyKey: `profit:adjust:${draft.id}:${component.key}`,
        refType: 'ADMIN',
        refId: draft.id,
        meta: {
          reason: 'PROFIT_RECONCILIATION',
          adjustmentDraftId: draft.id,
          sourceLedgerId: component.sourceLedgerId,
          beforeCents: component.beforeCents,
          targetCents: component.targetCents,
          deltaCents: component.deltaCents,
          clawbackCents: accountMutation.clawbackCents,
        },
      },
    });
    await (tx as any).captainAccount.update({
      where: { id: account.id },
      data: accountMutation.data,
    });
  }

  private async ensureCanonicalRewardAllocation(
    tx: Prisma.TransactionClient,
    draft: any,
    component: AdjustmentComponent,
  ): Promise<string> {
    if (component.sourceAllocationId) return component.sourceAllocationId;
    if (!component.sourceAllocationRuleType) {
      throw new BadRequestException('canonical Reward 来源缺少 allocation 归属');
    }
    const idempotencyKey = [
      'profit:reconcile-allocation',
      draft.id,
      component.sourceAllocationRuleType,
    ].join(':');
    const allocation = await (tx as any).rewardAllocation.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        triggerType: 'ORDER_RECEIVED',
        orderId: draft.orderId,
        ruleType: component.sourceAllocationRuleType,
        ruleVersion: component.sourceAllocationRuleVersion ?? `snapshot:${draft.targetSnapshotId}`,
        idempotencyKey,
        meta: {
          source: 'PROFIT_RECONCILIATION_REVISION',
          adjustmentDraftId: draft.id,
          targetSnapshotId: draft.targetSnapshotId,
        },
      },
    });
    return allocation.id;
  }

  private async applyFundingAdjustment(
    tx: Prisma.TransactionClient,
    draft: any,
    component: AdjustmentComponent,
  ) {
    await (tx as any).orderProfitFundingLedger.create({
      data: {
        snapshotId: draft.targetSnapshotId,
        orderId: draft.orderId,
        type: component.fundingType,
        amount: centsToYuan(component.targetCents),
        configVersion: `snapshot:${draft.targetSnapshotId}`,
        sourceLedgerId: component.sourceLedgerId,
        idempotencyKey: `profit:adjust:${draft.id}:${component.key}`,
        meta: {
          reason: 'PROFIT_RECONCILIATION',
          adjustmentDraftId: draft.id,
          sourceFundingType: component.fundingType,
          beforeCents: component.beforeCents,
          targetCents: component.targetCents,
          deltaCents: component.deltaCents,
        },
      },
    });
  }

  private async applyAttributionRevision(
    tx: Prisma.TransactionClient,
    draft: any,
    plan: Record<string, any> | null,
    adminId: string,
    appliedAt: Date,
  ) {
    const update = this.asRecord(plan?.attributionUpdate);
    if (!update) return;
    const attribution = await (tx as any).captainOrderAttribution.findUnique({
      where: { id: update.attributionId },
    });
    if (!attribution) throw new ConflictException('团长订单归因不存在');
    const cas = await (tx as any).captainOrderAttribution.updateMany({
      where: {
        id: update.attributionId,
        profitSnapshotId: update.sourceSnapshotId,
      },
      data: {
        profitSnapshotId: update.targetSnapshotId,
        profitBaseAmount: centsToYuan(update.targetProfitBaseCents),
        commissionBase: centsToYuan(update.targetProfitBaseCents),
        eligibleGoodsAmount: centsToYuan(update.targetEligibleGoodsCents),
        meta: {
          ...(attribution.meta ?? {}),
          platformRetainedAmount: centsToYuan(update.targetPlatformRetainedCents),
          directAmount: centsToYuan(update.targetDirectCents),
          monthlyMaximum: centsToYuan(update.targetMonthlyCents),
          reconciledByAdminId: adminId,
          reconciledAt: appliedAt.toISOString(),
          adjustmentDraftId: draft.id,
        },
      },
    });
    if (cas.count !== 1) {
      throw new ConflictException('团长订单归因 revision 已变化');
    }
  }

  private async reopenMonthlySettlement(
    tx: Prisma.TransactionClient,
    plan: Record<string, any> | null,
  ): Promise<void> {
    const monthly = this.asRecord(plan?.monthlySettlement);
    if (!monthly) return;
    if (monthly.settlementStatus === 'PAID') {
      throw new ConflictException('已支付月结不能通过对账补差重开');
    }
    if (typeof monthly.settlementId !== 'string' || monthly.settlementId.length === 0) {
      throw new BadRequestException('利润补差月结信息不完整');
    }
    await (tx as any).captainMonthlySettlement.update({
      where: { id: monthly.settlementId },
      data: {
        status: 'PENDING_REVIEW',
        reviewedByAdminId: null,
        reviewedAt: null,
        rejectReason: null,
      },
    });
  }

  private rewardAccountMutation(account: any, component: AdjustmentComponent) {
    if (component.bucket === 'none') {
      return {
        data: {},
        recoveredCents: component.deltaCents < 0 ? Math.abs(component.deltaCents) : 0,
        clawbackCents: 0,
      };
    }
    const accountBucket = component.bucket === 'balance' ? 'balance' : 'frozen';
    if (component.deltaCents >= 0) {
      return {
        data: this.accountDelta(accountBucket, centsToYuan(component.deltaCents)),
        recoveredCents: component.deltaCents,
        clawbackCents: 0,
      };
    }
    const requestedDebitCents = Math.abs(component.deltaCents);
    const availableCents = yuanToCents(account[accountBucket] ?? 0);
    const recoveredCents = Math.min(availableCents, requestedDebitCents);
    const clawbackCents = requestedDebitCents - recoveredCents;
    return {
      data: recoveredCents > 0
        ? { [accountBucket]: { decrement: centsToYuan(recoveredCents) } }
        : {},
      recoveredCents,
      clawbackCents,
    };
  }

  private async createRewardClawbackLedger(
    tx: Prisma.TransactionClient,
    draft: any,
    component: AdjustmentComponent,
    account: any,
    mutation: { recoveredCents: number; clawbackCents: number },
  ): Promise<void> {
    await (tx as any).rewardLedger.create({
      data: {
        allocationId: null,
        accountId: account.id,
        userId: component.userId,
        entryType: 'VOID',
        amount: centsToYuan(-mutation.clawbackCents),
        status: 'RETURN_FROZEN',
        refType: 'ADMIN',
        refId: draft.id,
        idempotencyKey: `profit:adjust:${draft.id}:${component.key}:clawback`,
        sourceLedgerId: component.sourceLedgerId,
        meta: {
          reason: 'PROFIT_RECONCILIATION_CLAWBACK',
          adjustmentDraftId: draft.id,
          recoveredAmount: centsToYuan(mutation.recoveredCents),
          clawbackAmount: centsToYuan(mutation.clawbackCents),
        },
      },
    });
  }

  private captainAccountMutation(account: any, component: AdjustmentComponent) {
    if (component.bucket === 'none') {
      throw new BadRequestException('团长补差账户桶无效');
    }
    const accountBucket = component.bucket === 'balance' ? 'balance' : 'frozen';
    if (component.deltaCents >= 0) {
      return {
        data: this.accountDelta(accountBucket, centsToYuan(component.deltaCents)),
        clawbackCents: 0,
      };
    }
    const requestedDebitCents = Math.abs(component.deltaCents);
    const availableCents = yuanToCents(account[accountBucket] ?? 0);
    const debitCents = Math.min(availableCents, requestedDebitCents);
    const clawbackCents = requestedDebitCents - debitCents;
    const data: Record<string, unknown> = {};
    if (debitCents > 0) {
      data[accountBucket] = { decrement: centsToYuan(debitCents) };
    }
    if (clawbackCents > 0) {
      data.clawback = { increment: centsToYuan(clawbackCents) };
    }
    return { data, clawbackCents };
  }

  private accountDelta(bucket: 'frozen' | 'balance', amount: number) {
    const operation = amount >= 0
      ? { increment: amount }
      : { decrement: Math.abs(amount) };
    return { [bucket]: operation };
  }

  private recalculateSnapshot(current: any, orderItems: any[], corrections: Map<string, number>) {
    if (!Array.isArray(current.itemBreakdown)) {
      throw new BadRequestException('原利润快照缺少订单项明细');
    }
    const breakdownById = new Map<string, any>();
    for (const raw of current.itemBreakdown) {
      const row = this.asRecord(raw);
      if (!row || typeof row.orderItemId !== 'string' || breakdownById.has(row.orderItemId)) {
        throw new BadRequestException('原利润快照订单项明细无效');
      }
      breakdownById.set(row.orderItemId, row);
    }
    const items = orderItems.filter((item) => !item.isPrize).map((item) => {
      const row = breakdownById.get(item.id);
      if (!row || typeof row.captainEligible !== 'boolean') {
        throw new BadRequestException(`原利润快照缺少订单项: ${item.id}`);
      }
      const unitPriceCents = this.requireNonNegativeSafeCents(row.unitPriceCents, `${item.id} 单价`);
      const explicitDiscountCents = this.requireNonNegativeSafeCents(
        row.explicitDiscountCents ?? 0,
        `${item.id} 显式优惠`,
      );
      return {
        id: item.id,
        unitPriceCents,
        quantity: item.quantity,
        unitCostCents: corrections.get(item.id),
        explicitDiscountCents,
        isPrize: false,
        captainEligible: row.captainEligible,
      };
    });
    if (breakdownById.size !== items.length) {
      throw new BadRequestException('原利润快照包含未知订单项');
    }

    return this.calculator.calculate({
      grossGoodsAmountCents: yuanToCents(current.grossGoodsAmount),
      vipDiscountCents: yuanToCents(current.vipDiscountAmount),
      couponDiscountCents: yuanToCents(current.couponDiscountAmount),
      rewardDeductionCents: yuanToCents(current.rewardDeductionAmount),
      groupBuyRebateDeductionCents: yuanToCents(current.groupBuyRebateDeductionAmount),
      otherGoodsDiscountCents: yuanToCents(current.otherGoodsDiscountAmount),
      items,
    });
  }

  private async hasMoneySources(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
    const [reward, allocation, attribution, captain, funding, settlementOrder] = await Promise.all([
      (tx as any).rewardLedger.findFirst({ where: { refId: orderId, deletedAt: null }, select: { id: true } }),
      (tx as any).rewardAllocation.findFirst({ where: { orderId, deletedAt: null }, select: { id: true } }),
      (tx as any).captainOrderAttribution.findFirst({ where: { orderId }, select: { id: true } }),
      (tx as any).captainCommissionLedger.findFirst({ where: { orderId, deletedAt: null }, select: { id: true } }),
      (tx as any).orderProfitFundingLedger.findFirst({ where: { orderId }, select: { id: true } }),
      (tx as any).captainMonthlySettlementOrder.findFirst({
        where: { orderAttribution: { orderId } },
        select: { id: true },
      }),
    ]);
    return [reward, allocation, attribution, captain, funding, settlementOrder].some(Boolean);
  }

  private async ensureMissingAttributions(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const [memberSource, memberAllocation, captainAttribution] = await Promise.all([
      (tx as any).rewardLedger.findFirst({
        where: { refId: orderId, deletedAt: null },
        select: { id: true },
      }),
      (tx as any).rewardAllocation.findFirst({
        where: { orderId, deletedAt: null },
        select: { id: true },
      }),
      (tx as any).captainOrderAttribution.findFirst({
        where: { orderId },
        select: { id: true },
      }),
    ]);
    if (!memberSource && !memberAllocation) {
      await this.directAttribution.createFrozenForPaidOrder(tx, orderId);
    }
    if (!captainAttribution) {
      await this.captainAttribution.createFrozenForPaidOrder(tx, orderId);
    }
  }

  private async captureExistingSourceBasis(
    tx: Prisma.TransactionClient,
    orderId: string,
    fallbackSnapshotId: string,
  ): Promise<ExistingSourceBasis> {
    const [rewardRows, captainRows, fundingRows] = await Promise.all([
      (tx as any).rewardLedger.findMany({
        where: { refId: orderId, deletedAt: null, status: { not: 'VOIDED' } },
        select: { id: true },
      }),
      (tx as any).captainCommissionLedger.findMany({
        where: { orderId, deletedAt: null },
        include: { orderAttribution: { select: { profitSnapshotId: true } } },
      }),
      (tx as any).orderProfitFundingLedger.findMany({
        where: { orderId, type: { not: 'REFUND_ADJUSTMENT' } },
        select: { id: true, snapshotId: true },
      }),
    ]);
    return {
      reward: new Map(rewardRows.map((row: any) => [row.id, fallbackSnapshotId])),
      captain: new Map(captainRows.map((row: any) => [
        row.id,
        row.orderAttribution?.profitSnapshotId ?? fallbackSnapshotId,
      ])),
      funding: new Map(fundingRows.map((row: any) => [row.id, row.snapshotId])),
    };
  }

  private async replayHistoricalRefunds(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const latestSuccessfulRefund = await (tx as any).refund.findFirst({
      where: { orderId, status: 'REFUNDED', deletedAt: null },
      select: { id: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    if (!latestSuccessfulRefund) return;
    await this.profitRefund.finalizeSuccessfulRefund(tx, latestSuccessfulRefund.id);
  }

  private async createAdjustmentDraft(
    tx: Prisma.TransactionClient,
    task: any,
    sourceSnapshot: any,
    targetSnapshot: any,
    reason: string,
    sourceBasis: ExistingSourceBasis,
  ) {
    const idempotencyKey = `profit:reconcile:${task.id}:${targetSnapshot.id}`;
    const existing = await (tx as any).orderProfitAdjustmentDraft.findFirst({
      where: { idempotencyKey },
    });
    if (existing) return existing;

    const components = await this.buildAdjustmentComponents(
      tx,
      task.orderId,
      targetSnapshot,
      sourceBasis,
    );
    const targets = this.paymentTargets(targetSnapshot);
    const attribution = await (tx as any).captainOrderAttribution.findFirst({
      where: { orderId: task.orderId },
    });
    const settlementOrder = attribution
      ? await (tx as any).captainMonthlySettlementOrder.findFirst({
          where: { orderAttributionId: attribution.id },
          include: { settlement: true },
        })
      : null;
    const monthlySettlement = settlementOrder
      ? this.monthlySettlementAdjustment(settlementOrder, targets)
      : null;
    return (tx as any).orderProfitAdjustmentDraft.create({
      data: {
        orderId: task.orderId,
        sourceSnapshotId: sourceSnapshot.id,
        targetSnapshotId: targetSnapshot.id,
        status: 'PENDING',
        adjustments: {
          version: 1,
          reason: 'RECONCILIATION_REVISION',
          reconciliationTaskId: task.id,
          resolutionReason: reason,
          sourceRevision: sourceSnapshot.revision,
          targetRevision: targetSnapshot.revision,
          attributionUpdate: attribution ? {
            attributionId: attribution.id,
            sourceSnapshotId: attribution.profitSnapshotId,
            targetSnapshotId: targetSnapshot.id,
            beforeProfitBaseCents: yuanToCents(attribution.profitBaseAmount ?? 0),
            targetProfitBaseCents: yuanToCents(targetSnapshot.captainEligibleProfitAmount),
            targetEligibleGoodsCents: this.captainEligibleNetGoodsCents(targetSnapshot.itemBreakdown),
            targetPlatformRetainedCents: targets.platformRetainedCents,
            targetDirectCents: targets.captainDirectCents,
            targetMonthlyCents: targets.captainMonthlyCents,
          } : null,
          approvalBlockedReason: settlementOrder?.settlement?.status === 'PAID'
            ? 'CAPTAIN_MONTHLY_SETTLEMENT_PAID'
            : null,
          monthlySettlement,
          components,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey,
      },
    });
  }

  private async buildAdjustmentComponents(
    tx: Prisma.TransactionClient,
    orderId: string,
    targetSnapshot: any,
    sourceBasis: ExistingSourceBasis,
  ): Promise<AdjustmentComponent[]> {
    const [rewardLedgers, captainLedgers, fundingLedgers, rewardAllocations, attribution] = await Promise.all([
      (tx as any).rewardLedger.findMany({
        where: { refId: orderId, deletedAt: null, status: { not: 'VOIDED' } },
        include: { account: true, allocation: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      (tx as any).captainCommissionLedger.findMany({
        where: { orderId, deletedAt: null },
        include: { account: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      (tx as any).orderProfitFundingLedger.findMany({
        where: { orderId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      (tx as any).rewardAllocation.findMany?.({
        where: { orderId, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }) ?? Promise.resolve([]),
      (tx as any).captainOrderAttribution.findFirst({ where: { orderId } }),
    ]);
    const targets = this.paymentTargets(targetSnapshot);
    const components: AdjustmentComponent[] = [];

    await this.appendRewardComponents(
      tx,
      components,
      rewardLedgers,
      targets.directRewardCents,
      targets,
      sourceBasis,
      targetSnapshot,
      rewardAllocations,
      orderId,
    );
    this.appendCaptainComponents(
      components,
      captainLedgers,
      targets.captainDirectCents,
      targets,
      sourceBasis,
      targetSnapshot.id,
      attribution,
    );
    this.appendFundingComponents(
      components,
      fundingLedgers,
      targets,
      sourceBasis,
      targetSnapshot.id,
      targetSnapshot.supersedesSnapshotId ?? null,
    );
    return components;
  }

  private paymentTargets(snapshot: any) {
    const rule = this.asRecord(snapshot.ruleSnapshot);
    const buyerPath = rule?.buyerPath;
    const rates = this.asRecord(this.asRecord(rule?.rates)?.[buyerPath === 'VIP' ? 'vip' : 'normal']);
    const direct = this.asRecord(rule?.directInviter);
    if ((buyerPath !== 'VIP' && buyerPath !== 'NORMAL') || !rates || !direct) {
      throw new BadRequestException('目标利润快照规则不完整');
    }
    const distributableProfitCents = yuanToCents(snapshot.distributableProfitAmount);
    const directRate = this.requireRate(direct.effectiveDirectRate, '直接推荐比例');
    const memberRates = {
      reward: this.requireRate(rates.reward, '奖励比例'),
      directReferral: directRate,
      industryFund: this.requireRate(rates.industryFund, '产业基金比例'),
      charity: this.requireRate(rates.charity, '慈善比例'),
      tech: this.requireRate(rates.tech, '科技比例'),
      reserve: this.requireRate(rates.reserve, '备用金比例'),
    };
    const memberBuckets = allocateProfitRateBuckets(distributableProfitCents, memberRates);
    const directClaimed = typeof direct.eligibleUserId === 'string' && direct.eligibleUserId.length > 0;
    let captainDirectCents = 0;
    let captainMonthlyCents = 0;
    let platformRetainedCents = distributableProfitCents
      - memberBuckets.reward
      - memberBuckets.industryFund
      - (directClaimed ? memberBuckets.directReferral : 0);

    const captain = this.asRecord(rule?.captain);
    const config = this.asRecord(captain?.config);
    const monthly = this.asRecord(config?.monthlyRewards);
    const captainEligible = typeof captain?.directCaptainUserId === 'string'
      && captain?.relationStatus === 'ACTIVE'
      && captain?.profileStatus === 'ACTIVE'
      && captain?.exclusionReason == null
      && config?.schemaVersion === 3
      && config?.enabled === true;
    if (captainEligible && monthly) {
      const funding = calculateCaptainProfitFunding({
        distributableProfitAmount: snapshot.distributableProfitAmount,
        captainEligibleProfitAmount: snapshot.captainEligibleProfitAmount,
        memberProfitRates: memberRates,
        directReferralClaimed: directClaimed,
        captainDirectProfitRate: this.requireRate(
          this.asRecord(config?.perOrderCommission)?.directProfitRate,
          '团长逐单比例',
        ),
        monthlyProfitRates: [
          this.requireRate(monthly.baseManagementProfitRate, '基础管理比例'),
          this.requireRate(monthly.growthBonusProfitRate, '增长奖励比例'),
          this.requireRate(monthly.cultivationBonusProfitRate, '培育奖励比例'),
          this.requireRate(monthly.performanceBonusProfitRate, '绩效奖励比例'),
        ],
      });
      if (!funding.coveredByPlatformRetained) {
        throw new BadRequestException('目标利润快照的团长资金占用超过平台留存');
      }
      captainDirectCents = yuanToCents(funding.directAmount);
      captainMonthlyCents = yuanToCents(funding.monthlyMaximum);
      platformRetainedCents = yuanToCents(funding.platformRetainedAmount);
    }

    return {
      rewardPoolCents: memberBuckets.reward,
      platformProfitCents: memberBuckets.platform,
      industryFundCents: memberBuckets.industryFund,
      charityFundCents: memberBuckets.charity,
      techFundCents: memberBuckets.tech,
      reserveFundCents: memberBuckets.reserve,
      directRewardCents: directClaimed ? memberBuckets.directReferral : 0,
      directRewardUserId: directClaimed ? direct.eligibleUserId as string : null,
      directRewardAccountType: direct.path === 'VIP' ? 'VIP_REWARD' : 'NORMAL_REWARD',
      captainUserId: captainEligible ? captain?.directCaptainUserId as string : null,
      captainProgramCode: typeof config?.programCode === 'string'
        ? config.programCode
        : 'SEAFOOD_PREPACKAGED',
      captainDirectCents,
      captainMonthlyCents,
      captainProfitBaseCents: yuanToCents(snapshot.captainEligibleProfitAmount),
      platformRetainedCents,
      configVersion: typeof captain?.configVersion === 'string'
        ? captain.configVersion
        : `snapshot:${snapshot.id}`,
    };
  }

  private async appendRewardComponents(
    tx: Prisma.TransactionClient,
    result: AdjustmentComponent[],
    rows: any[],
    targetCents: number,
    targets: ReturnType<AdminProfitReconciliationService['paymentTargets']>,
    sourceBasis: ExistingSourceBasis,
    targetSnapshot: any,
    allocations: any[],
    orderId: string,
  ): Promise<void> {
    rows = rows.filter((row) => row.status !== 'VOIDED');
    const targetSnapshotId = targetSnapshot.id;
    const rule = this.asRecord(targetSnapshot.ruleSnapshot);
    const buyerPath = rule?.buyerPath === 'VIP' ? 'VIP' : 'NORMAL';
    const ruleVersion = typeof rule?.vipNormalConfigVersion === 'string'
      ? rule.vipNormalConfigVersion
      : `snapshot:${targetSnapshotId}`;
    const treeRuleType = buyerPath === 'VIP' ? 'VIP_UPSTREAM' : 'NORMAL_TREE';
    const platformRuleType = buyerPath === 'VIP' ? 'VIP_PLATFORM_SPLIT' : 'NORMAL_TREE';
    const directRuleType = buyerPath === 'VIP'
      ? 'VIP_DIRECT_REFERRAL'
      : 'NORMAL_DIRECT_REFERRAL';
    const allocationByRule = (ruleType: string) => allocations.find(
      (allocation) => allocation.ruleType === ruleType,
    ) ?? rows.find((row) => row.allocation?.ruleType === ruleType)?.allocation ?? null;
    const directRows = rows.filter((row) => (
      row.allocation?.ruleType === 'NORMAL_DIRECT_REFERRAL'
      || row.allocation?.ruleType === 'VIP_DIRECT_REFERRAL'
      || row.meta?.scheme === 'NORMAL_DIRECT_REFERRAL'
      || row.meta?.scheme === 'VIP_DIRECT_REFERRAL'
      || row.meta?.originalScheme === 'NORMAL_DIRECT_REFERRAL'
      || row.meta?.originalScheme === 'VIP_DIRECT_REFERRAL'
      || row.meta?.scheme === 'NORMAL_DIRECT_REFERRAL_PLATFORM'
      || row.meta?.scheme === 'VIP_DIRECT_REFERRAL_PLATFORM'
    ));
    const treeRows = rows.filter((row) => {
      const scheme = row.meta?.scheme;
      return !directRows.includes(row) && [
        'NORMAL_TREE',
        'NORMAL_TREE_FALLBACK',
        'VIP_UPSTREAM',
        'VIP_UPSTREAM_FALLBACK',
      ].includes(scheme);
    });
    if (directRows.length === 0 && targetCents > 0) {
      result.push(this.component({
        key: 'reward:direct:new', kind: 'REWARD', sourceLedgerId: null,
        accountId: null, userId: targets.directRewardUserId,
        accountType: targets.directRewardAccountType, bucket: 'frozen',
        sourceBasisSnapshotId: targetSnapshotId,
        sourceAllocationId: allocationByRule(directRuleType)?.id ?? null,
        sourceAllocationRuleType: directRuleType,
        sourceAllocationRuleVersion: ruleVersion,
        sourceStatus: 'FROZEN',
        sourceEntryType: 'FREEZE',
        sourceMeta: {
          scheme: directRuleType,
          sourceOrderId: orderId,
        },
        beforeCents: 0, targetCents, canonicalSource: true,
      }));
    }
    directRows.forEach((row, index) => {
      const beforeCents = yuanToCents(row.amount);
      result.push(this.component({
        key: `reward:direct:${row.id}`, kind: 'REWARD', sourceLedgerId: row.id,
        accountId: row.accountId, userId: row.userId, accountType: row.account?.type,
        bucket: this.rewardBucketForStatus(row.status),
        canonicalSource: true,
        sourceAllocationId: row.allocationId ?? row.allocation?.id ?? null,
        sourceStatus: row.status,
        sourceEntryType: row.entryType,
        sourceMeta: row.meta ?? null,
        sourceBasisSnapshotId: sourceBasis.reward.get(row.id) ?? targetSnapshotId,
        beforeCents, targetCents: index === 0 ? targetCents : 0,
      }));
    });
    const treeTargets = this.allocateTargetAcrossRows(targets.rewardPoolCents, treeRows);
    if (treeRows.length === 0 && targets.rewardPoolCents > 0) {
      const eligibleModel = buyerPath === 'VIP'
        ? (tx as any).vipEligibleOrder
        : (tx as any).normalEligibleOrder;
      const eligibleOrder = eligibleModel?.findUnique
        ? await eligibleModel.findUnique({ where: { orderId } })
        : null;
      const effectiveIndex = Number.isSafeInteger(eligibleOrder?.effectiveIndex)
        && eligibleOrder.effectiveIndex > 0
        ? eligibleOrder.effectiveIndex
        : 1;
      const ancestorPath = buyerPath === 'VIP'
        ? rule?.vipTreeAncestorPathAtPayment
        : rule?.normalTreeAncestorPathAtPayment;
      const ancestor = Array.isArray(ancestorPath) ? ancestorPath[effectiveIndex - 1] : null;
      const recipientId = typeof ancestor?.userId === 'string' && ancestor.userId.length > 0
        ? ancestor.userId
        : null;
      const recipient = recipientId && (tx as any).user?.findUnique
        ? await (tx as any).user.findUnique({
            where: { id: recipientId },
            select: { status: true, deletionExecutedAt: true },
          })
        : recipientId ? { status: 'ACTIVE', deletionExecutedAt: null } : null;
      const useRecipient = recipientId
        && recipient?.status === 'ACTIVE'
        && recipient?.deletionExecutedAt == null;
      result.push(this.component({
        key: 'reward:tree:new',
        kind: 'REWARD',
        sourceLedgerId: null,
        accountId: null,
        userId: useRecipient ? recipientId : PLATFORM_USER_ID,
        accountType: useRecipient
          ? buyerPath === 'VIP' ? 'VIP_REWARD' : 'NORMAL_REWARD'
          : 'PLATFORM_PROFIT',
        bucket: useRecipient ? 'none' : 'balance',
        canonicalSource: true,
        sourceAllocationId: allocationByRule(treeRuleType)?.id ?? null,
        sourceAllocationRuleType: treeRuleType,
        sourceAllocationRuleVersion: ruleVersion,
        sourceStatus: useRecipient ? 'RETURN_FROZEN' : 'AVAILABLE',
        sourceEntryType: useRecipient ? 'FREEZE' : 'RELEASE',
        sourceMeta: useRecipient ? {
          scheme: treeRuleType,
          sourceOrderId: orderId,
          effectiveIndex,
          ancestorNodeId: ancestor?.nodeId ?? null,
          adjustmentKind: 'MISSING_CANONICAL_SOURCE',
        } : {
          scheme: `${treeRuleType}_FALLBACK`,
          sourceOrderId: orderId,
          effectiveIndex,
          reason: 'RECONCILIATION_MISSING_SOURCE',
        },
        sourceBasisSnapshotId: targetSnapshotId,
        beforeCents: 0,
        targetCents: targets.rewardPoolCents,
      }));
    }
    treeRows.forEach((row) => {
      const beforeCents = yuanToCents(row.amount);
      result.push(this.component({
        key: `reward:tree:${row.id}`, kind: 'REWARD', sourceLedgerId: row.id,
        accountId: row.accountId, userId: row.userId, accountType: row.account?.type,
        bucket: this.rewardBucketForStatus(row.status),
        canonicalSource: true,
        sourceAllocationId: row.allocationId ?? row.allocation?.id ?? null,
        sourceStatus: row.status,
        sourceEntryType: row.entryType,
        sourceMeta: row.meta ?? null,
        sourceBasisSnapshotId: sourceBasis.reward.get(row.id) ?? targetSnapshotId,
        beforeCents, targetCents: treeTargets[row.id] ?? 0,
      }));
    });
    const remainingRows = rows.filter(
      (row) => !directRows.includes(row) && !treeRows.includes(row),
    );
    const bucketSpecs = [
      { accountType: 'PLATFORM_PROFIT', key: 'platform', targetCents: targets.platformProfitCents },
      { accountType: 'INDUSTRY_FUND', key: 'industry', targetCents: targets.industryFundCents },
      { accountType: 'CHARITY_FUND', key: 'charity', targetCents: targets.charityFundCents },
      { accountType: 'TECH_FUND', key: 'tech', targetCents: targets.techFundCents },
      { accountType: 'RESERVE_FUND', key: 'reserve', targetCents: targets.reserveFundCents },
    ];
    const classified = new Set<any>();
    for (const bucket of bucketSpecs) {
      const bucketRows = remainingRows.filter(
        (row) => (row.meta?.accountType ?? row.account?.type) === bucket.accountType,
      );
      const bucketTargets = this.allocateTargetAcrossRows(bucket.targetCents, bucketRows);
      if (bucketRows.length === 0 && bucket.targetCents > 0) {
        result.push(this.component({
          key: `reward:${bucket.key}:new`,
          kind: 'REWARD',
          sourceLedgerId: null,
          accountId: null,
          userId: PLATFORM_USER_ID,
          accountType: bucket.accountType,
          bucket: 'balance',
          canonicalSource: true,
          sourceAllocationId: allocationByRule(platformRuleType)?.id ?? null,
          sourceAllocationRuleType: platformRuleType,
          sourceAllocationRuleVersion: ruleVersion,
          sourceStatus: 'AVAILABLE',
          sourceEntryType: 'RELEASE',
          sourceMeta: {
            scheme: buyerPath === 'VIP' ? 'VIP_PLATFORM_SPLIT' : 'NORMAL_PLATFORM_SPLIT',
            accountType: bucket.accountType,
            sourceOrderId: orderId,
            adjustmentKind: 'MISSING_CANONICAL_SOURCE',
          },
          sourceBasisSnapshotId: targetSnapshotId,
          beforeCents: 0,
          targetCents: bucket.targetCents,
        }));
      }
      for (const row of bucketRows) {
        classified.add(row);
        const beforeCents = yuanToCents(row.amount);
        result.push(this.component({
          key: `reward:${bucket.key}:${row.id}`,
          kind: 'REWARD',
          sourceLedgerId: row.id,
          accountId: row.accountId,
          userId: row.userId,
          accountType: row.account?.type,
          bucket: this.rewardBucketForStatus(row.status),
          canonicalSource: true,
          sourceAllocationId: row.allocationId ?? row.allocation?.id ?? null,
          sourceStatus: row.status,
          sourceEntryType: row.entryType,
          sourceMeta: row.meta ?? null,
          sourceBasisSnapshotId: sourceBasis.reward.get(row.id) ?? targetSnapshotId,
          beforeCents,
          targetCents: bucketTargets[row.id] ?? 0,
        }));
      }
    }
    const unsupported = remainingRows.filter((row) => !classified.has(row));
    if (unsupported.length > 0) {
      throw new BadRequestException({
        code: 'ORDER_PROFIT_RECONCILIATION_CONFLICT',
        message: '存在无法映射目标金额的奖励来源',
        sourceLedgerIds: unsupported.map((row) => row.id),
      });
    }
  }

  private appendCaptainComponents(
    result: AdjustmentComponent[],
    rows: any[],
    targetCents: number,
    targets: ReturnType<AdminProfitReconciliationService['paymentTargets']>,
    sourceBasis: ExistingSourceBasis,
    targetSnapshotId: string,
    attribution: any,
  ) {
    const directRows = rows.filter((row) => row.type === 'DIRECT_ORDER');
    if (directRows.length === 0 && targetCents > 0) {
      result.push(this.component({
        key: 'captain:direct:new', kind: 'CAPTAIN', sourceLedgerId: null,
        accountId: null, userId: targets.captainUserId,
        accountType: targets.captainProgramCode, bucket: 'frozen',
        sourceStatus: 'FROZEN',
        sourceType: 'DIRECT_ORDER',
        sourceMeta: {
          calculationModel: 'PROFIT_V3',
          sourceOrderId: attribution?.orderId ?? null,
          adjustmentKind: 'MISSING_CANONICAL_SOURCE',
        },
        orderAttributionId: attribution?.id ?? null,
        programCode: targets.captainProgramCode,
        sourceBasisSnapshotId: targetSnapshotId,
        beforeCents: 0, targetCents, canonicalSource: true,
      }));
    }
    directRows.forEach((row, index) => {
      const beforeCents = yuanToCents(row.amount);
      result.push(this.component({
        key: `captain:direct:${row.id}`, kind: 'CAPTAIN', sourceLedgerId: row.id,
        accountId: row.accountId, userId: row.userId,
        accountType: row.account?.programCode ?? targets.captainProgramCode,
        bucket: row.status === 'FROZEN' ? 'frozen' : 'balance',
        canonicalSource: true,
        sourceStatus: row.status,
        sourceType: row.type,
        sourceMeta: row.meta ?? null,
        orderAttributionId: row.orderAttributionId ?? null,
        programCode: row.programCode ?? targets.captainProgramCode,
        sourceBasisSnapshotId: sourceBasis.captain.get(row.id) ?? targetSnapshotId,
        beforeCents, targetCents: index === 0 ? targetCents : 0,
      }));
    });
    rows.filter((row) => !directRows.includes(row)).forEach((row) => {
      const beforeCents = yuanToCents(row.amount);
      result.push(this.component({
        key: `captain:other:${row.id}`, kind: 'CAPTAIN', sourceLedgerId: row.id,
        accountId: row.accountId, userId: row.userId,
        accountType: row.account?.programCode ?? targets.captainProgramCode,
        bucket: row.status === 'FROZEN' ? 'frozen' : 'balance',
        sourceBasisSnapshotId: sourceBasis.captain.get(row.id) ?? targetSnapshotId,
        beforeCents, targetCents: beforeCents,
      }));
    });
  }

  private rewardBucketForStatus(status: string): 'frozen' | 'balance' | 'none' {
    if (status === 'FROZEN') return 'frozen';
    if (status === 'RETURN_FROZEN') return 'none';
    return 'balance';
  }

  private appendFundingComponents(
    result: AdjustmentComponent[],
    rows: any[],
    targets: ReturnType<AdminProfitReconciliationService['paymentTargets']>,
    sourceBasis: ExistingSourceBasis,
    targetSnapshotId: string,
    sourceSnapshotId: string | null,
  ) {
    const targetByType: Record<string, number> = {
      PLATFORM_RETAINED_CREDIT: targets.platformRetainedCents,
      CAPTAIN_DIRECT_HOLD: -targets.captainDirectCents,
      CAPTAIN_MONTHLY_HOLD: -targets.captainMonthlyCents,
    };
    for (const [type, targetCents] of Object.entries(targetByType)) {
      const matching = rows.filter((row) => (
        row.type === type
        && (!sourceSnapshotId || row.snapshotId === sourceSnapshotId)
      ));
      const beforeCents = matching.reduce(
        (sum, row) => sum + yuanToCents(row.amount),
        0,
      );
      result.push(this.component({
        key: `funding:${type}`, kind: 'FUNDING',
        sourceLedgerId: matching[0]?.id ?? null,
        sourceLedgerIds: matching.map((row) => row.id),
        sourceBasisSnapshotId: matching.length > 0
          ? sourceBasis.funding.get(matching[0].id) ?? targetSnapshotId
          : targetSnapshotId,
        fundingType: type,
        canonicalSource: true,
        beforeCents,
        targetCents,
      }));
    }
    const historicalAuditTypes = new Set(['CAPTAIN_MONTHLY_RELEASE', 'REFUND_ADJUSTMENT']);
    const unsupported = rows.filter((row) => (
      !(row.type in targetByType) && !historicalAuditTypes.has(row.type)
    ));
    if (unsupported.length > 0) {
      throw new BadRequestException({
        code: 'ORDER_PROFIT_RECONCILIATION_CONFLICT',
        message: '存在无法自动修订的资金来源',
        sourceLedgerIds: unsupported.map((row) => row.id),
      });
    }
  }

  private captainEligibleNetGoodsCents(value: unknown): number {
    if (!Array.isArray(value)) throw new BadRequestException('目标利润快照商品明细无效');
    let total = 0;
    for (const raw of value) {
      const row = this.asRecord(raw);
      if (!row || typeof row.captainEligible !== 'boolean') {
        throw new BadRequestException('目标利润快照商品明细无效');
      }
      if (!row.captainEligible) continue;
      const cents = this.requireNonNegativeSafeCents(
        row.netGoodsRevenueCents,
        '团长可计入商品净收入',
      );
      total += cents;
      if (!Number.isSafeInteger(total)) {
        throw new BadRequestException('团长可计入商品净收入超过安全整数分范围');
      }
    }
    return total;
  }

  private monthlySettlementAdjustment(
    settlementOrder: any,
    targets: ReturnType<AdminProfitReconciliationService['paymentTargets']>,
  ) {
    const fields = [
      'baseManagementAmount',
      'growthBonusAmount',
      'cultivationBonusAmount',
      'performanceBonusAmount',
    ] as const;
    const beforeProfitBaseCents = yuanToCents(settlementOrder.profitBaseAmount ?? 0);
    const beforeByField = Object.fromEntries(
      fields.map((field) => [field, yuanToCents(settlementOrder[field] ?? 0)]),
    ) as Record<(typeof fields)[number], number>;
    const beforeTotalCents = fields.reduce((sum, field) => sum + beforeByField[field], 0);
    const requestedTargetCents = beforeProfitBaseCents > 0
      ? Number(
          (BigInt(targets.captainProfitBaseCents) * BigInt(beforeTotalCents)
            + BigInt(Math.floor(beforeProfitBaseCents / 2)))
          / BigInt(beforeProfitBaseCents),
        )
      : 0;
    const targetTotalCents = Math.min(targets.captainMonthlyCents, requestedTargetCents);
    const allocation = allocateCentsByLargestRemainder(
      targetTotalCents,
      fields.map((field) => ({
        id: field,
        weightCents: beforeByField[field],
        capacityCents: targetTotalCents,
      })),
    );
    if (allocation.unallocatedCents !== 0) {
      throw new BadRequestException('已月结订单的目标月奖无法完整分配');
    }
    return {
      settlementId: settlementOrder.settlementId ?? settlementOrder.settlement?.id,
      settlementOrderId: settlementOrder.id,
      settlementStatus: settlementOrder.settlement?.status ?? null,
      month: settlementOrder.settlement?.month ?? null,
      beforeProfitBaseCents,
      targetProfitBaseCents: targets.captainProfitBaseCents,
      beforeTotalCents,
      targetTotalCents,
      deltaTotalCents: targetTotalCents - beforeTotalCents,
      categories: fields.map((field) => ({
        field,
        beforeCents: beforeByField[field],
        targetCents: allocation.allocations[field] ?? 0,
        deltaCents: (allocation.allocations[field] ?? 0) - beforeByField[field],
      })),
    };
  }

  private component(value: Omit<AdjustmentComponent, 'deltaCents'>): AdjustmentComponent {
    const deltaCents = value.targetCents - value.beforeCents;
    if (
      !Number.isSafeInteger(value.beforeCents)
      || !Number.isSafeInteger(value.targetCents)
      || !Number.isSafeInteger(deltaCents)
    ) {
      throw new BadRequestException('补差金额超过安全整数分范围');
    }
    return { ...value, deltaCents };
  }

  private allocateTargetAcrossRows(targetCents: number, rows: any[]): Record<string, number> {
    if (rows.length === 0) return {};
    const allocation = allocateCentsByLargestRemainder(
      targetCents,
      rows.map((row) => ({
        id: row.id,
        weightCents: Math.max(1, Math.abs(yuanToCents(row.amount))),
        capacityCents: targetCents,
      })),
    );
    if (allocation.unallocatedCents !== 0) {
      throw new BadRequestException('奖励目标金额无法按来源完整分配');
    }
    return allocation.allocations;
  }

  private resolutionResult(task: any, resolvedSnapshot: any, adjustmentDraft: any) {
    return {
      task: {
        id: task.id,
        orderId: task.orderId,
        status: task.status,
        sourceSnapshotId: task.sourceSnapshotId,
        resolvedSnapshotId: task.resolvedSnapshotId,
        resolutionNote: task.resolutionNote,
        resolvedByAdminId: task.resolvedByAdminId,
        resolvedAt: task.resolvedAt,
      },
      resolvedSnapshot,
      adjustmentDraft,
    };
  }

  private requireNote(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${label}不能为空`);
    }
    return value.trim();
  }

  private requireNonNegativeSafeCents(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException(`${label}必须为非负整数分`);
    }
    return value;
  }

  private requireRate(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new BadRequestException(`${label}无效`);
    }
    return value;
  }

  private asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null;
  }
}
