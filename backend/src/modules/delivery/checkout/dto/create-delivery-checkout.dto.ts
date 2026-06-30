import { Type } from 'class-transformer';
import {
  DeliveryPaymentChannel,
  DeliveryPickupMode,
} from '../../../../generated/delivery-client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryPickupPlanItemDto } from '../../pickup/dto/delivery-pickup.dto';

export class CreateDeliveryCheckoutDto {
  @IsArray({ message: 'cartItemIds 必须为数组' })
  @ArrayMinSize(1, { message: '至少选择一个购物车商品' })
  @ArrayMaxSize(100, { message: '一次最多选择 100 个购物车商品' })
  @Type(() => String)
  @IsString({ each: true, message: 'cartItemIds 中每一项都必须为字符串' })
  cartItemIds: string[];

  @IsOptional()
  @IsString({ message: 'addressId 必须为字符串' })
  @MaxLength(64, { message: 'addressId 不能超过 64 个字符' })
  addressId?: string;

  @IsOptional()
  @IsString({ message: 'note 必须为字符串' })
  @MaxLength(200, { message: 'note 不能超过 200 个字符' })
  note?: string;

  @IsEnum(DeliveryPaymentChannel, { message: 'paymentChannel 必须是有效的配送支付渠道' })
  paymentChannel: DeliveryPaymentChannel;

  @IsOptional()
  @IsEnum(DeliveryPickupMode, { message: 'pickupMode 必须是有效的提货方式' })
  pickupMode?: DeliveryPickupMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'plannedPickupCount 必须是整数' })
  @Min(1, { message: 'plannedPickupCount 至少为 1' })
  @Max(5, { message: 'plannedPickupCount 最多为 5' })
  plannedPickupCount?: number;

  @IsOptional()
  @IsArray({ message: 'pickupPlanItems 必须为数组' })
  @ValidateNested({ each: true })
  @Type(() => DeliveryPickupPlanItemDto)
  pickupPlanItems?: DeliveryPickupPlanItemDto[];
}
