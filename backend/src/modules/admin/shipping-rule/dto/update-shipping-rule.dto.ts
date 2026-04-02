import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateShippingRuleDto {
  @IsOptional()
  @IsString({ message: 'name 必须为字符串' })
  @MaxLength(100, { message: 'name 不能超过 100 个字符' })
  name?: string;

  @IsOptional()
  @IsArray({ message: 'regionCodes 必须为数组' })
  @ArrayMaxSize(200, { message: 'regionCodes 最多 200 项' })
  @IsString({ each: true, message: 'regionCodes 的每一项必须为字符串' })
  regionCodes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minAmount 必须为数字' })
  @Min(0, { message: 'minAmount 不能小于 0' })
  minAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxAmount 必须为数字' })
  @Min(0, { message: 'maxAmount 不能小于 0' })
  maxAmount?: number;

  // 管理端输入单位：kg（支持小数）
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minWeight 必须为数字' })
  @Min(0, { message: 'minWeight 不能小于 0' })
  minWeight?: number;

  // 管理端输入单位：kg（支持小数）
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxWeight 必须为数字' })
  @Min(0, { message: 'maxWeight 不能小于 0' })
  maxWeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'fee 必须为数字' })
  @Min(0, { message: 'fee 不能小于 0' })
  fee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'priority 必须为数字' })
  priority?: number;

  @IsOptional()
  @IsBoolean({ message: 'isActive 必须为布尔值' })
  isActive?: boolean;
}

