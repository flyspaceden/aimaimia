import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryPriceRuleScope, DeliveryPriceRuleType } from '../../../../generated/delivery-client';

export class CreateDeliveryPriceRuleDto {
  @IsEnum(DeliveryPriceRuleScope)
  scope: DeliveryPriceRuleScope;

  @IsEnum(DeliveryPriceRuleType)
  ruleType: DeliveryPriceRuleType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  merchantId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  skuId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  minQuantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fixedPriceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  markupBps?: number;

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
  note?: string;
}
