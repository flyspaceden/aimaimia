import type {
  CaptainOrderAttribution,
  CaptainSeafoodConfig,
  ConfigVersion,
  ProfitSafetySummary,
} from './index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

export type CaptainSchemaVersionIsV3 = Assert<Equal<CaptainSeafoodConfig['schemaVersion'], 3>>;
export type CaptainDirectRateUsesProfit = Assert<Equal<
  keyof CaptainSeafoodConfig['perOrderCommission'],
  'directProfitRate'
>>;
export type CaptainOrderHasV3Model = Assert<Equal<
  CaptainOrderAttribution['calculationModel'],
  'SALES_V2' | 'PROFIT_V3'
>>;
export type SafetySummaryHasFourScenarioContract = Assert<Equal<
  ProfitSafetySummary['scenarios'][number]['key'],
  | 'VIP_BUYER_VIP_INVITER'
  | 'VIP_BUYER_NORMAL_INVITER'
  | 'NORMAL_BUYER_VIP_INVITER'
  | 'NORMAL_BUYER_NORMAL_INVITER'
>>;
export type VersionRollbackIsServerControlled = Assert<Equal<ConfigVersion['rollbackAllowed'], boolean>>;
