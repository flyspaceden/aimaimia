export type QueueRewardDistributionMode = 'AVERAGE' | 'NORMAL_RANDOM';

export interface QueueRewardRandomConfig {
  stddev: number;
  minFactor: number;
  maxFactor: number;
}

export interface QueueRewardUnitBudget {
  unitIndex: number;
  profitCents: number;
  rewardPoolCents: number;
}

export interface QueueRewardRecipient {
  positionId: string;
  capGroupId: string;
  remainingCapCents: number;
}

export interface QueueRewardDistributionItem {
  positionId: string;
  capGroupId: string;
  amountCents: number;
  preClampWeight: number;
  clampedWeight: number;
  normalizedWeight: number;
}

export interface QueueRewardDistributionResult {
  items: QueueRewardDistributionItem[];
  distributedCents: number;
  platformRetainedCents: number;
  tailRecipientPositionIds: string[];
  randomSeed: string;
}

interface WeightedEntry {
  id: string;
  weight: number;
  originalIndex: number;
}

interface GeneratedWeight {
  preClamp: number;
  clamped: number;
}

interface ApportionResult {
  amounts: Map<string, number>;
  tailRecipientIds: string[];
}

interface CapGroupAllocationResult {
  amounts: Map<string, number>;
  tailGroupIds: string[];
}

interface CapGroup {
  id: string;
  capacityCents: number;
  weight: number;
  recipients: Array<
    WeightedEntry & {
      capGroupId: string;
      preClampWeight: number;
    }
  >;
}

/**
 * 全平台队列奖励纯计算器。
 *
 * 所有公开方法只接收整数分，避免 Float 尾差进入资金分配。
 * 数据库写入前由调用方把分再转换为元。
 */
export class QueueRewardCalculator {
  calculateUnitCount(
    eligiblePaidCents: number,
    splitUnitCents: number,
    maxUnitCount: number,
  ): number {
    this.assertNonNegativeInteger(eligiblePaidCents, 'eligiblePaidCents');
    this.assertPositiveInteger(splitUnitCents, 'splitUnitCents');
    this.assertPositiveInteger(maxUnitCount, 'maxUnitCount');
    return Math.min(
      maxUnitCount,
      Math.max(1, Math.floor(eligiblePaidCents / splitUnitCents)),
    );
  }

  splitIntoUnitBudgets(input: {
    eligiblePaidCents: number;
    profitCents: number;
    rewardPoolCents: number;
    splitUnitCents: number;
    maxUnitCount: number;
  }): QueueRewardUnitBudget[] {
    this.assertNonNegativeInteger(input.eligiblePaidCents, 'eligiblePaidCents');
    this.assertNonNegativeInteger(input.profitCents, 'profitCents');
    this.assertNonNegativeInteger(input.rewardPoolCents, 'rewardPoolCents');
    const unitCount = this.calculateUnitCount(
      input.eligiblePaidCents,
      input.splitUnitCents,
      input.maxUnitCount,
    );
    const profitParts = this.splitEvenly(input.profitCents, unitCount);
    const rewardParts = this.splitEvenly(input.rewardPoolCents, unitCount);

    return Array.from({ length: unitCount }, (_, unitIndex) => ({
      unitIndex,
      profitCents: profitParts[unitIndex],
      rewardPoolCents: rewardParts[unitIndex],
    }));
  }

