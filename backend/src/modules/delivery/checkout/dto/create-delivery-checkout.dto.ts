import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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
}
