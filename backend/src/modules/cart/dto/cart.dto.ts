import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AddCartItemDto {
  @IsString({ message: 'skuId 必须为字符串' })
  @IsNotEmpty({ message: 'skuId 不能为空' })
  @MaxLength(64, { message: 'skuId 不能超过 64 个字符' })
  skuId: string;

  @Type(() => Number)
  @IsInt({ message: 'quantity 必须为整数' })
  @Min(1, { message: 'quantity 必须大于 0' })
  quantity: number;
}

export class UpdateCartItemQuantityDto {
  @Type(() => Number)
  @IsInt({ message: 'quantity 必须为整数' })
  @Min(1, { message: 'quantity 必须大于 0' })
  quantity: number;
}

export class ToggleCartSelectDto {
  @IsBoolean({ message: 'isSelected 必须为布尔值' })
  isSelected: boolean;
}

/** 购物车合并 — 单个商品项 */
export class MergeCartItemDto {
  @IsOptional()
  @IsString({ message: 'localKey 必须为字符串' })
  @MaxLength(128, { message: 'localKey 不能超过 128 个字符' })
  localKey?: string;

  @IsString({ message: 'skuId 必须为字符串' })
  @IsNotEmpty({ message: 'skuId 不能为空' })
  @MaxLength(64, { message: 'skuId 不能超过 64 个字符' })
  skuId: string;

  @Type(() => Number)
  @IsInt({ message: 'quantity 必须为整数' })
  @Min(1, { message: 'quantity 必须大于 0' })
  quantity: number;

  @IsOptional()
  @IsBoolean()
  isPrize?: boolean;

  @IsOptional()
  @IsString()
  claimToken?: string;
}

/** 购物车合并 — 请求体 */
export class MergeCartDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MergeCartItemDto)
  items: MergeCartItemDto[];
}
