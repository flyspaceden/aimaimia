import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  QueueRewardCalculator,
  type QueueRewardDistributionMode,
} from '../bonus/engine/queue-reward-calculator';
import { PLATFORM_USER_ID } from '../bonus/engine/constants';
import {
  ACTIVE_STATUSES,
  SUCCESS_STATUSES,
} from '../after-sale/after-sale.constants';
import { NotificationService } from '../notification/notification.service';
import { centsToYuan, yuanToCents } from '../profit/money-allocation';
import { pendingQueueClawbackCents } from './queue-reward-clawback';

type Tx = Prisma.TransactionClient;

export interface QueueRewardRuleSnapshot {
  enabled: boolean;
  queueSize: number;
  rewardPercent: number;
  splitUnitAmount: number;
  maxPositionsPerOrder: number;
  distributionMode: QueueRewardDistributionMode;
  randomStddev: number;
  randomMinFactor: number;
  randomMaxFactor: number;
  activationAt: string;
}

export interface QueueRewardReceiptInput {
  orderId: string;
  userId: string;
  paidAt: Date;
  returnWindowExpiresAt: Date | null;
  eligiblePaidCents: number;
  profitCents: number;
  platformProfitCents: number;
  hasSuccessfulAfterSale: boolean;
  ruleVersion: string;
  ruleSnapshot: unknown;
}

export interface QueueRewardReceiptResult {
  participated: boolean;
  alreadyProcessed: boolean;
  fundedCents: number;
  positionCount: number;
  reason?: string;
}

export interface QueueRewardVoidOptions {
  /**
   * 来源订单发生退款时，只有仍然保留的利润比例可以回到平台利润账户。
   * 换货或“受益位置订单”售后不传，按 100% 回平台处理。
   */
  sourcePlatformReturnRatio?: {
    numerator: number;
    denominator: number;
  };
  /** 累计退款重算的平台回流调整幂等键，使用 Refund.id。 */
  sourceAdjustmentId?: string;
  /**
   * 注销账号只作废该用户作为受益位置收到的红包，不能撤回该用户
   * 历史消费已经发给其他人的红包。
   */
  beneficiaryOnly?: boolean;
}

const GLOBAL_QUEUE_LOCK = 'global-order-queue-reward-v1';
const MAX_SERIALIZABLE_ATTEMPTS = 3;
const RELEASE_BATCH_SIZE = 100;
const RELEASE_SWEEP_BUDGET_MS = 45_000;
const DEFAULT_STATUS_PAGE_SIZE = 20;
const MAX_STATUS_PAGE_SIZE = 100;

