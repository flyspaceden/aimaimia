import type { GroupBuyTier } from '../types';

export const calculateGroupBuyProgressTargetCount = (tiers: Pick<GroupBuyTier, 'sequence'>[]) =>
  Math.max(1, tiers.length);
