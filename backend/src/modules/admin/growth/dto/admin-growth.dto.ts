import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const GRANT_TIMINGS = ['IMMEDIATE', 'CONFIRMED_RECEIPT', 'AFTER_SALE_WINDOW', 'MANUAL'] as const;
const APPLICABLE_USER_TYPES = ['ALL', 'NORMAL', 'VIP'] as const;
const ACCOUNT_USER_TYPES = ['ALL', 'NORMAL', 'VIP'] as const;
const EXCHANGE_TYPES = ['COUPON', 'SHIPPING_COUPON', 'LOTTERY_CHANCE', 'VIP_DISCOUNT_COUPON', 'DECORATION'] as const;
const EXCHANGE_STATUSES = ['ACTIVE', 'INACTIVE', 'SOLD_OUT'] as const;
const SORT_DIRECTIONS = ['asc', 'desc', 'ascend', 'descend'] as const;

export class AdminGrowthRuleDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  categoryCode!: string;

  @IsOptional()
  @IsInt()
  pointsReward?: number;

  @IsOptional()
  @IsInt()
  growthReward?: number;

  @IsOptional()
  @IsIn(GRANT_TIMINGS)
  grantTiming?: string;

  @IsOptional()
  @IsInt()
  dailyLimit?: number | null;

  @IsOptional()
  @IsInt()
  weeklyLimit?: number | null;

  @IsOptional()
  @IsInt()
  monthlyLimit?: number | null;

  @IsOptional()
  @IsInt()
  lifetimeLimit?: number | null;

  @IsOptional()
  @IsIn(APPLICABLE_USER_TYPES)
  applicableUserType?: string;

  @IsOptional()
  @IsNumber()
  vipPointsMultiplier?: number | null;

  @IsOptional()
  @IsNumber()
  vipGrowthMultiplier?: number | null;

  @IsOptional()
  riskPolicy?: Record<string, unknown> | null;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class AdminGrowthLevelDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(0)
  threshold!: number;

  @IsOptional()
  benefits?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  avatarFrameType?: string | null;

  @IsOptional()
  @IsString()
  titleLabel?: string | null;

  @IsOptional()
  @IsInt()
  monthlyExchangeLimit?: number | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AdminGrowthReplaceLevelsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminGrowthLevelDto)
  levels!: AdminGrowthLevelDto[];
}

export class AdminGrowthExchangeItemDto {
  @IsIn(EXCHANGE_TYPES)
  type!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsInt()
  @Min(1)
  pointsCost!: number;

  @IsOptional()
  @IsString()
  couponCampaignId?: string | null;

  @IsOptional()
  @IsInt()
  stockTotal?: number | null;

  @IsOptional()
  @IsInt()
  stockDaily?: number | null;

  @IsOptional()
  @IsInt()
  perUserDailyLimit?: number | null;

  @IsOptional()
  @IsInt()
  perUserMonthlyLimit?: number | null;

  @IsOptional()
  @IsString()
  requiredLevelCode?: string | null;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsIn(EXCHANGE_STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class AdminGrowthUpdateExchangeItemDto {
  @IsOptional()
  @IsIn(EXCHANGE_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  pointsCost?: number;

  @IsOptional()
  @IsString()
  couponCampaignId?: string | null;

  @IsOptional()
  @IsInt()
  stockTotal?: number | null;

  @IsOptional()
  @IsInt()
  stockDaily?: number | null;

  @IsOptional()
  @IsInt()
  perUserDailyLimit?: number | null;

  @IsOptional()
  @IsInt()
  perUserMonthlyLimit?: number | null;

  @IsOptional()
  @IsString()
  requiredLevelCode?: string | null;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsIn(EXCHANGE_STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class AdminGrowthAdjustDto {
  @IsOptional()
  @IsInt()
  pointsDelta?: number;

  @IsOptional()
  @IsInt()
  growthDelta?: number;

  @IsString()
  reason!: string;
}

export class AdminGrowthSettingsDto {
  @IsOptional()
  @IsBoolean()
  growthEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  pointsExpireDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pointsExpireRemindDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyPointsCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPointsCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyShareRewardUserCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyInviteFirstOrderCap?: number;

  @IsOptional()
  @IsBoolean()
  refundReversalEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSuspendExchangeRisk?: boolean;

  @IsOptional()
  @IsBoolean()
  autoVipBySpendEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  autoVipCumulativeSpendThreshold?: number;
}

export class AdminNormalShareStatusDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminGrowthAccountQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageSize?: number;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  levelCode?: string;

  @IsOptional()
  @IsIn(ACCOUNT_USER_TYPES)
  userType?: string;

  @IsOptional()
  @IsIn(['pointsBalance', 'pointsTotalEarned', 'growthValue', 'updatedAt'])
  sortBy?: string;

  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  sortOrder?: string;
}

export class AdminGrowthLedgerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageSize?: number;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  behaviorCode?: string;

  @IsOptional()
  @IsString()
  type?: string;
}

export class AdminNormalShareBindingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageSize?: number;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  rewardStatus?: string;
}
