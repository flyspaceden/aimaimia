import { QueueRewardCalculator } from '../src/modules/bonus/engine/queue-reward-calculator';

export interface QueueRewardDemoOrder {
  orderId: string;
  userId: string;
  merchantId: string;
  identity: 'NORMAL' | 'VIP';
  eligiblePaidCents: number;
  profitCents: number;
}

interface DemoPosition {
  id: string;
  orderId: string;
  userId: string;
  sequence: number;
  observedUnitCount: number;
  targetObservedUnitCount: number;
  status: 'ACTIVE' | 'CAPPED' | 'COMPLETED';
}

interface DemoOrderState {
  eligiblePaidCents: number;
  pendingReceivedCents: number;
}

export interface QueueRewardDemoDistribution {
  sourceOrderId: string;
  sourceUserId: string;
  sourceMerchantId: string;
  beneficiaryOrderId: string;
  beneficiaryUserId: string;
  beneficiaryPositionId: string;
  amountCents: number;
}

export interface QueueRewardDemoStep {
  sequence: number;
  sourceOrderId: string;
  sourceUserId: string;
  sourceMerchantId: string;
  sourceIdentity: 'NORMAL' | 'VIP';
  priorWindowSize: number;
  rewardPoolCents: number;
  distributedCents: number;
  platformRetainedCents: number;
  completedPositionIds: string[];
}

export interface QueueRewardDemoReport {
  config: {
    queueSize: number;
    rewardPercent: number;
    splitUnitCents: number;
    maxPositionsPerOrder: number;
  };
  orders: QueueRewardDemoOrder[];
  steps: QueueRewardDemoStep[];
  distributions: QueueRewardDemoDistribution[];
  totals: {
    nominalRewardPoolCents: number;
    distributedCents: number;
    platformRetainedCents: number;
    pendingWalletCentsBeforeRelease: number;
    availableWalletCentsBeforeRelease: number;
    availableWalletCentsAfterRelease: number;
    notificationCountAfterRelease: number;
    firstPositionBellCount: number;
    sameUserHistoricalRewardCount: number;
    crossMerchantRewardCount: number;
  };
}

const DEMO_QUEUE_SIZE = 21;
const DEMO_REWARD_PERCENT = 0.01;
const DEMO_SPLIT_UNIT_CENTS = 20_000;
const DEMO_MAX_POSITIONS_PER_ORDER = 100;

export function buildGlobalQueueRewardDemoOrders(): QueueRewardDemoOrder[] {
  const merchants = ['商户A', '商户B', '商户C'];
  return Array.from({ length: 22 }, (_, index) => ({
    orderId: `订单${String(index + 1).padStart(2, '0')}`,
    // 8 个用户循环购买，明确覆盖“新订单奖励自己的历史位置”。
    userId: `用户${String((index % 8) + 1).padStart(2, '0')}`,
    merchantId: merchants[index % merchants.length],
    identity: index % 4 === 0 ? 'VIP' : 'NORMAL',
    eligiblePaidCents: 20_000,
    // 每单利润 ¥60，1% 队列预算为 ¥0.60。
    profitCents: 6_000,
  }));
}

