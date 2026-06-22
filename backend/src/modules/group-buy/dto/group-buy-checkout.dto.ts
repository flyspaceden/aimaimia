import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class GroupBuyCheckoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  activityId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  addressId: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentChannel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shareCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedTotal?: number;

  /** 明确拒绝：团购只能现金购买，不支持消费积分抵扣。 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deductionAmount?: number;

  /** 明确拒绝：团购不能使用团购返还余额抵扣。 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  groupBuyRebateDeductionAmount?: number;

  /** 明确拒绝：团购不能使用旧 rewardId 抵扣。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  rewardId?: string;

  /** 明确拒绝：团购不能使用平台红包。 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  couponInstanceIds?: string[];
}
