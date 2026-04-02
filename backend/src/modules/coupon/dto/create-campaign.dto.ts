import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  IsBoolean,
  IsArray,
  IsDateString,
  MaxLength,
  IsObject,
} from 'class-validator';
import {
  CouponDiscountType,
  CouponDistributionMode,
  CouponTriggerType,
} from '@prisma/client';

/** 创建红包活动 DTO */
export class CreateCampaignDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(CouponTriggerType)
  triggerType: CouponTriggerType;

  @IsEnum(CouponDistributionMode)
  distributionMode: CouponDistributionMode;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, any>;

  @IsEnum(CouponDiscountType)
  discountType: CouponDiscountType;

  @IsNumber()
  @IsPositive()
  discountValue: number;

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

  @IsInt()
  @IsPositive()
  totalQuota: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  validDays?: number;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;
}
