import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CheckoutItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  skuId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;

  /** 购物车项 ID（用于识别奖品项，可选） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cartItemId?: string;
}

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  addressId: string;

  /** 选中的奖励 ID（用于抵扣） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  rewardId?: string;

  /** 支付渠道: wechat / alipay / bankcard */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentChannel?: string;

  /** 幂等键 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  /** 前端 preview 时看到的总金额，后端校验一致性 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedTotal?: number;

  /** 选中的平台红包实例 ID 列表（与 rewardId 分润奖励独立） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  couponInstanceIds?: string[];
}
