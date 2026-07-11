import {
  allocateCentsByLargestRemainder,
  checkedSafeIntegerSum,
  isNonNegativeIntegerCents,
} from './money-allocation';

export interface ProfitSourceAmount {
  id: string;
  amountCents: number;
}

export interface ProfitItemCapacity {
  id: string;
  capacityCents: number;
}

export function allocateProfitSourcesToItems(
  sources: ProfitSourceAmount[],
  items: ProfitItemCapacity[],
): Record<string, Record<string, number>> {
  const sortedSources = [...sources].sort((a, b) => a.id.localeCompare(b.id));
  const sortedItems = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const sourceIds = new Set<string>();
  const itemIds = new Set<string>();

  for (const source of sortedSources) {
    if (
      !source.id
      || sourceIds.has(source.id)
      || !isNonNegativeIntegerCents(source.amountCents)
    ) {
      throw new Error('profit sources must have unique ids and non-negative integer cents');
    }
    sourceIds.add(source.id);
  }
  for (const item of sortedItems) {
    if (
      !item.id
      || itemIds.has(item.id)
      || !isNonNegativeIntegerCents(item.capacityCents)
    ) {
      throw new Error('profit items must have unique ids and non-negative integer capacities');
    }
    itemIds.add(item.id);
  }

  const sourceTotal = checkedSafeIntegerSum(sortedSources.map((source) => source.amountCents));
  const itemTotal = checkedSafeIntegerSum(sortedItems.map((item) => item.capacityCents));
  if (sourceTotal === null || itemTotal === null || sourceTotal > itemTotal) {
    throw new Error('profit source totals exceed item capacities');
  }

  const remaining = new Map(sortedItems.map((item) => [item.id, item.capacityCents]));
  const matrix: Record<string, Record<string, number>> = {};
  for (const source of sortedSources) {
    matrix[source.id] = Object.fromEntries(sortedItems.map((item) => [item.id, 0]));
    if (source.amountCents === 0) continue;
    const allocation = allocateCentsByLargestRemainder(
      source.amountCents,
      sortedItems.map((item) => ({
        id: item.id,
        weightCents: remaining.get(item.id) ?? 0,
        capacityCents: remaining.get(item.id) ?? 0,
      })),
    );
    if (allocation.unallocatedCents !== 0) {
      throw new Error(`profit source ${source.id} cannot fit remaining item capacities`);
    }
    for (const item of sortedItems) {
      const cents = allocation.allocations[item.id] ?? 0;
      matrix[source.id][item.id] = cents;
      remaining.set(item.id, (remaining.get(item.id) ?? 0) - cents);
    }
  }
  return matrix;
}

export function allocatePairedProfitSourcesToItems(
  positiveSources: ProfitSourceAmount[],
  holdSources: ProfitSourceAmount[],
  items: ProfitItemCapacity[],
  options: { allowUnmatchedHold?: boolean } = {},
): {
  positive: Record<string, Record<string, number>>;
  hold: Record<string, Record<string, number>>;
  itemNetCents: Record<string, number>;
} {
  const positiveTotal = checkedSafeIntegerSum(
    positiveSources.map((source) => source.amountCents),
  );
  const holdTotal = checkedSafeIntegerSum(
    holdSources.map((source) => source.amountCents),
  );
  if (
    positiveTotal === null
    || holdTotal === null
    || (options.allowUnmatchedHold ? positiveTotal > holdTotal : positiveTotal !== holdTotal)
  ) {
    throw new Error('paired positive and hold source totals must match');
  }
  if (options.allowUnmatchedHold) {
    const hold = allocateProfitSourcesToItems(holdSources, items);
    const heldCapacities = items.map((item) => ({
      id: item.id,
      capacityCents: holdSources.reduce(
        (sum, source) => sum + (hold[source.id]?.[item.id] ?? 0),
        0,
      ),
    }));
    const positive = allocateProfitSourcesToItems(positiveSources, heldCapacities);
    const itemNetCents = Object.fromEntries(items.map((item) => {
      const positiveCents = positiveSources.reduce(
        (sum, source) => sum + (positive[source.id]?.[item.id] ?? 0),
        0,
      );
      const holdCents = heldCapacities.find((capacity) => capacity.id === item.id)?.capacityCents ?? 0;
      const net = positiveCents - holdCents;
      if (net > 0) throw new Error(`paired source item ${item.id} exceeds its hold`);
      return [item.id, net];
    }));
    return { positive, hold, itemNetCents };
  }
  const positive = allocateProfitSourcesToItems(positiveSources, items);
  const matchedCapacities = items.map((item) => ({
    id: item.id,
    capacityCents: positiveSources.reduce(
      (sum, source) => sum + (positive[source.id]?.[item.id] ?? 0),
      0,
    ),
  }));
  const hold = allocateProfitSourcesToItems(holdSources, matchedCapacities);
  const itemNetCents = Object.fromEntries(items.map((item) => {
    const positiveCents = positiveSources.reduce(
      (sum, source) => sum + (positive[source.id]?.[item.id] ?? 0),
      0,
    );
    const holdCents = holdSources.reduce(
      (sum, source) => sum + (hold[source.id]?.[item.id] ?? 0),
      0,
    );
    const net = positiveCents - holdCents;
    if (net !== 0) throw new Error(`paired source item ${item.id} does not net to zero`);
    return [item.id, net];
  }));
  return { positive, hold, itemNetCents };
}
