import {
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  ValidateNested,
  Min,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemDto {
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

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  addressId?: string;

  /** 选中的奖励 ID（用于抵扣） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  rewardId?: string;

  /** 运费（前端传入仅作参考，服务端会根据商品金额重新计算） */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  /** 幂等键，防止网络重试导致重复创建订单 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  /** S12修复：前端 preview 时看到的总金额，后端下单时校验一致性 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedTotal?: number;

  /** 选中的平台红包实例 ID 列表（用于预结算估算折扣） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  couponInstanceIds?: string[];
}
