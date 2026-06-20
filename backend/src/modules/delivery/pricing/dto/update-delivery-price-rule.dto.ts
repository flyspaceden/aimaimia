import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryPriceRuleScope, DeliveryPriceRuleType } from '../../../../generated/delivery-client';

export class UpdateDeliveryPriceRuleDto {
  @IsOptional()
  @IsEnum(DeliveryPriceRuleScope)
  scope?: DeliveryPriceRuleScope;

  @IsOptional()
  @IsEnum(DeliveryPriceRuleType)
  ruleType?: DeliveryPriceRuleType;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  skuId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxQuantity?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fixedPriceCents?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  markupBps?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
