import {
  IsNumber,
  IsOptional,
  IsInt,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VipGiftOptionStatus } from '@prisma/client';

export class CreateVipPackageDto {
  @Type(() => Number)
  @IsNumber({}, { message: '价格必须为数字' })
  @Min(0.01, { message: '价格不能小于 0.01' })
  @Max(99999, { message: '价格不能超过 99999' })
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '推荐奖励比例必须为数字' })
  @Min(0, { message: '推荐奖励比例不能小于 0' })
  @Max(1, { message: '推荐奖励比例不能超过 1' })
  referralBonusRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus, { message: '状态不合法' })
  status?: VipGiftOptionStatus;
}

export class UpdateVipPackageDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '价格必须为数字' })
  @Min(0.01, { message: '价格不能小于 0.01' })
  @Max(99999, { message: '价格不能超过 99999' })
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '推荐奖励比例必须为数字' })
  @Min(0, { message: '推荐奖励比例不能小于 0' })
  @Max(1, { message: '推荐奖励比例不能超过 1' })
  referralBonusRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus, { message: '状态不合法' })
  status?: VipGiftOptionStatus;
}