export function runGlobalQueueRewardDemo(
  orders: QueueRewardDemoOrder[] = buildGlobalQueueRewardDemoOrders(),
): QueueRewardDemoReport {
  const calculator = new QueueRewardCalculator();
  const positions: DemoPosition[] = [];
  const orderStates = new Map<string, DemoOrderState>();
  const steps: QueueRewardDemoStep[] = [];
  const distributions: QueueRewardDemoDistribution[] = [];

  for (const order of orders) {
    const unitBudgets = calculator.splitIntoUnitBudgets({
      eligiblePaidCents: order.eligiblePaidCents,
      profitCents: order.profitCents,
      rewardPoolCents: Math.floor(
        order.profitCents * DEMO_REWARD_PERCENT + 1e-9,
      ),
      splitUnitCents: DEMO_SPLIT_UNIT_CENTS,
      maxUnitCount: DEMO_MAX_POSITIONS_PER_ORDER,
    });
    orderStates.set(order.orderId, {
      eligiblePaidCents: order.eligiblePaidCents,
      pendingReceivedCents: 0,
    });

    for (const unit of unitBudgets) {
      const priorPositions = positions
        .filter(
          (position) =>
            position.orderId !== order.orderId &&
            (position.status === 'ACTIVE' ||
              position.status === 'CAPPED'),
        )
        .slice(0, DEMO_QUEUE_SIZE - 1);
      const sourcePosition: DemoPosition = {
        id: `位置${String(positions.length + 1).padStart(2, '0')}`,
        orderId: order.orderId,
        userId: order.userId,
        sequence: positions.length + 1,
        observedUnitCount: 0,
        targetObservedUnitCount: DEMO_QUEUE_SIZE - 1,
        status: 'ACTIVE',
      };
      positions.push(sourcePosition);

      const recipients = priorPositions
        .filter((position) => position.status === 'ACTIVE')
        .map((position) => {
          const state = orderStates.get(position.orderId);
          if (!state) {
            throw new Error(`演示订单状态缺失: ${position.orderId}`);
          }
          return {
            positionId: position.id,
            capGroupId: position.orderId,
            remainingCapCents: Math.max(
              0,
              state.eligiblePaidCents - state.pendingReceivedCents,
            ),
          };
        });
      const result = calculator.distribute({
        rewardPoolCents: unit.rewardPoolCents,
        recipients,
        mode: 'AVERAGE',
        randomSeed: `${order.orderId}:${unit.unitIndex}:demo-v1`,
        rotationOffset:
          recipients.length === 0
            ? 0
            : sourcePosition.sequence % recipients.length,
      });

      for (const item of result.items) {
        const beneficiary = priorPositions.find(
          (position) => position.id === item.positionId,
        );
        if (!beneficiary) {
          throw new Error(`演示受益位置缺失: ${item.positionId}`);
        }
        const state = orderStates.get(beneficiary.orderId);
        if (!state) {
          throw new Error(`演示受益订单状态缺失: ${beneficiary.orderId}`);
        }
        state.pendingReceivedCents += item.amountCents;
        distributions.push({
          sourceOrderId: order.orderId,
          sourceUserId: order.userId,
          sourceMerchantId: order.merchantId,
          beneficiaryOrderId: beneficiary.orderId,
          beneficiaryUserId: beneficiary.userId,
          beneficiaryPositionId: beneficiary.id,
          amountCents: item.amountCents,
        });
      }

      const completedPositionIds: string[] = [];
      for (const position of priorPositions) {
        position.observedUnitCount = Math.min(
          position.targetObservedUnitCount,
          position.observedUnitCount + 1,
        );
        if (
          position.observedUnitCount >=
          position.targetObservedUnitCount
        ) {
          position.status = 'COMPLETED';
          completedPositionIds.push(position.id);
        }
      }
      steps.push({
        sequence: sourcePosition.sequence,
        sourceOrderId: order.orderId,
        sourceUserId: order.userId,
        sourceMerchantId: order.merchantId,
        sourceIdentity: order.identity,
        priorWindowSize: priorPositions.length,
        rewardPoolCents: unit.rewardPoolCents,
        distributedCents: result.distributedCents,
        platformRetainedCents: result.platformRetainedCents,
        completedPositionIds,
      });
    }
  }

  const nominalRewardPoolCents = steps.reduce(
    (sum, step) => sum + step.rewardPoolCents,
    0,
  );
  const distributedCents = steps.reduce(
    (sum, step) => sum + step.distributedCents,
    0,
  );
  const platformRetainedCents = steps.reduce(
    (sum, step) => sum + step.platformRetainedCents,
    0,
  );

  return {
    config: {
      queueSize: DEMO_QUEUE_SIZE,
      rewardPercent: DEMO_REWARD_PERCENT,
      splitUnitCents: DEMO_SPLIT_UNIT_CENTS,
      maxPositionsPerOrder: DEMO_MAX_POSITIONS_PER_ORDER,
    },
    orders,
    steps,
    distributions,
    totals: {
      nominalRewardPoolCents,
      distributedCents,
      platformRetainedCents,
      // 确认收货后只是内部待结算，不进入钱包。
      pendingWalletCentsBeforeRelease: distributedCents,
      availableWalletCentsBeforeRelease: 0,
      // 演示假定来源与受益订单都已过售后期且无成功售后。
      availableWalletCentsAfterRelease: distributedCents,
      notificationCountAfterRelease: distributions.length,
      firstPositionBellCount: distributions.filter(
        (item) => item.beneficiaryPositionId === '位置01',
      ).length,
      sameUserHistoricalRewardCount: distributions.filter(
        (item) => item.sourceUserId === item.beneficiaryUserId,
      ).length,
      crossMerchantRewardCount: distributions.filter((item) => {
        const beneficiaryOrder = orders.find(
          (order) => order.orderId === item.beneficiaryOrderId,
        );
        return (
          beneficiaryOrder !== undefined &&
          beneficiaryOrder.merchantId !== item.sourceMerchantId
        );
      }).length,
    },
  };
}

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function formatGlobalQueueRewardDemo(
  report: QueueRewardDemoReport,
): string {
  const lines = [
    '全平台订单队列奖励：21→22 人只读虚拟演示',
    '说明：使用真实 QueueRewardCalculator；不连接、不迁移、不写入任何数据库。',
    '',
    '序号 | 来源订单 | 用户/身份 | 商户 | 前序窗口 | 本单预算 | 实际分配 | 出队位置',
    '---|---|---|---|---:|---:|---:|---',
    ...report.steps.map((step) =>
      [
        step.sequence,
        step.sourceOrderId,
        `${step.sourceUserId}/${step.sourceIdentity}`,
        step.sourceMerchantId,
        step.priorWindowSize,
        yuan(step.rewardPoolCents),
        yuan(step.distributedCents),
        step.completedPositionIds.join('、') || '-',
      ].join(' | '),
    ),
    '',
    `名义队列预算：${yuan(report.totals.nominalRewardPoolCents)}`,
    `实际进入内部待结算：${yuan(report.totals.distributedCents)}`,
    `暖场等原因留归平台：${yuan(report.totals.platformRetainedCents)}`,
    `售后期结束前可提现：${yuan(report.totals.availableWalletCentsBeforeRelease)}`,
    `双边售后检查通过后可提现：${yuan(report.totals.availableWalletCentsAfterRelease)}`,
    `到账消息/响铃总数：${report.totals.notificationCountAfterRelease}`,
    `位置01收到的逐笔响铃：${report.totals.firstPositionBellCount}`,
    `同一用户奖励自己历史位置：${report.totals.sameUserHistoricalRewardCount} 笔`,
    `跨商户奖励：${report.totals.crossMerchantRewardCount} 笔`,
  ];
  return lines.join('\n');
}

if (require.main === module) {
  const report = runGlobalQueueRewardDemo();
  process.stdout.write(`${formatGlobalQueueRewardDemo(report)}\n`);
}
