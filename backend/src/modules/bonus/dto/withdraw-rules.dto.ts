import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateWithdrawRulesDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.5)
  withdrawTaxRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withdrawMinAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withdrawMaxAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  withdrawDailyMaxCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  withdrawCooldownSeconds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withdrawYearlyMaxAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  deductionRatioNormal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  deductionRatioVip?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deductionMinOrderAmount?: number;

  @IsOptional()
  @IsBoolean()
  deductionAllowCouponStack?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withdrawProviderFeeAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  withdrawYearlyAlertThreshold?: number;
}

export interface WithdrawRules {
  withdrawTaxRate: number;
  withdrawMinAmount: number;
  withdrawMaxAmount: number;
  withdrawDailyMaxCount: number;
  withdrawCooldownSeconds: number;
  withdrawYearlyMaxAmount: number;
  deductionRatioNormal: number;
  deductionRatioVip: number;
  deductionMinOrderAmount: number;
  deductionAllowCouponStack: boolean;
  withdrawProviderFeeAmount: number;
  withdrawYearlyAlertThreshold: number;
}
