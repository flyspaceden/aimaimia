export type TierBasisPointValue = {
  sequence: number;
  basisPoints: number;
  label?: string | null;
};

export type TierPercentValue = {
  sequence: number;
  percent: number;
  label?: string | null;
};

export function basisPointsToPercent(basisPoints: number): number {
  return Number((Number(basisPoints || 0) / 100).toFixed(2));
}

export function percentToBasisPoints(percent: number): number {
  return Math.round(Number(percent || 0) * 100);
}

export function toTierFormValues(tiers: TierBasisPointValue[]): TierPercentValue[] {
  return tiers.map((tier) => ({
    sequence: Number(tier.sequence),
    percent: basisPointsToPercent(tier.basisPoints),
    label: tier.label ?? null,
  }));
}

export function toTierPayloadValues(tiers: TierPercentValue[]): TierBasisPointValue[] {
  return tiers.map((tier) => ({
    sequence: Number(tier.sequence),
    basisPoints: percentToBasisPoints(tier.percent),
    label: tier.label || null,
  }));
}
