export interface MoneyAllocationTarget {
  id: string;
  weightCents: number;
  capacityCents: number;
}

export interface MoneyAllocationResult {
  allocations: Record<string, number>;
  unallocatedCents: number;
}

export const yuanToCents = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error('yuan value must be finite');
  }
  const sign = value < 0 ? -1n : 1n;
  const [whole, fraction = ''] = Math.abs(value).toFixed(10).split('.');
  const paddedFraction = `${fraction}000`;
  let cents = BigInt(whole) * 100n + BigInt(paddedFraction.slice(0, 2));
  if (paddedFraction[2] >= '5') cents += 1n;
  cents *= sign;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (cents > max || cents < -max) {
    throw new Error('yuan value exceeds the safe cent range');
  }
  return Number(cents);
};

export const centsToYuan = (value: number): number => {
  if (!Number.isSafeInteger(value)) {
    throw new Error('cent value must be a safe integer');
  }
  return value / 100;
};

export const isNonNegativeIntegerCents = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export function checkedSafeIntegerSum(values: number[]): number | null {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) return null;
    total += BigInt(value);
    if (total > max || total < -max) return null;
  }
  return Number(total);
}

export function allocateCentsByLargestRemainder(
  totalCents: number,
  targets: MoneyAllocationTarget[],
): MoneyAllocationResult {
  if (!isNonNegativeIntegerCents(totalCents)) {
    throw new Error('totalCents must be a non-negative safe integer');
  }

  const sortedTargets = [...targets].sort((a, b) => a.id.localeCompare(b.id));
  const seenIds = new Set<string>();
  for (const target of sortedTargets) {
    if (
      !target.id
      || seenIds.has(target.id)
      || !isNonNegativeIntegerCents(target.weightCents)
      || !isNonNegativeIntegerCents(target.capacityCents)
    ) {
      throw new Error('allocation targets must have unique ids and integer amounts');
    }
    seenIds.add(target.id);
  }

  const allocations = Object.fromEntries(
    sortedTargets.map((target) => [target.id, 0]),
  ) as Record<string, number>;
  const capacityTotal = checkedSafeIntegerSum(
    sortedTargets.map((target) => target.capacityCents),
  );
  if (capacityTotal === null) {
    throw new Error('allocation capacity exceeds the safe integer range');
  }

  const allocatableCents = Math.min(totalCents, capacityTotal);
  let remainingCents = allocatableCents;

  while (remainingCents > 0) {
    const activeTargets = sortedTargets.filter(
      (target) =>
        target.weightCents > 0
        && allocations[target.id] < target.capacityCents,
    );
    if (activeTargets.length === 0) break;

    const totalWeight = activeTargets.reduce(
      (sum, target) => sum + BigInt(target.weightCents),
      0n,
    );
    if (totalWeight <= 0n) break;

    const remainders: Array<{ id: string; remainder: bigint }> = [];
    let allocatedThisRound = 0;

    for (const target of activeTargets) {
      const room = target.capacityCents - allocations[target.id];
      const numerator = BigInt(remainingCents) * BigInt(target.weightCents);
      const floorShare = Number(numerator / totalWeight);
      const share = Math.min(room, floorShare);

      allocations[target.id] += share;
      allocatedThisRound += share;
      if (share < room) {
        remainders.push({ id: target.id, remainder: numerator % totalWeight });
      }
    }

    remainingCents -= allocatedThisRound;
    if (remainingCents <= 0) break;

    remainders.sort((a, b) => {
      if (a.remainder > b.remainder) return -1;
      if (a.remainder < b.remainder) return 1;
      return a.id.localeCompare(b.id);
    });

    let allocatedRemainders = 0;
    for (const candidate of remainders) {
      if (remainingCents <= 0) break;
      const target = sortedTargets.find((entry) => entry.id === candidate.id);
      if (!target || allocations[candidate.id] >= target.capacityCents) continue;

      allocations[candidate.id] += 1;
      remainingCents -= 1;
      allocatedRemainders += 1;
    }

    if (allocatedThisRound === 0 && allocatedRemainders === 0) break;
  }

  return {
    allocations,
    unallocatedCents: totalCents - allocatableCents + remainingCents,
  };
}
