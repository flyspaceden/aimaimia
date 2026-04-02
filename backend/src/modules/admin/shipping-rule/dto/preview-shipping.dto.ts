import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PreviewShippingDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'goodsAmount 必须为数字' })
  @Min(0, { message: 'goodsAmount 不能小于 0' })
  goodsAmount: number;

  @IsOptional()
  @IsString({ message: 'regionCode 必须为字符串' })
  @MaxLength(16, { message: 'regionCode 不能超过 16 个字符' })
  regionCode?: string;

  // 管理端输入单位：kg（支持小数）
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'totalWeight 必须为数字' })
  @Min(0, { message: 'totalWeight 不能小于 0' })
  totalWeight?: number;
}