  distribute(input: {
    rewardPoolCents: number;
    recipients: QueueRewardRecipient[];
    mode: QueueRewardDistributionMode;
    randomSeed: string;
    randomConfig?: QueueRewardRandomConfig;
    rotationOffset?: number;
  }): QueueRewardDistributionResult {
    this.assertNonNegativeInteger(input.rewardPoolCents, 'rewardPoolCents');
    if (!input.randomSeed) {
      throw new Error('randomSeed 不能为空');
    }

    if (input.rewardPoolCents === 0) {
      return this.emptyDistribution(input.rewardPoolCents, input.randomSeed);
    }

    const eligible = input.recipients.filter((recipient) => {
      this.assertNonNegativeInteger(
        recipient.remainingCapCents,
        `remainingCapCents:${recipient.positionId}`,
      );
      return recipient.remainingCapCents > 0;
    });

    if (eligible.length === 0) {
      return this.emptyDistribution(input.rewardPoolCents, input.randomSeed);
    }

    const weights = this.createWeights(
      eligible.length,
      input.mode,
      input.randomSeed,
      input.randomConfig,
    );
    const groups = this.buildCapGroups(eligible, weights);
    const totalCapacityCents = groups.reduce(
      (sum, group) => sum + group.capacityCents,
      0,
    );
    const distributableCents = Math.min(
      input.rewardPoolCents,
      totalCapacityCents,
    );

    if (distributableCents === 0) {
      return this.emptyDistribution(input.rewardPoolCents, input.randomSeed);
    }

    const rotationOffset = this.normalizeRotation(
      input.rotationOffset ?? 0,
      eligible.length,
    );
    const groupAllocation = this.allocateAcrossCapGroups(
      distributableCents,
      groups,
      rotationOffset,
    );
    const totalWeight = weights.reduce(
      (sum, weight) => sum + weight.clamped,
      0,
    );
    const items: QueueRewardDistributionItem[] = [];
    const tailRecipientPositionIds: string[] = [];

    for (const group of groups) {
      const groupAmount = groupAllocation.amounts.get(group.id) ?? 0;
      if (groupAmount <= 0) continue;

      const withinGroup = this.apportionByWeight(
        groupAmount,
        group.recipients,
        rotationOffset,
      );
      tailRecipientPositionIds.push(...withinGroup.tailRecipientIds);
      if (groupAllocation.tailGroupIds.includes(group.id)) {
        const withoutGroupTail = this.apportionByWeight(
          groupAmount - 1,
          group.recipients,
          rotationOffset,
        );
        for (const recipient of group.recipients) {
          const withTail = withinGroup.amounts.get(recipient.id) ?? 0;
          const withoutTail =
            withoutGroupTail.amounts.get(recipient.id) ?? 0;
          if (withTail > withoutTail) {
            tailRecipientPositionIds.push(recipient.id);
          }
        }
      }
      for (const recipient of group.recipients) {
        const amountCents = withinGroup.amounts.get(recipient.id) ?? 0;
        if (amountCents <= 0) continue;
        items.push({
          positionId: recipient.id,
          capGroupId: recipient.capGroupId,
          amountCents,
          preClampWeight: recipient.preClampWeight,
          clampedWeight: recipient.weight,
          normalizedWeight: recipient.weight / totalWeight,
        });
      }
    }

    const distributedCents = items.reduce(
      (sum, item) => sum + item.amountCents,
      0,
    );
    return {
      items,
      distributedCents,
      platformRetainedCents: input.rewardPoolCents - distributedCents,
      tailRecipientPositionIds: Array.from(
        new Set(tailRecipientPositionIds),
      ),
      randomSeed: input.randomSeed,
    };
  }

  private buildCapGroups(
    recipients: QueueRewardRecipient[],
    weights: GeneratedWeight[],
  ): CapGroup[] {
    const groups = new Map<string, CapGroup>();

    recipients.forEach((recipient, index) => {
      const existing = groups.get(recipient.capGroupId);
      if (
        existing &&
        existing.capacityCents !== recipient.remainingCapCents
      ) {
        throw new Error(
          `共享封顶组 ${recipient.capGroupId} 的剩余额度不一致`,
        );
      }

      const entry = {
        id: recipient.positionId,
        capGroupId: recipient.capGroupId,
        preClampWeight: weights[index].preClamp,
        weight: weights[index].clamped,
        originalIndex: index,
      };
      if (existing) {
        existing.weight += entry.weight;
        existing.recipients.push(entry);
      } else {
        groups.set(recipient.capGroupId, {
          id: recipient.capGroupId,
          capacityCents: recipient.remainingCapCents,
          weight: entry.weight,
          recipients: [entry],
        });
      }
    });

    return Array.from(groups.values());
  }

  private allocateAcrossCapGroups(
    totalCents: number,
    groups: CapGroup[],
    rotationOffset: number,
  ): CapGroupAllocationResult {
    const result = new Map<string, number>();
    const tailGroupIds: string[] = [];
    let remainingCents = totalCents;
    let active = groups.map((group, originalIndex) => ({
      ...group,
      originalIndex,
    }));

    while (remainingCents > 0 && active.length > 0) {
      const totalWeight = active.reduce((sum, group) => sum + group.weight, 0);
      const capped = active.filter(
        (group) =>
          (remainingCents * group.weight) / totalWeight >=
          group.capacityCents,
      );

      if (capped.length === 0) {
        const apportioned = this.apportionByWeight(
          remainingCents,
          active.map((group) => ({
            id: group.id,
            weight: group.weight,
            originalIndex: group.originalIndex,
          })),
          rotationOffset,
        );
        for (const [groupId, amount] of apportioned.amounts) {
          result.set(groupId, (result.get(groupId) ?? 0) + amount);
        }
        tailGroupIds.push(...apportioned.tailRecipientIds);
        remainingCents = 0;
        break;
      }

      const cappedIds = new Set(capped.map((group) => group.id));
      for (const group of capped) {
        result.set(
          group.id,
          (result.get(group.id) ?? 0) + group.capacityCents,
        );
        remainingCents -= group.capacityCents;
      }
      active = active.filter((group) => !cappedIds.has(group.id));
    }

    return {
      amounts: result,
      tailGroupIds,
    };
  }

