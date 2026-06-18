import { CreditAssetTier } from './digital-asset-v2.types';

type CreditAssetSegment = {
  from: number;
  to: number;
  spendAmount: number;
  multiplier: number;
  rawAssetAmount: number;
};

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label}必须是有限数字`);
  }
  return value;
}

export function validateCreditTiers(tiers: CreditAssetTier[]): CreditAssetTier[] {
  if (tiers.length === 0) {
    throw new Error('消费资产倍率档位不能为空');
  }

  const sorted = [...tiers].sort((a, b) => a.minAmount - b.minAmount);

  sorted.forEach((tier, index) => {
    assertFiniteNumber(tier.minAmount, `第${index + 1}个档位minAmount`);
    assertFiniteNumber(tier.multiplier, `第${index + 1}个档位multiplier`);
    if (tier.maxAmount !== null) {
      assertFiniteNumber(tier.maxAmount, `第${index + 1}个档位maxAmount`);
      if (tier.maxAmount <= tier.minAmount) {
        throw new Error('消费资产倍率档位上限必须大于下限');
      }
    }
    if (tier.multiplier <= 0) {
      throw new Error('消费资产倍率必须大于0');
    }
  });

  if (sorted[0].minAmount !== 0) {
    throw new Error('消费资产倍率首档必须从0开始');
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];

    if (current.maxAmount === null) {
      throw new Error('只有最后一个消费资产倍率档位可以无上限');
    }

    if (current.maxAmount !== next.minAmount) {
      throw new Error('消费资产倍率档位不能断档');
    }
  }

  return sorted;
}

export function calculateCreditAsset(params: {
  previousCumulativeSpend: number;
  addedSpend: number;
  tiers: CreditAssetTier[];
}): {
  assetAmount: number;
  segments: CreditAssetSegment[];
  rawAssetAmount: number;
} {
  const previousCumulativeSpend = Math.max(0, assertFiniteNumber(params.previousCumulativeSpend, 'previousCumulativeSpend'));
  const addedSpend = Math.max(0, assertFiniteNumber(params.addedSpend, 'addedSpend'));
  const tiers = validateCreditTiers(params.tiers);

  if (addedSpend === 0) {
    return { assetAmount: 0, segments: [], rawAssetAmount: 0 };
  }

  const targetSpend = previousCumulativeSpend + addedSpend;
  let cursor = previousCumulativeSpend;
  const segments: CreditAssetSegment[] = [];

  for (const tier of tiers) {
    if (cursor >= targetSpend) {
      break;
    }

    const tierStart = Math.max(cursor, tier.minAmount);
    const tierEnd = tier.maxAmount ?? targetSpend;
    const segmentEnd = Math.min(targetSpend, tierEnd);

    if (segmentEnd <= tierStart) {
      continue;
    }

    const spendAmount = segmentEnd - tierStart;
    const rawAssetAmount = spendAmount * tier.multiplier;

    segments.push({
      from: tierStart,
      to: segmentEnd,
      spendAmount,
      multiplier: tier.multiplier,
      rawAssetAmount,
    });

    cursor = segmentEnd;
  }

  const rawAssetAmount = segments.reduce((sum, segment) => sum + segment.rawAssetAmount, 0);
  return {
    assetAmount: Math.round(rawAssetAmount),
    segments,
    rawAssetAmount,
  };
}
