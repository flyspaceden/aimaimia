import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminDigitalAssetAccountQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn([
    'totalAssetBalance',
    'seedAssetBalance',
    'creditAssetBalance',
    'frozenCreditAssetBalance',
    'cumulativeSpendAmount',
    'updatedAt',
  ])
  sortField?: string;

  @IsOptional()
  @IsIn(['ascend', 'descend', 'asc', 'desc'])
  sortOrder?: string;
}

export class AdminDigitalAssetLedgerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn([
    'ORDER_RECEIVED',
    'CONSUMPTION_CONFIRMED',
    'CONSUMPTION_PAID_FROZEN',
    'CONSUMPTION_FROZEN_RELEASED',
    'CONSUMPTION_FROZEN_VOIDED',
    'REFUND_REVERSAL',
    'SELF_VIP_PURCHASE',
    'REFERRAL_VIP_PURCHASE',
    'HISTORICAL_CONSUMPTION_GRANT',
    'ADMIN_ADJUSTMENT',
    'BACKFILL',
  ])
  type?: string;
}