@Injectable()
export class QueueRewardService {
  private readonly logger = new Logger(QueueRewardService.name);
  private readonly calculator = new QueueRewardCalculator();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async getUserStatus(
    userId: string,
    rawAfterSequence?: unknown,
    rawPositionPageSize: unknown = DEFAULT_STATUS_PAGE_SIZE,
  ) {
    const afterSequence =
      this.normalizeOptionalPositiveBigInt(rawAfterSequence);
    const positionPageSize = Math.min(
      MAX_STATUS_PAGE_SIZE,
      this.normalizePositiveInteger(
        rawPositionPageSize,
        DEFAULT_STATUS_PAGE_SIZE,
      ),
    );
    const [
      configRows,
      account,
      states,
      positionCandidates,
      recentRewards,
      totalActivePositions,
      pendingQueueClawbacks,
    ] =
      await Promise.all([
        this.prisma.ruleConfig.findMany({
          where: {
            key: {
              in: [
                'QUEUE_REWARD_ENABLED',
                'QUEUE_SIZE',
                'QUEUE_SPLIT_UNIT_AMOUNT',
                'QUEUE_MAX_POSITIONS_PER_ORDER',
                'QUEUE_DISTRIBUTION_MODE',
              ],
            },
          },
          select: { key: true, value: true },
        }),
        this.prisma.rewardAccount.findUnique({
          where: {
            userId_type: {
              userId,
              type: 'QUEUE_REWARD',
            },
          },
          select: { balance: true },
        }),
        this.prisma.queueRewardOrderState.findMany({
          where: { userId, status: { not: 'VOIDED' } },
          select: {
            id: true,
            orderId: true,
            eligiblePaidAmount: true,
            sharedCapAmount: true,
            availableReceivedAmount: true,
            status: true,
            createdAt: true,
            order: {
              select: {
                id: true,
                returnWindowExpiresAt: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.queueRewardPosition.findMany({
          where: {
            userId,
            status: { in: ['ACTIVE', 'CAPPED'] },
            ...(afterSequence !== null
              ? { sequence: { gt: afterSequence } }
              : {}),
          },
          select: {
            id: true,
            sequence: true,
            orderId: true,
            unitIndex: true,
            observedUnitCount: true,
            targetObservedUnitCount: true,
            status: true,
            joinedAt: true,
            orderState: {
              select: {
                sharedCapAmount: true,
                availableReceivedAmount: true,
                order: { select: { id: true } },
              },
            },
          },
          orderBy: { sequence: 'asc' },
          take: positionPageSize + 1,
        }),
        this.prisma.queueRewardDistribution.findMany({
          where: {
            recipientUserId: userId,
            status: 'AVAILABLE',
          },
          select: {
            id: true,
            amount: true,
            status: true,
            releaseAt: true,
            releasedAt: true,
            voidedAt: true,
            createdAt: true,
            allocation: {
              select: {
                sourceOrder: {
                  select: { id: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        this.prisma.queueRewardPosition.count({
          where: {
            userId,
            status: { in: ['ACTIVE', 'CAPPED'] },
          },
        }),
        this.prisma.rewardLedger.findMany({
          where: {
            userId,
            entryType: 'VOID',
            status: 'RETURN_FROZEN',
            account: { type: 'QUEUE_REWARD' },
          },
          select: { amount: true, meta: true },
        }),
      ]);

    const hasMorePositions =
      positionCandidates.length > positionPageSize;
    const positions = positionCandidates.slice(
      0,
      positionPageSize,
    );
    const rankedRows =
      positions.length === 0
        ? []
        : await this.prisma.$queryRaw<
            Array<{ id: string; ahead: bigint }>
          >(Prisma.sql`
            WITH ranked AS (
              SELECT
                "id",
                COUNT(*) OVER (
                  ORDER BY "sequence"
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                )::bigint AS "ahead"
              FROM "QueueRewardPosition"
              WHERE "status" IN (
                'ACTIVE'::"QueueRewardPositionStatus",
                'CAPPED'::"QueueRewardPositionStatus"
              )
            )
            SELECT "id", "ahead"
            FROM ranked
            WHERE "id" IN (${Prisma.join(
              positions.map((position) => position.id),
            )})
          `);
    const aheadByPositionId = new Map(
      rankedRows.map((row) => [
        row.id,
        Number(row.ahead),
      ]),
    );
    const positionsWithRank = positions.map((position) => {
      const ahead = aheadByPositionId.get(position.id) ?? 0;
      return {
          id: position.id,
          sequence: position.sequence.toString(),
          orderId: position.orderId,
          orderNo: this.displayOrderId(
            position.orderState.order.id,
          ),
          unitIndex: position.unitIndex,
          status: position.status,
          ahead,
          observedUnitCount: position.observedUnitCount,
          targetObservedUnitCount:
            position.targetObservedUnitCount,
          remainingObservedUnitCount: Math.max(
            0,
            position.targetObservedUnitCount -
              position.observedUnitCount,
          ),
          sharedCapAmount: position.orderState.sharedCapAmount,
          receivedAmount:
            position.orderState.availableReceivedAmount,
          joinedAt: position.joinedAt.toISOString(),
      };
    });
    const config = new Map(
      configRows.map((row) => [
        row.key,
        this.unwrapConfigValue(row.value),
      ]),
    );
    const withdrawableQueueBalance = centsToYuan(
      Math.max(
        0,
        yuanToCents(account?.balance ?? 0) -
          pendingQueueClawbackCents(pendingQueueClawbacks),
      ),
    );

    return {
      enabled: config.get('QUEUE_REWARD_ENABLED') === true,
      queueSize: Number(config.get('QUEUE_SIZE') ?? 21),
      splitUnitAmount: Number(
        config.get('QUEUE_SPLIT_UNIT_AMOUNT') ?? 200,
      ),
      maxPositionsPerOrder: Number(
        config.get('QUEUE_MAX_POSITIONS_PER_ORDER') ?? 100,
      ),
      distributionMode:
        config.get('QUEUE_DISTRIBUTION_MODE') ===
        'NORMAL_RANDOM'
          ? 'NORMAL_RANDOM'
          : 'AVERAGE',
      wallet: {
        available: withdrawableQueueBalance,
        total: withdrawableQueueBalance,
      },
      totalActivePositions,
      positionPage: {
        pageSize: positionPageSize,
        total: totalActivePositions,
        hasMore: hasMorePositions,
        nextSequence:
          positions.at(-1)?.sequence.toString() ?? null,
      },
      activePositions: positionsWithRank,
      recentOrders: states.map((state) => ({
        orderId: state.orderId,
        orderNo: this.displayOrderId(state.order.id),
        eligiblePaidAmount: state.eligiblePaidAmount,
        sharedCapAmount: state.sharedCapAmount,
        availableReceivedAmount:
          state.availableReceivedAmount,
        status: state.status,
        returnWindowExpiresAt:
          state.order.returnWindowExpiresAt?.toISOString() ?? null,
        createdAt: state.createdAt.toISOString(),
      })),
      recentRewards: recentRewards.map((reward) => ({
        id: reward.id,
        amount: reward.amount,
        status: reward.status,
        sourceOrderNo:
          this.displayOrderId(reward.allocation.sourceOrder.id),
        releaseAt: reward.releaseAt?.toISOString() ?? null,
        releasedAt: reward.releasedAt?.toISOString() ?? null,
        voidedAt: reward.voidedAt?.toISOString() ?? null,
        createdAt: reward.createdAt.toISOString(),
      })),
    };
  }

  private normalizePositiveInteger(
    value: unknown,
    fallback: number,
  ): number {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
      return fallback;
    }
    return parsed;
  }

  private normalizeOptionalPositiveBigInt(
    value: unknown,
  ): bigint | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'bigint'
    ) {
      return null;
    }
    try {
      const parsed = BigInt(value);
      return parsed >= 0n ? parsed : null;
    } catch {
      return null;
    }
  }

  private displayOrderId(orderId: string): string {
    return orderId.length <= 12
      ? orderId
      : orderId.slice(-12).toUpperCase();
  }

  async allocateForReceivedOrder(
    tx: Tx,
    input: QueueRewardReceiptInput,
  ): Promise<QueueRewardReceiptResult> {
    this.assertReceiptMoney(input);
    const config = this.readSnapshot(input.ruleSnapshot);
    if (!config) {
      return {
        participated: false,
        alreadyProcessed: false,
        fundedCents: 0,
        positionCount: 0,
        reason: 'QUEUE_CONFIG_DISABLED_OR_INVALID',
      };
    }
    if (
      config.activationAt &&
      input.paidAt.getTime() < Date.parse(config.activationAt)
    ) {
      return {
        participated: false,
        alreadyProcessed: false,
        fundedCents: 0,
        positionCount: 0,
        reason: 'ORDER_PAID_BEFORE_QUEUE_ACTIVATION',
      };
    }
    if (input.eligiblePaidCents <= 0) {
      return {
        participated: false,
        alreadyProcessed: false,
        fundedCents: 0,
        positionCount: 0,
        reason: 'NO_ELIGIBLE_NON_PRIZE_PAYMENT',
      };
    }

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${GLOBAL_QUEUE_LOCK}))
    `;

    const existing = await tx.queueRewardOrderState.findUnique({
      where: { orderId: input.orderId },
      include: { positions: { select: { id: true } } },
    });
    if (existing) {
      const funded = await tx.queueRewardAllocation.aggregate({
        where: { sourceOrderId: input.orderId },
        _sum: { distributedAmount: true },
      });
      return {
        participated: true,
        alreadyProcessed: true,
        fundedCents: yuanToCents(
          Number(funded._sum.distributedAmount ?? 0),
        ),
        positionCount: existing.positions.length,
      };
    }

    // 锁内重新核验成功售后，闭合“售后先完成、收货分润后执行”的竞态。
    // input 标志保留用于上层已加载事实；这里的数据库事实是最终裁决。
    const successfulAfterSale = await tx.afterSaleRequest.findFirst({
      where: {
        orderId: input.orderId,
        status: { in: ['REFUNDED', 'COMPLETED'] },
      },
      select: { id: true },
    });
    const hasSuccessfulAfterSale =
      input.hasSuccessfulAfterSale || Boolean(successfulAfterSale);

    const positionCount = this.calculator.calculateUnitCount(
      input.eligiblePaidCents,
      yuanToCents(config.splitUnitAmount),
      config.maxPositionsPerOrder,
    );
    const configSnapshot = {
      ...config,
      fundingSource: 'PLATFORM_PROFIT',
      paidAt: input.paidAt.toISOString(),
    } as Prisma.InputJsonValue;
    const orderState = await tx.queueRewardOrderState.create({
      data: {
        orderId: input.orderId,
        userId: input.userId,
        eligiblePaidAmount: centsToYuan(input.eligiblePaidCents),
        sharedCapAmount: centsToYuan(input.eligiblePaidCents),
        status: hasSuccessfulAfterSale ? 'VOIDED' : 'ACTIVE',
        ruleVersion: input.ruleVersion,
        configSnapshot,
      },
    });
    const rewardAllocation = await tx.rewardAllocation.create({
      data: {
        triggerType: 'ORDER_RECEIVED',
        orderId: input.orderId,
        ruleType: 'GLOBAL_QUEUE',
        ruleVersion: input.ruleVersion,
        meta: {
          queueReward: configSnapshot,
          eligiblePaidAmount: centsToYuan(input.eligiblePaidCents),
          profitAmount: centsToYuan(input.profitCents),
          platformProfitBeforeQueue: centsToYuan(
            input.platformProfitCents,
          ),
          voidedBeforeEntry: hasSuccessfulAfterSale,
        },
        idempotencyKey:
          `ALLOC:ORDER_RECEIVED:${input.orderId}:GLOBAL_QUEUE`,
      },
    });

    if (hasSuccessfulAfterSale) {
      this.logger.warn(
        `订单 ${input.orderId} 在确认收货前已有成功售后，记录 VOIDED 队列状态但不入队`,
      );
      return {
        participated: true,
        alreadyProcessed: false,
        fundedCents: 0,
        positionCount: 0,
        reason: 'SUCCESSFUL_AFTER_SALE_BEFORE_QUEUE_ENTRY',
      };
    }

    const nominalRewardPoolCents = Math.min(
      input.platformProfitCents,
      Math.floor(input.profitCents * config.rewardPercent + 1e-9),
    );
    const unitBudgets = this.calculator.splitIntoUnitBudgets({
      eligiblePaidCents: input.eligiblePaidCents,
      profitCents: input.profitCents,
      rewardPoolCents: nominalRewardPoolCents,
      splitUnitCents: yuanToCents(config.splitUnitAmount),
      maxUnitCount: config.maxPositionsPerOrder,
    });
    let fundedCents = 0;

    for (const unit of unitBudgets) {
      const priorPositions = await tx.queueRewardPosition.findMany({
        where: {
          orderId: { not: input.orderId },
          status: { in: ['ACTIVE', 'CAPPED'] },
        },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        // QUEUE_SIZE 是硬滑动窗口。大单可以产生多于一个窗口的位置，
        // 但只有全局最前面的 N-1 个历史位置参与本单元分配和推进。
        take: config.queueSize - 1,
        include: {
          orderState: {
            include: {
              order: {
                select: {
                  status: true,
                  returnWindowExpiresAt: true,
                  user: {
                    select: {
                      status: true,
                      deletionExecutedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      const freshOrderState =
        await tx.queueRewardOrderState.findUniqueOrThrow({
          where: { id: orderState.id },
        });
      const currentRemainingCapCents =
        this.remainingCapCents(freshOrderState);
      const sourcePosition = await tx.queueRewardPosition.create({
        data: {
          orderStateId: orderState.id,
          orderId: input.orderId,
          userId: input.userId,
          unitIndex: unit.unitIndex,
          targetObservedUnitCount: config.queueSize - 1,
          status: currentRemainingCapCents > 0 ? 'ACTIVE' : 'CAPPED',
          ruleVersion: input.ruleVersion,
          configSnapshot,
        },
      });

      const recipients = priorPositions
        .filter(
          (position) =>
            position.status === 'ACTIVE' &&
            position.orderState.status !== 'VOIDED' &&
            position.orderState.order.user.status === 'ACTIVE' &&
            !position.orderState.order.user.deletionExecutedAt,
        )
        .map((position) => ({
          positionId: position.id,
          capGroupId: position.orderStateId,
          remainingCapCents: this.remainingCapCents(position.orderState),
        }));
      const randomSeed =
        `${input.orderId}:${unit.unitIndex}:${input.ruleVersion}`;
      const rotationBase = Math.max(1, recipients.length);
      const rotationOffset =
        Number(BigInt(sourcePosition.sequence) % BigInt(rotationBase));
      const result = this.calculator.distribute({
        rewardPoolCents: unit.rewardPoolCents,
        recipients,
        mode: config.distributionMode,
        randomSeed,
        rotationOffset,
        randomConfig: {
          stddev: config.randomStddev,
          minFactor: config.randomMinFactor,
          maxFactor: config.randomMaxFactor,
        },
      });
      const allocation = await tx.queueRewardAllocation.create({
        data: {
          rewardAllocationId: rewardAllocation.id,
          sourceOrderId: input.orderId,
          sourcePositionId: sourcePosition.id,
          sourceUnitIndex: unit.unitIndex,
          profitAmount: centsToYuan(unit.profitCents),
          rewardPoolAmount: centsToYuan(unit.rewardPoolCents),
          distributedAmount: centsToYuan(result.distributedCents),
          platformRetainedAmount: centsToYuan(
            result.platformRetainedCents,
          ),
          distributionMode: config.distributionMode,
          randomSeed,
          ruleVersion: input.ruleVersion,
          configSnapshot: {
            ...config,
            tailRecipientPositionIds:
              result.tailRecipientPositionIds,
          },
          idempotencyKey:
            `QUEUE_REWARD:${input.orderId}:${unit.unitIndex}`,
        },
      });

      const positionById = new Map(
        priorPositions.map((position) => [position.id, position]),
      );
      const touchedOrderStateIds = new Set<string>();
      for (const item of result.items) {
        const beneficiary = positionById.get(item.positionId);
        if (!beneficiary) {
          throw new Error(
            `queue reward beneficiary position ${item.positionId} disappeared`,
          );
        }
        const amount = centsToYuan(item.amountCents);
        const releaseAt = this.resolveReleaseAt(
          input.returnWindowExpiresAt,
          beneficiary.orderState.order.returnWindowExpiresAt,
        );
        const distribution =
          await tx.queueRewardDistribution.create({
            data: {
              allocationId: allocation.id,
              sourceOrderId: input.orderId,
              sourcePositionId: sourcePosition.id,
              beneficiaryPositionOrderId:
                beneficiary.orderId,
              beneficiaryPositionId: beneficiary.id,
              recipientUserId: beneficiary.userId,
              amount,
              weightSnapshot: {
                preClampWeight: item.preClampWeight,
                clampedWeight: item.clampedWeight,
                normalizedWeight: item.normalizedWeight,
                receivedTailCent:
                  result.tailRecipientPositionIds.includes(
                    item.positionId,
                  ),
              },
              releaseAt,
              idempotencyKey:
                `QUEUE_REWARD_DISTRIBUTION:${input.orderId}:` +
                `${unit.unitIndex}:${beneficiary.id}`,
            },
          });
        await tx.queueRewardOrderState.update({
          where: { id: beneficiary.orderStateId },
          data: {
            // 这里只是内部待结算占用，用于共享领取上限；不写用户钱包，
            // 不向用户展示“冻结红包”，也不发送到账提醒。
            frozenReceivedAmount: { increment: amount },
          },
        });
        touchedOrderStateIds.add(beneficiary.orderStateId);
      }

      await this.markCappedStates(tx, touchedOrderStateIds);
      await this.advancePriorPositions(tx, priorPositions);
      fundedCents += result.distributedCents;
    }

    if (input.profitCents === 0) {
      this.logger.warn(
        `订单 ${input.orderId} 利润为 0 或成本待核对，已入队但未产生队列资金`,
      );
    }
    return {
      participated: true,
      alreadyProcessed: false,
      fundedCents,
      positionCount,
    };
  }

  /**
   * 售后成功时按两个维度整单作废：
   * 1. 该订单曾经作为来源订单发出的全部队列红包；
   * 2. 该订单拆出的历史位置收到的全部队列红包。
   */
  async voidRewardsForOrder(
    orderId: string,
    reason = 'AFTER_SALE_SUCCESS',
  ): Promise<number> {
    for (
      let attempt = 0;
      attempt < MAX_SERIALIZABLE_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          (tx) =>
            this.voidRewardsForOrderInTransaction(
              tx,
              orderId,
              reason,
            ),
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable,
            timeout: 30_000,
          },
        );
      } catch (error: any) {
        if (
          error?.code === 'P2034' &&
          attempt < MAX_SERIALIZABLE_ATTEMPTS - 1
        ) {
          this.logger.warn(
            `队列奖励售后作废发生序列化冲突，重试 ${attempt + 1}/` +
              `${MAX_SERIALIZABLE_ATTEMPTS}: orderId=${orderId}`,
          );
          continue;
        }
        throw error;
      }
    }
    return 0;
  }

  async voidRewardsForOrderInTransaction(
    tx: Tx,
    orderId: string,
    reason = 'AFTER_SALE_SUCCESS',
    options: QueueRewardVoidOptions = {},
  ): Promise<number> {
    await this.acquireGlobalLock(tx);

    const distributions =
      await tx.queueRewardDistribution.findMany({
        where: {
          status: { in: ['FROZEN', 'AVAILABLE'] },
          ...(options.beneficiaryOnly
            ? { beneficiaryPositionOrderId: orderId }
            : {
                OR: [
                  { sourceOrderId: orderId },
                  { beneficiaryPositionOrderId: orderId },
                ],
              }),
        },
        include: {
          beneficiaryPosition: {
            select: { orderStateId: true },
          },
          rewardLedger: {
            select: {
              id: true,
              allocationId: true,
              accountId: true,
              amount: true,
              status: true,
              entryType: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

    let voidedCount = 0;
    for (const distribution of distributions) {
      const originalStatus = distribution.status;
      const cas =
        await tx.queueRewardDistribution.updateMany({
          where: {
            id: distribution.id,
            status: originalStatus,
          },
          data: {
            status: 'VOIDED',
            voidedAt: new Date(),
            voidReason: `${reason}:${orderId}`,
          },
        });
      if (cas.count === 0) continue;
      // FROZEN 仅代表平台内部待结算记录，尚未进入用户钱包；
      // AVAILABLE 才有钱包流水和可提现余额需要回收。
      let recoveredCents =
        originalStatus === 'FROZEN'
          ? yuanToCents(distribution.amount)
          : 0;
      let pendingClawbackCents = 0;
      let pendingWithdrawalIds: string[] = [];
      if (originalStatus === 'AVAILABLE') {
        if (
          !distribution.rewardLedgerId ||
          !distribution.rewardLedger
        ) {
          throw new Error(
            `已释放队列红包 ${distribution.id} 缺少资金流水，拒绝作废`,
          );
        }
        const distributionCents = yuanToCents(distribution.amount);
        const queueAccount = await tx.rewardAccount.findUnique({
          where: {
            userId_type: {
              userId: distribution.recipientUserId,
              type: 'QUEUE_REWARD',
            },
          },
          select: { id: true, balance: true, frozen: true },
        });
        recoveredCents = Math.min(
          distributionCents,
          Math.max(0, yuanToCents(queueAccount?.balance ?? 0)),
        );
        pendingClawbackCents =
          distributionCents - recoveredCents;
        if (
          pendingClawbackCents > 0 &&
          queueAccount &&
          yuanToCents(queueAccount.frozen ?? 0) > 0
        ) {
          const frozenWithdrawalLedgers =
            await tx.rewardLedger.findMany({
              where: {
                accountId: queueAccount.id,
                userId: distribution.recipientUserId,
                entryType: 'WITHDRAW',
                status: 'FROZEN',
                refType: 'WITHDRAW',
                refId: { not: null },
              },
              select: { refId: true },
              orderBy: { createdAt: 'asc' },
            });
          pendingWithdrawalIds = [
            ...new Set(
              frozenWithdrawalLedgers
                .map((ledger) => ledger.refId)
                .filter(
                  (refId): refId is string =>
                    typeof refId === 'string',
                ),
            ),
          ];
        }
        const ledgerCas = await tx.rewardLedger.updateMany({
          where: {
            id: distribution.rewardLedgerId,
            userId: distribution.recipientUserId,
            status: 'AVAILABLE',
            entryType: 'RELEASE',
          },
          data: {
            status: 'VOIDED',
            amount: 0,
          },
        });
        if (ledgerCas.count === 0) {
          throw new Error(
            `队列红包 ${distribution.id} 的流水状态不一致，拒绝作废`,
          );
        }
        if (recoveredCents > 0) {
          const recoveredAmount = centsToYuan(recoveredCents);
          const accountDebit = await tx.rewardAccount.updateMany({
            where: {
              id: queueAccount!.id,
              balance: { gte: recoveredAmount },
            },
            data: {
              balance: { decrement: recoveredAmount },
            },
          });
          if (accountDebit.count === 0) {
            throw new Error(
              `队列奖励账户余额并发变化，拒绝非原子回收: distributionId=${distribution.id}`,
            );
          }
        }
        await tx.rewardLedger.create({
          data: {
            allocationId:
              distribution.rewardLedger.allocationId,
            accountId: distribution.rewardLedger.accountId,
            userId: distribution.recipientUserId,
            entryType: 'VOID',
            amount: -distribution.amount,
            status:
              pendingClawbackCents > 0
                ? 'RETURN_FROZEN'
                : 'VOIDED',
            refType: 'AFTER_SALE',
            refId: orderId,
            idempotencyKey:
              `QUEUE_REWARD_CLAWBACK:${distribution.id}`,
            sourceLedgerId: distribution.rewardLedgerId,
            meta: {
              scheme: 'GLOBAL_QUEUE_VOID',
              originalDistributionId: distribution.id,
              originalStatus,
              recoveredAmount: centsToYuan(recoveredCents),
              clawbackAmount:
                centsToYuan(pendingClawbackCents),
              clawbackStatus:
                pendingClawbackCents > 0
                  ? 'CLAWBACK_PENDING'
                  : undefined,
              pendingWithdrawalIds,
              voidTriggerOrderId: orderId,
              reason,
            },
          },
        });
      }

      const stateDebit =
        await tx.queueRewardOrderState.updateMany({
          where: {
            id: distribution.beneficiaryPosition.orderStateId,
            ...(originalStatus === 'FROZEN'
              ? {
                  frozenReceivedAmount: {
                    gte: distribution.amount,
                  },
                }
              : {
                  availableReceivedAmount: {
                    gte: distribution.amount,
                  },
                }),
          },
          data: {
            ...(originalStatus === 'FROZEN'
              ? {
                  frozenReceivedAmount: {
                    decrement: distribution.amount,
                  },
                }
              : {
                  availableReceivedAmount: {
                    decrement: distribution.amount,
                  },
                }),
            voidedReceivedAmount: {
              increment: distribution.amount,
            },
          },
        });
      if (stateDebit.count === 0) {
        throw new Error(
          `队列订单领取累计不一致，拒绝作废: distributionId=${distribution.id}`,
        );
      }

      const isSourceRefund =
        !options.beneficiaryOnly &&
        distribution.sourceOrderId === orderId;
      const platformReturnRatio = isSourceRefund
        ? this.normalizePlatformReturnRatio(
            options.sourcePlatformReturnRatio,
          )
        : { numerator: 1, denominator: 1 };
      const platformCreditCents =
        this.applySourcePlatformReturnRatio(
          recoveredCents,
          platformReturnRatio,
        );
      if (platformCreditCents > 0) {
        const platformCreditAmount =
          centsToYuan(platformCreditCents);
        const platformAccount = await tx.rewardAccount.upsert({
        where: {
          userId_type: {
            userId: PLATFORM_USER_ID,
            type: 'PLATFORM_PROFIT',
          },
        },
        update: {},
        create: {
          userId: PLATFORM_USER_ID,
          type: 'PLATFORM_PROFIT',
        },
      });
        await tx.rewardLedger.create({
          data: {
            accountId: platformAccount.id,
            userId: PLATFORM_USER_ID,
            entryType: 'RELEASE',
            amount: platformCreditAmount,
            status: 'AVAILABLE',
            refType: 'AFTER_SALE',
            refId: orderId,
            idempotencyKey:
              `QUEUE_REWARD_VOID:${distribution.id}`,
            meta: {
              scheme: 'GLOBAL_QUEUE_VOID',
              accountType: 'PLATFORM_PROFIT',
              sourceOrderId: distribution.sourceOrderId,
              beneficiaryPositionOrderId:
                distribution.beneficiaryPositionOrderId,
              originalRecipientUserId:
                distribution.recipientUserId,
              originalDistributionId: distribution.id,
              originalStatus,
              recoveredAmount: centsToYuan(recoveredCents),
              clawbackAmount:
                centsToYuan(pendingClawbackCents),
              absorbedBySourceRefundAmount: centsToYuan(
                recoveredCents - platformCreditCents,
              ),
              voidTriggerOrderId: orderId,
              reason,
            },
          },
        });
        await tx.rewardAccount.update({
          where: { id: platformAccount.id },
          data: {
            balance: { increment: platformCreditAmount },
          },
        });
      }
      await tx.queueRewardDistribution.update({
        where: { id: distribution.id },
        data: {
          recoveredAmount: centsToYuan(recoveredCents),
          platformReturnedAmount:
            centsToYuan(platformCreditCents),
          platformReturnRatio,
        },
      });
      voidedCount += 1;
    }

    if (
      !options.beneficiaryOnly &&
      options.sourcePlatformReturnRatio
    ) {
      await this.reconcileSourcePlatformReturn(
        tx,
        orderId,
        options.sourcePlatformReturnRatio,
        options.sourceAdjustmentId ?? reason,
      );
    }

    const orderState =
      await tx.queueRewardOrderState.findUnique({
        where: { orderId },
        select: { id: true },
      });
    if (orderState) {
      await tx.queueRewardOrderState.updateMany({
        where: {
          id: orderState.id,
          status: { not: 'VOIDED' },
        },
        data: { status: 'VOIDED' },
      });
      await tx.queueRewardPosition.updateMany({
        where: {
          orderStateId: orderState.id,
          status: { not: 'VOIDED' },
        },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          exitReason: reason,
        },
      });
    }

    return voidedCount;
  }

  async voidRecipientRewardsForUserDeletionInTransaction(
    tx: Tx,
    userId: string,
  ): Promise<number> {
    const states = await tx.queueRewardOrderState.findMany({
      where: {
        userId,
        status: { not: 'VOIDED' },
      },
      select: { orderId: true },
      orderBy: { createdAt: 'asc' },
    });
    let voidedCount = 0;
    for (const state of states) {
      voidedCount +=
        await this.voidRewardsForOrderInTransaction(
          tx,
          state.orderId,
          'ACCOUNT_DELETION',
          { beneficiaryOnly: true },
        );
    }
    return voidedCount;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async releaseEligibleRewards(): Promise<void> {
    const sweepStartedAt = new Date();
    const deadline =
      Date.now() + RELEASE_SWEEP_BUDGET_MS;
    while (Date.now() < deadline) {
      const candidates =
        await this.prisma.queueRewardDistribution.findMany({
        where: {
          status: 'FROZEN',
          releaseAt: { not: null, lte: new Date() },
          // 每轮只处理本轮开始前已经存在的候选。releaseOne 对暂不能
          // 释放的记录会 touch updatedAt，因此不会在同一轮反复占满前100条。
          updatedAt: { lte: sweepStartedAt },
        },
        select: { id: true },
        orderBy: [
          { updatedAt: 'asc' },
          { releaseAt: 'asc' },
          { id: 'asc' },
        ],
        take: RELEASE_BATCH_SIZE,
      });
      if (candidates.length === 0) break;

      for (const candidate of candidates) {
        if (Date.now() >= deadline) return;
        try {
          await this.releaseOne(candidate.id);
        } catch (error) {
          this.logger.error(
            `队列奖励释放失败: distributionId=${candidate.id}, ` +
              `error=${String(error instanceof Error ? error.message : error)}`,
          );
          await this.deferFailedReleaseCandidate(
            candidate.id,
            sweepStartedAt,
          );
        }
      }
    }
  }

  private async releaseOne(distributionId: string): Promise<void> {
    for (
      let attempt = 0;
      attempt < MAX_SERIALIZABLE_ATTEMPTS;
      attempt += 1
    ) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await this.acquireGlobalLock(tx);
            const distribution =
              await tx.queueRewardDistribution.findUnique({
                where: { id: distributionId },
                include: {
                  beneficiaryPosition: {
                    select: { orderStateId: true },
                  },
                  allocation: {
                    select: { rewardAllocationId: true },
                  },
                },
              });
            if (
              !distribution ||
              distribution.status !== 'FROZEN' ||
              !distribution.releaseAt ||
              distribution.releaseAt > new Date()
            ) {
              return;
            }

            const orderIds = [
              ...new Set([
                distribution.sourceOrderId,
                distribution.beneficiaryPositionOrderId,
              ]),
            ];
            const [orders, afterSales, recipient] = await Promise.all([
              tx.order.findMany({
                where: { id: { in: orderIds } },
                select: {
                  id: true,
                  status: true,
                  returnWindowExpiresAt: true,
                },
              }),
              tx.afterSaleRequest.findMany({
                where: { orderId: { in: orderIds } },
                select: { orderId: true, status: true },
              }),
              tx.user.findUnique({
                where: { id: distribution.recipientUserId },
                select: {
                  status: true,
                  deletionExecutedAt: true,
                },
              }),
            ]);
            const successfulOrderIds = new Set(
              afterSales
                .filter((item) =>
                  (SUCCESS_STATUSES as readonly string[]).includes(
                    item.status,
                  ),
                )
                .map((item) => item.orderId),
            );
            if (successfulOrderIds.size > 0) {
              for (const orderId of successfulOrderIds) {
                await this.voidRewardsForOrderInTransaction(
                  tx,
                  orderId,
                  'AFTER_SALE_SUCCESS_DURING_RELEASE',
                );
              }
              return;
            }
            const hasActiveAfterSale = afterSales.some((item) =>
              (ACTIVE_STATUSES as readonly string[]).includes(
                item.status,
              ),
            );
            if (hasActiveAfterSale) {
              await this.deferDistribution(tx, distribution.id);
              return;
            }
            if (
              !recipient ||
              recipient.status !== 'ACTIVE' ||
              recipient.deletionExecutedAt
            ) {
              await this.voidPendingDistributionForInactiveRecipient(
                tx,
                distribution,
              );
              return;
            }

            const now = new Date();
            const bothWindowsClosed =
              orders.length === orderIds.length &&
              orders.every(
                (order) =>
                  order.status === 'RECEIVED' &&
                  order.returnWindowExpiresAt !== null &&
                  order.returnWindowExpiresAt <= now,
              );
            if (!bothWindowsClosed) {
              await this.deferDistribution(tx, distribution.id);
              return;
            }
            const account = await tx.rewardAccount.upsert({
              where: {
                userId_type: {
                  userId: distribution.recipientUserId,
                  type: 'QUEUE_REWARD',
                },
              },
              update: {},
              create: {
                userId: distribution.recipientUserId,
                type: 'QUEUE_REWARD',
              },
            });
            const ledger = await tx.rewardLedger.create({
              data: {
                allocationId:
                  distribution.allocation.rewardAllocationId,
                accountId: account.id,
                userId: distribution.recipientUserId,
                entryType: 'RELEASE',
                amount: distribution.amount,
                status: 'AVAILABLE',
                refType: 'ORDER',
                refId: distribution.sourceOrderId,
                idempotencyKey:
                  `QUEUE_REWARD_LEDGER:${distribution.id}`,
                meta: {
                  scheme: 'GLOBAL_QUEUE',
                  accountType: 'QUEUE_REWARD',
                  sourceOrderId: distribution.sourceOrderId,
                  sourcePositionId:
                    distribution.sourcePositionId,
                  beneficiaryPositionId:
                    distribution.beneficiaryPositionId,
                  beneficiaryPositionOrderId:
                    distribution.beneficiaryPositionOrderId,
                  queueRewardAllocationId:
                    distribution.allocationId,
                  releaseCondition:
                    'SOURCE_AND_BENEFICIARY_AFTER_SALE_WINDOWS_CLOSED',
                },
              },
            });
            const distributionCas =
              await tx.queueRewardDistribution.updateMany({
                where: {
                  id: distribution.id,
                  status: 'FROZEN',
                  rewardLedgerId: null,
                },
                data: {
                  status: 'AVAILABLE',
                  rewardLedgerId: ledger.id,
                  releasedAt: now,
                },
              });
            if (distributionCas.count === 0) {
              throw new Error(
                `队列红包 ${distribution.id} 释放状态发生冲突`,
              );
            }
            await tx.rewardAccount.update({
              where: { id: account.id },
              data: {
                balance: { increment: distribution.amount },
              },
            });
            const stateCas =
              await tx.queueRewardOrderState.updateMany({
                where: {
                  id: distribution.beneficiaryPosition.orderStateId,
                  frozenReceivedAmount: {
                    gte: distribution.amount,
                  },
                },
                data: {
                  frozenReceivedAmount: {
                    decrement: distribution.amount,
                  },
                  availableReceivedAmount: {
                    increment: distribution.amount,
                  },
                },
              });
            if (stateCas.count === 0) {
              throw new Error(
                `队列订单领取累计不一致，拒绝释放: distributionId=${distribution.id}`,
              );
            }
            await this.notificationService.emit(
              {
                eventType: 'queueReward.available',
                aggregateType: 'queueRewardDistribution',
                aggregateId: distribution.id,
                idempotencyKey:
                  `queueReward.available:${distribution.id}`,
                actor: { kind: 'system' },
                payload: {
                  userId: distribution.recipientUserId,
                  amount: distribution.amount,
                  distributionId: distribution.id,
                  ring: true,
                },
              },
              tx,
            );
          },
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable,
            timeout: 30_000,
          },
        );
        return;
      } catch (error: any) {
        if (
          error?.code === 'P2034' &&
          attempt < MAX_SERIALIZABLE_ATTEMPTS - 1
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  private async voidPendingDistributionForInactiveRecipient(
    tx: Tx,
    distribution: {
      id: string;
      sourceOrderId: string;
      beneficiaryPositionOrderId: string;
      recipientUserId: string;
      amount: number;
      status: string;
      beneficiaryPosition: { orderStateId: string };
    },
  ): Promise<void> {
    const cas = await tx.queueRewardDistribution.updateMany({
      where: {
        id: distribution.id,
        status: 'FROZEN',
        rewardLedgerId: null,
      },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidReason: 'RECIPIENT_INACTIVE_BEFORE_RELEASE',
        recoveredAmount: distribution.amount,
        platformReturnedAmount: distribution.amount,
        platformReturnRatio: {
          numerator: 1,
          denominator: 1,
        },
      },
    });
    if (cas.count === 0) return;

    const stateCas = await tx.queueRewardOrderState.updateMany({
      where: {
        id: distribution.beneficiaryPosition.orderStateId,
        frozenReceivedAmount: { gte: distribution.amount },
      },
      data: {
        frozenReceivedAmount: {
          decrement: distribution.amount,
        },
        voidedReceivedAmount: {
          increment: distribution.amount,
        },
      },
    });
    if (stateCas.count === 0) {
      throw new Error(
        `队列内部待结算累计不一致，拒绝作废: distributionId=${distribution.id}`,
      );
    }

    const platformAccount = await tx.rewardAccount.upsert({
      where: {
        userId_type: {
          userId: PLATFORM_USER_ID,
          type: 'PLATFORM_PROFIT',
        },
      },
      update: {},
      create: {
        userId: PLATFORM_USER_ID,
        type: 'PLATFORM_PROFIT',
      },
    });
    await tx.rewardLedger.create({
      data: {
        accountId: platformAccount.id,
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount: distribution.amount,
        status: 'AVAILABLE',
        refType: 'QUEUE_REWARD',
        refId: distribution.id,
        idempotencyKey:
          `QUEUE_REWARD_INACTIVE_VOID:${distribution.id}`,
        meta: {
          scheme: 'GLOBAL_QUEUE_INACTIVE_RECIPIENT_VOID',
          accountType: 'PLATFORM_PROFIT',
          sourceOrderId: distribution.sourceOrderId,
          beneficiaryPositionOrderId:
            distribution.beneficiaryPositionOrderId,
          originalRecipientUserId:
            distribution.recipientUserId,
          originalDistributionId: distribution.id,
          reason: 'RECIPIENT_INACTIVE_BEFORE_RELEASE',
        },
      },
    });
    await tx.rewardAccount.update({
      where: { id: platformAccount.id },
      data: {
        balance: { increment: distribution.amount },
      },
    });
  }

  private async acquireGlobalLock(tx: Tx): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${GLOBAL_QUEUE_LOCK}))
    `;
  }

  private async deferDistribution(
    tx: Tx,
    distributionId: string,
  ): Promise<void> {
    // 至少推到当前毫秒之后，避免恰好与本轮 sweepStartedAt 同毫秒时
    // 又被 `updatedAt <= sweepStartedAt` 立即选中形成忙循环。
    await tx.queueRewardDistribution.updateMany({
      where: {
        id: distributionId,
        status: 'FROZEN',
      },
      data: { updatedAt: new Date(Date.now() + 1) },
    });
  }

  private async deferFailedReleaseCandidate(
    distributionId: string,
    sweepStartedAt: Date,
  ): Promise<void> {
    try {
      await this.prisma.queueRewardDistribution.updateMany({
        where: {
          id: distributionId,
          status: 'FROZEN',
        },
        data: {
          updatedAt: new Date(
            Math.max(
              Date.now(),
              sweepStartedAt.getTime() + 1,
            ),
          ),
        },
      });
    } catch (touchError) {
      this.logger.error(
        `队列奖励释放失败候选延后失败: distributionId=${distributionId}, ` +
          `error=${String(
            touchError instanceof Error
              ? touchError.message
              : touchError,
          )}`,
      );
    }
  }

  private async advancePriorPositions(
    tx: Tx,
    positions: Array<{
      id: string;
      orderStateId: string;
      observedUnitCount: number;
      targetObservedUnitCount: number;
    }>,
  ): Promise<void> {
    const touchedStates = new Set<string>();
    for (const position of positions) {
      const nextCount = position.observedUnitCount + 1;
      const completed =
        nextCount >= position.targetObservedUnitCount;
      await tx.queueRewardPosition.update({
        where: { id: position.id },
        data: {
          observedUnitCount: Math.min(
            nextCount,
            position.targetObservedUnitCount,
          ),
          ...(completed
            ? {
                status: 'COMPLETED',
                completedAt: new Date(),
                exitReason: 'OBSERVED_TARGET_REACHED',
              }
            : {}),
        },
      });
      touchedStates.add(position.orderStateId);
    }
    for (const orderStateId of touchedStates) {
      const remaining = await tx.queueRewardPosition.count({
        where: {
          orderStateId,
          status: { in: ['ACTIVE', 'CAPPED'] },
        },
      });
      if (remaining === 0) {
        await tx.queueRewardOrderState.updateMany({
          where: {
            id: orderStateId,
            status: { not: 'VOIDED' },
          },
          data: { status: 'COMPLETED' },
        });
      }
    }
  }

  private async markCappedStates(
    tx: Tx,
    orderStateIds: Set<string>,
  ): Promise<void> {
    for (const orderStateId of orderStateIds) {
      const state = await tx.queueRewardOrderState.findUnique({
        where: { id: orderStateId },
      });
      if (!state || this.remainingCapCents(state) > 0) continue;
      await tx.queueRewardOrderState.updateMany({
        where: { id: orderStateId, status: 'ACTIVE' },
        data: { status: 'CAPPED' },
      });
      await tx.queueRewardPosition.updateMany({
        where: { orderStateId, status: 'ACTIVE' },
        data: {
          status: 'CAPPED',
          exitReason: 'SHARED_ORDER_CAP_REACHED',
        },
      });
    }
  }

  private resolveReleaseAt(
    sourceReleaseAt: Date | null,
    beneficiaryReleaseAt: Date | null,
  ): Date | null {
    if (!sourceReleaseAt || !beneficiaryReleaseAt) return null;
    return sourceReleaseAt > beneficiaryReleaseAt
      ? sourceReleaseAt
      : beneficiaryReleaseAt;
  }

  private remainingCapCents(state: {
    sharedCapAmount: number;
    frozenReceivedAmount: number;
    availableReceivedAmount: number;
  }): number {
    return Math.max(
      0,
      yuanToCents(state.sharedCapAmount) -
        yuanToCents(state.frozenReceivedAmount) -
        yuanToCents(state.availableReceivedAmount),
    );
  }

  private applySourcePlatformReturnRatio(
    amountCents: number,
    ratio:
      | QueueRewardVoidOptions['sourcePlatformReturnRatio']
      | undefined,
  ): number {
    if (!ratio) return amountCents;
    if (
      !Number.isSafeInteger(ratio.numerator) ||
      !Number.isSafeInteger(ratio.denominator) ||
      ratio.numerator < 0 ||
      ratio.denominator <= 0 ||
      ratio.numerator > ratio.denominator
    ) {
      throw new Error('invalid queue source platform return ratio');
    }
    return Number(
      (BigInt(amountCents) * BigInt(ratio.numerator)) /
        BigInt(ratio.denominator),
    );
  }

  private normalizePlatformReturnRatio(
    ratio:
      | QueueRewardVoidOptions['sourcePlatformReturnRatio']
      | undefined,
  ): { numerator: number; denominator: number } {
    if (!ratio) return { numerator: 1, denominator: 1 };
    // 复用整数和边界校验，0 元不会改变验证语义。
    this.applySourcePlatformReturnRatio(0, ratio);
    return {
      numerator: ratio.numerator,
      denominator: ratio.denominator,
    };
  }

  /**
   * 多次部分退款按累计剩余利润重算平台应保留的回流金额。
   * 首次作废已经写入 recoveredAmount；后续退款即使分配已 VOIDED，
   * 仍会以目标累计值减当前累计值产生幂等调整。
   */
  private async reconcileSourcePlatformReturn(
    tx: Tx,
    sourceOrderId: string,
    ratio:
      QueueRewardVoidOptions['sourcePlatformReturnRatio'],
    adjustmentId: string,
  ): Promise<void> {
    const normalizedRatio =
      this.normalizePlatformReturnRatio(ratio);
    const distributions =
      await tx.queueRewardDistribution.findMany({
        where: {
          sourceOrderId,
          status: 'VOIDED',
        },
        select: {
          id: true,
          recoveredAmount: true,
          platformReturnedAmount: true,
        },
        orderBy: { createdAt: 'asc' },
      });
    let platformAccount: { id: string } | null = null;

    for (const distribution of distributions) {
      const recoveredCents = yuanToCents(
        distribution.recoveredAmount,
      );
      const currentReturnedCents = yuanToCents(
        distribution.platformReturnedAmount,
      );
      const targetReturnedCents =
        this.applySourcePlatformReturnRatio(
          recoveredCents,
          normalizedRatio,
        );
      const deltaCents =
        targetReturnedCents - currentReturnedCents;

      const cas =
        await tx.queueRewardDistribution.updateMany({
          where: {
            id: distribution.id,
            platformReturnedAmount:
              distribution.platformReturnedAmount,
          },
          data: {
            platformReturnedAmount:
              centsToYuan(targetReturnedCents),
            platformReturnRatio: normalizedRatio,
          },
        });
      if (cas.count === 0) {
        throw new Error(
          `队列来源退款平台回流并发变化: distributionId=${distribution.id}`,
        );
      }
      if (deltaCents === 0) continue;

      platformAccount ??= await tx.rewardAccount.upsert({
        where: {
          userId_type: {
            userId: PLATFORM_USER_ID,
            type: 'PLATFORM_PROFIT',
          },
        },
        update: {},
        create: {
          userId: PLATFORM_USER_ID,
          type: 'PLATFORM_PROFIT',
        },
        select: { id: true },
      });
      const deltaAmount = centsToYuan(deltaCents);
      await tx.rewardLedger.create({
        data: {
          accountId: platformAccount.id,
          userId: PLATFORM_USER_ID,
          entryType:
            deltaCents > 0 ? 'RELEASE' : 'VOID',
          amount: deltaAmount,
          status:
            deltaCents > 0 ? 'AVAILABLE' : 'VOIDED',
          refType: 'AFTER_SALE',
          refId: sourceOrderId,
          idempotencyKey:
            `QUEUE_REWARD_SOURCE_RECONCILE:` +
            `${adjustmentId}:${distribution.id}`,
          meta: {
            scheme: 'GLOBAL_QUEUE_SOURCE_RECONCILE',
            accountType: 'PLATFORM_PROFIT',
            sourceOrderId,
            originalDistributionId: distribution.id,
            recoveredAmount:
              centsToYuan(recoveredCents),
            previousPlatformReturnedAmount:
              centsToYuan(currentReturnedCents),
            targetPlatformReturnedAmount:
              centsToYuan(targetReturnedCents),
            ratio: normalizedRatio,
            adjustmentId,
          },
        },
      });
      await tx.rewardAccount.update({
        where: { id: platformAccount.id },
        data: {
          balance: { increment: deltaAmount },
        },
      });
    }
  }

  private readSnapshot(ruleSnapshot: unknown): QueueRewardRuleSnapshot | null {
    if (!ruleSnapshot || typeof ruleSnapshot !== 'object') return null;
    const raw = (ruleSnapshot as Record<string, unknown>)
      .queueReward;
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const config: QueueRewardRuleSnapshot = {
      enabled: value.enabled === true,
      queueSize: Number(value.queueSize),
      rewardPercent: Number(value.rewardPercent),
      splitUnitAmount: Number(value.splitUnitAmount),
      maxPositionsPerOrder: Number(value.maxPositionsPerOrder),
      distributionMode:
        value.distributionMode === 'NORMAL_RANDOM'
          ? 'NORMAL_RANDOM'
          : 'AVERAGE',
      randomStddev: Number(value.randomStddev),
      randomMinFactor: Number(value.randomMinFactor),
      randomMaxFactor: Number(value.randomMaxFactor),
      activationAt:
        typeof value.activationAt === 'string'
          ? value.activationAt
          : '',
    };
    const valid =
      config.enabled &&
      Number.isInteger(config.queueSize) &&
      config.queueSize >= 2 &&
      config.queueSize <= 100 &&
      Number.isFinite(config.rewardPercent) &&
      config.rewardPercent >= 0.01 &&
      config.rewardPercent <= 1 &&
      Number.isFinite(config.splitUnitAmount) &&
      config.splitUnitAmount >= 0.01 &&
      config.splitUnitAmount <= 1_000_000 &&
      Number.isInteger(config.maxPositionsPerOrder) &&
      config.maxPositionsPerOrder >= 1 &&
      config.maxPositionsPerOrder <= 500 &&
      Number.isFinite(config.randomStddev) &&
      config.randomStddev >= 0 &&
      config.randomStddev <= 1 &&
      Number.isFinite(config.randomMinFactor) &&
      config.randomMinFactor > 0 &&
      config.randomMinFactor <= 10 &&
      Number.isFinite(config.randomMaxFactor) &&
      config.randomMaxFactor >= config.randomMinFactor &&
      config.randomMaxFactor <= 10 &&
      config.activationAt.length > 0 &&
      !Number.isNaN(Date.parse(config.activationAt));
    return valid ? config : null;
  }

  private unwrapConfigValue(value: unknown): unknown {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'value' in value
    ) {
      return (value as { value: unknown }).value;
    }
    return value;
  }

  private assertReceiptMoney(input: QueueRewardReceiptInput): void {
    for (const [label, value] of Object.entries({
      eligiblePaidCents: input.eligiblePaidCents,
      profitCents: input.profitCents,
      platformProfitCents: input.platformProfitCents,
    })) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
      }
    }
  }
}
