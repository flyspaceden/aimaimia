import { IsBooleanString, IsEnum, IsOptional, IsString } from 'class-validator';
import { DeliveryPriceRuleScope, DeliveryPriceRuleType } from '../../../../generated/delivery-client';

export class ListDeliveryPriceRulesQueryDto {
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
  @IsBooleanString()
  isActive?: string;
}
