import { centsToYuan, yuanToCents } from './money-allocation';

export interface CaptainProfitFundingInput {
  distributableProfitAmount: number;
  captainEligibleProfitAmount: number;
  treeRewardProfitRate: number;
  industryFundProfitRate: number;
  actualDirectReferralProfitRate: number;
  captainDirectProfitRate: number;
  monthlyProfitRates: number[];
}

export interface CaptainProfitFundingResult {
  platformRetainedAmount: number;
  directAmount: number;
  monthlyMaximum: number;
  totalHoldAmount: number;
  coveredByPlatformRetained: boolean;
}

function assertRate(rate: number, name: string): void {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`${name} must be a non-negative finite rate`);
  }
}

function multiplyCentsByRate(amountCents: number, rate: number): number {
  const result = Math.round(amountCents * rate);
  if (!Number.isSafeInteger(result)) {
    throw new Error('captain funding amount exceeds the safe cent range');
  }
  return result;
}

export function calculateCaptainProfitFunding(
  input: CaptainProfitFundingInput,
): CaptainProfitFundingResult {
  const distributableProfitCents = yuanToCents(input.distributableProfitAmount);
  const captainEligibleProfitCents = yuanToCents(input.captainEligibleProfitAmount);
  if (distributableProfitCents < 0 || captainEligibleProfitCents < 0) {
    throw new Error('captain funding profit amounts must be non-negative');
  }

  assertRate(input.treeRewardProfitRate, 'treeRewardProfitRate');
  assertRate(input.industryFundProfitRate, 'industryFundProfitRate');
  assertRate(input.actualDirectReferralProfitRate, 'actualDirectReferralProfitRate');
  assertRate(input.captainDirectProfitRate, 'captainDirectProfitRate');
  input.monthlyProfitRates.forEach((rate, index) => assertRate(rate, `monthlyProfitRates[${index}]`));

  const treeRewardCents = multiplyCentsByRate(
    distributableProfitCents,
    input.treeRewardProfitRate,
  );
  const industryFundCents = multiplyCentsByRate(
    distributableProfitCents,
    input.industryFundProfitRate,
  );
  const directReferralCents = multiplyCentsByRate(
    distributableProfitCents,
    input.actualDirectReferralProfitRate,
  );
  const platformRetainedCents = distributableProfitCents
    - treeRewardCents
    - industryFundCents
    - directReferralCents;

  const directCents = multiplyCentsByRate(
    captainEligibleProfitCents,
    input.captainDirectProfitRate,
  );
  const monthlyRate = input.monthlyProfitRates.reduce((sum, rate) => sum + rate, 0);
  const monthlyCents = multiplyCentsByRate(captainEligibleProfitCents, monthlyRate);
  const totalHoldCents = directCents + monthlyCents;
  if (!Number.isSafeInteger(totalHoldCents)) {
    throw new Error('captain funding holds exceed the safe cent range');
  }

  return {
    platformRetainedAmount: centsToYuan(platformRetainedCents),
    directAmount: centsToYuan(directCents),
    monthlyMaximum: centsToYuan(monthlyCents),
    totalHoldAmount: centsToYuan(totalHoldCents),
    coveredByPlatformRetained:
      platformRetainedCents >= 0 && totalHoldCents <= platformRetainedCents,
  };
}
