import {
  IsString,
  IsOptional,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  IsBoolean,
  IsArray,
  IsDateString,
  MaxLength,
  IsObject,
  IsEnum,
} from 'class-validator';
import {
  CouponCampaignStatus,
  CouponDiscountType,
  CouponDistributionMode,
  CouponTriggerType,
} from '@prisma/client';

/** 更新红包活动 DTO（部分字段可选） */
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(CouponTriggerType)
  triggerType?: CouponTriggerType;

  @IsOptional()
  @IsEnum(CouponDistributionMode)
  distributionMode?: CouponDistributionMode;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, any>;

  @IsOptional()
  @IsEnum(CouponDiscountType)
  discountType?: CouponDiscountType;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDiscountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableCategories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableCompanyIds?: string[];

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stackGroup?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  totalQuota?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  validDays?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}

/** 更新活动状态 DTO */
export class UpdateCampaignStatusDto {
  @IsEnum(CouponCampaignStatus)
  status: CouponCampaignStatus;
}
