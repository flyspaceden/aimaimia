export interface ProfitRateBuckets {
  reward: number;
  directReferral: number;
  industryFund: number;
  charity: number;
  tech: number;
  reserve: number;
}

export interface ProfitCentBuckets extends ProfitRateBuckets {
  platform: number;
}

const BUCKET_ORDER: Array<keyof ProfitRateBuckets> = [
  'reward',
  'directReferral',
  'industryFund',
  'charity',
  'tech',
  'reserve',
];

export function allocateProfitRateBuckets(
  profitCents: number,
  rates: ProfitRateBuckets,
): ProfitCentBuckets {
  if (!Number.isSafeInteger(profitCents) || profitCents < 0) {
    throw new Error('profit cents must be a non-negative safe integer');
  }
  const entries = BUCKET_ORDER.map((key, index) => {
    const rate = rates[key];
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error(`${key} rate must be between 0 and 1`);
    }
    const exact = profitCents * rate;
    const floor = Math.floor(exact);
    return { key, index, rate, exact, floor, remainder: exact - floor };
  });
  const totalRate = entries.reduce((sum, entry) => sum + entry.rate, 0);
  const allocatedTarget = Math.round(profitCents * totalRate);
  if (
    !Number.isSafeInteger(allocatedTarget)
    || allocatedTarget < 0
    || allocatedTarget > profitCents
  ) {
    throw new Error('profit rate buckets exceed distributable profit');
  }

  let remaining = allocatedTarget - entries.reduce((sum, entry) => sum + entry.floor, 0);
  const byRemainder = [...entries]
    .filter((entry) => entry.rate > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    entry.floor += 1;
    remaining -= 1;
  }
  if (remaining !== 0) {
    throw new Error('profit rate bucket remainder mismatch');
  }

  const allocated = Object.fromEntries(
    entries.map((entry) => [entry.key, entry.floor]),
  ) as unknown as ProfitRateBuckets;
  return {
    platform: profitCents - allocatedTarget,
    ...allocated,
  };
}
