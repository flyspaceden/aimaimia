import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsArray,
  ValidateNested,
  MaxLength,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VipGiftOptionStatus, CoverMode } from '@prisma/client';

/** 赠品方案中的单个 SKU 项 */
export class VipGiftItemDto {
  @IsString({ message: 'SKU ID 必须为字符串' })
  skuId: string;

  @IsInt({ message: '数量必须为整数' })
  @Min(1, { message: '数量不能小于 1' })
  @Max(99, { message: '数量不能超过 99' })
  quantity: number;

  @IsOptional()
  @IsInt({ message: '排序值必须为整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder?: number;
}

/** 创建赠品方案 */
export class CreateVipGiftOptionDto {
  @IsString({ message: '档位 ID 必须为字符串' })
  packageId: string;

  @IsString({ message: '方案标题必须为字符串' })
  @MaxLength(60, { message: '方案标题不能超过 60 个字符' })
  title: string;

  @IsOptional()
  @IsString({ message: '副标题必须为字符串' })
  @MaxLength(120, { message: '副标题不能超过 120 个字符' })
  subtitle?: string;

  @IsOptional()
  @IsString({ message: '标签必须为字符串' })
  @MaxLength(20, { message: '标签不能超过 20 个字符' })
  badge?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus, { message: '状态不合法' })
  status?: VipGiftOptionStatus;

  @IsOptional()
  @IsEnum(CoverMode, { message: '封面模式不合法' })
  coverMode?: CoverMode;

  @IsOptional()
  @IsString({ message: '封面图 URL 必须为字符串' })
  @MaxLength(1000, { message: '封面图 URL 不能超过 1000 个字符' })
  coverUrl?: string;

  @IsArray({ message: 'items 必须为数组' })
  @ArrayMinSize(1, { message: '赠品方案至少包含 1 个商品' })
  @ArrayMaxSize(20, { message: '赠品方案最多包含 20 个商品' })
  @ValidateNested({ each: true })
  @Type(() => VipGiftItemDto)
  items: VipGiftItemDto[];
}

/** 更新赠品方案 */
export class UpdateVipGiftOptionDto {
  @IsOptional()
  @IsString({ message: '档位 ID 必须为字符串' })
  packageId?: string;

  @IsOptional()
  @IsString({ message: '方案标题必须为字符串' })
  @MaxLength(60, { message: '方案标题不能超过 60 个字符' })
  title?: string;

  @IsOptional()
  @IsString({ message: '副标题必须为字符串' })
  @MaxLength(120, { message: '副标题不能超过 120 个字符' })
  subtitle?: string;

  @IsOptional()
  @IsString({ message: '标签必须为字符串' })
  @MaxLength(20, { message: '标签不能超过 20 个字符' })
  badge?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder?: number;

  @IsOptional()
  @IsEnum(VipGiftOptionStatus, { message: '状态不合法' })
  status?: VipGiftOptionStatus;

  @IsOptional()
  @IsEnum(CoverMode, { message: '封面模式不合法' })
  coverMode?: CoverMode;

  @IsOptional()
  @IsString({ message: '封面图 URL 必须为字符串' })
  @MaxLength(1000, { message: '封面图 URL 不能超过 1000 个字符' })
  coverUrl?: string;

  @IsOptional()
  @IsArray({ message: 'items 必须为数组' })
  @ArrayMinSize(1, { message: '赠品方案至少包含 1 个商品' })
  @ArrayMaxSize(20, { message: '赠品方案最多包含 20 个商品' })
  @ValidateNested({ each: true })
  @Type(() => VipGiftItemDto)
  items?: VipGiftItemDto[];
}

/** 单独更新赠品方案状态（上架/下架） */
export class UpdateVipGiftOptionStatusDto {
  @IsEnum(VipGiftOptionStatus, { message: '状态不合法' })
  status: VipGiftOptionStatus;
}

/** 批量排序子项 */
class VipGiftSortItem {
  @IsString({ message: 'ID 必须为字符串' })
  id: string;

  @IsInt({ message: '排序值必须为整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder: number;
}

/** 批量排序赠品方案 */
export class BatchSortVipGiftDto {
  @IsArray({ message: 'items 必须为数组' })
  @ValidateNested({ each: true })
  @Type(() => VipGiftSortItem)
  items: VipGiftSortItem[];
}
