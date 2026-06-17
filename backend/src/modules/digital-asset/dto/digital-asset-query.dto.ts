import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DigitalAssetSourceType, DigitalAssetSubjectType } from '../digital-asset-v2.types';

export class DigitalAssetQueryDto {
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
  @IsIn(['ORDER_RECEIVED', 'REFUND_REVERSAL', 'ADMIN_ADJUSTMENT', 'BACKFILL'])
  type?: string;

  @IsOptional()
  @IsIn([
    'ORDER_RECEIVED',
    'CONSUMPTION_CONFIRMED',
    'REFUND_REVERSAL',
    'SELF_VIP_PURCHASE',
    'REFERRAL_VIP_PURCHASE',
    'HISTORICAL_CONSUMPTION_GRANT',
    'ADMIN_ADJUSTMENT',
    'BACKFILL',
  ])
  sourceType?: DigitalAssetSourceType;

  @IsOptional()
  @IsIn(['CUMULATIVE_SPEND', 'SEED_ASSET', 'CREDIT_ASSET'])
  subjectType?: DigitalAssetSubjectType;
}