  private apportionByWeight(
    totalCents: number,
    entries: WeightedEntry[],
    rotationOffset: number,
  ): ApportionResult {
    const result = new Map<string, number>();
    const tailRecipientIds: string[] = [];
    if (totalCents <= 0 || entries.length === 0) {
      return { amounts: result, tailRecipientIds };
    }

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    const fractional = entries.map((entry) => {
      const exact = (totalCents * entry.weight) / totalWeight;
      const floor = Math.floor(exact);
      result.set(entry.id, floor);
      return {
        ...entry,
        remainder: exact - floor,
      };
    });
    let assigned = Array.from(result.values()).reduce(
      (sum, amount) => sum + amount,
      0,
    );

    fractional.sort((a, b) => {
      if (Math.abs(b.remainder - a.remainder) > Number.EPSILON) {
        return b.remainder - a.remainder;
      }
      const aRotated = this.rotatedRank(
        a.originalIndex,
        rotationOffset,
        entries.length,
      );
      const bRotated = this.rotatedRank(
        b.originalIndex,
        rotationOffset,
        entries.length,
      );
      if (aRotated !== bRotated) return aRotated - bRotated;
      return a.id.localeCompare(b.id);
    });

    let cursor = 0;
    while (assigned < totalCents) {
      const entry = fractional[cursor % fractional.length];
      result.set(entry.id, (result.get(entry.id) ?? 0) + 1);
      tailRecipientIds.push(entry.id);
      assigned += 1;
      cursor += 1;
    }

    return { amounts: result, tailRecipientIds };
  }

  private createWeights(
    count: number,
    mode: QueueRewardDistributionMode,
    seed: string,
    config?: QueueRewardRandomConfig,
  ): GeneratedWeight[] {
    if (mode === 'AVERAGE') {
      return Array.from({ length: count }, () => ({
        preClamp: 1,
        clamped: 1,
      }));
    }
    if (mode !== 'NORMAL_RANDOM') {
      throw new Error(`不支持的队列分配模式: ${mode}`);
    }

    const effectiveConfig = config ?? {
      stddev: 0.25,
      minFactor: 0.5,
      maxFactor: 1.5,
    };
    if (
      !Number.isFinite(effectiveConfig.stddev) ||
      !Number.isFinite(effectiveConfig.minFactor) ||
      !Number.isFinite(effectiveConfig.maxFactor) ||
      effectiveConfig.stddev < 0 ||
      effectiveConfig.minFactor <= 0 ||
      effectiveConfig.maxFactor < effectiveConfig.minFactor
    ) {
      throw new Error('正态随机参数不合法');
    }

    const random = this.createSeededRandom(seed);
    return Array.from({ length: count }, () => {
      const u1 = Math.max(random(), Number.EPSILON);
      const u2 = Math.max(random(), Number.EPSILON);
      const standardNormal =
        Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const raw = 1 + standardNormal * effectiveConfig.stddev;
      return {
        preClamp: raw,
        clamped: Math.min(
          effectiveConfig.maxFactor,
          Math.max(effectiveConfig.minFactor, raw),
        ),
      };
    });
  }

  private createSeededRandom(seed: string): () => number {
    let state = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      state ^= seed.charCodeAt(index);
      state = Math.imul(state, 16777619);
    }
    state >>>= 0;

    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  private splitEvenly(totalCents: number, count: number): number[] {
    const base = Math.floor(totalCents / count);
    const remainder = totalCents - base * count;
    return Array.from(
      { length: count },
      (_, index) => base + (index >= count - remainder ? 1 : 0),
    );
  }

  private emptyDistribution(
    rewardPoolCents: number,
    randomSeed: string,
  ): QueueRewardDistributionResult {
    return {
      items: [],
      distributedCents: 0,
      platformRetainedCents: rewardPoolCents,
      tailRecipientPositionIds: [],
      randomSeed,
    };
  }

  private rotatedRank(
    originalIndex: number,
    rotationOffset: number,
    length: number,
  ): number {
    return (originalIndex - rotationOffset + length) % length;
  }

  private normalizeRotation(rotationOffset: number, length: number): number {
    if (!Number.isInteger(rotationOffset)) {
      throw new Error('rotationOffset 必须是整数');
    }
    return ((rotationOffset % length) + length) % length;
  }

  private assertPositiveInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${field} 必须是正整数分`);
    }
  }

  private assertNonNegativeInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${field} 必须是非负整数分`);
    }
  }
}
