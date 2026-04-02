import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MediaType, ProductStatus } from '@prisma/client';

export class RewardProductSkuDto {
  @IsString({ message: 'SKU 标题必须为字符串' })
  @IsNotEmpty({ message: 'SKU 标题不能为空' })
  @MaxLength(100, { message: 'SKU 标题不能超过 100 个字符' })
  title: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 价格必须为数字' })
  @Min(0, { message: 'SKU 价格不能小于 0' })
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 成本必须为数字' })
  @Min(0, { message: 'SKU 成本不能小于 0' })
  cost?: number;

  @Type(() => Number)
  @IsInt({ message: 'SKU 库存必须为整数' })
  @Min(0, { message: 'SKU 库存不能小于 0' })
  stock: number;

  @IsOptional()
  @IsString({ message: 'SKU 编码必须为字符串' })
  @MaxLength(64, { message: 'SKU 编码不能超过 64 个字符' })
  skuCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 重量必须为数字' })
  @Min(0, { message: 'SKU 重量不能小于 0' })
  weightGram?: number;
}

export class RewardProductMediaDto {
  @IsEnum(MediaType, { message: '媒体类型不合法' })
  type: MediaType;

  @IsString({ message: '媒体地址必须为字符串' })
  @IsNotEmpty({ message: '媒体地址不能为空' })
  @MaxLength(1000, { message: '媒体地址不能超过 1000 个字符' })
  url: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序必须为整数' })
  sortOrder?: number;

  @IsOptional()
  @IsString({ message: 'alt 必须为字符串' })
  @MaxLength(200, { message: 'alt 不能超过 200 个字符' })
  alt?: string;
}

export class CreateRewardProductDto {
  @IsString({ message: '商品标题必须为字符串' })
  @IsNotEmpty({ message: '商品标题不能为空' })
  @MaxLength(120, { message: '商品标题不能超过 120 个字符' })
  title: string;

  @IsOptional()
  @IsString({ message: '商品副标题必须为字符串' })
  @MaxLength(200, { message: '商品副标题不能超过 200 个字符' })
  subtitle?: string;

  @IsOptional()
  @IsString({ message: '商品描述必须为字符串' })
  description?: string;

  @IsOptional()
  detailRich?: any;

  @IsOptional()
  @IsString({ message: '分类 ID 必须为字符串' })
  categoryId?: string;

  @Type(() => Number)
  @IsNumber({}, { message: '基准售价必须为数字' })
  @Min(0, { message: '基准售价不能小于 0' })
  basePrice: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '成本价必须为数字' })
  @Min(0, { message: '成本价不能小于 0' })
  cost?: number;

  @IsOptional()
  origin?: any;

  @IsOptional()
  attributes?: any;

  @IsArray({ message: 'skus 必须为数组' })
  @ArrayMinSize(1, { message: '至少需要一个 SKU' })
  @ArrayMaxSize(200, { message: 'SKU 数量不能超过 200 个' })
  @ValidateNested({ each: true })
  @Type(() => RewardProductSkuDto)
  skus: RewardProductSkuDto[];

  @IsOptional()
  @IsArray({ message: 'media 必须为数组' })
  @ArrayMaxSize(50, { message: '媒体数量不能超过 50 个' })
  @ValidateNested({ each: true })
  @Type(() => RewardProductMediaDto)
  media?: RewardProductMediaDto[];
}

/** 新增 SKU（编辑商品时使用） */
export class CreateRewardProductSkuForUpdateDto {
  @IsString({ message: 'SKU 标题必须为字符串' })
  @IsNotEmpty({ message: 'SKU 标题不能为空' })
  @MaxLength(100, { message: 'SKU 标题不能超过 100 个字符' })
  title: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 价格必须为数字' })
  @Min(0, { message: 'SKU 价格不能小于 0' })
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 成本必须为数字' })
  @Min(0, { message: 'SKU 成本不能小于 0' })
  cost?: number;

  @Type(() => Number)
  @IsInt({ message: 'SKU 库存必须为整数' })
  @Min(0, { message: 'SKU 库存不能小于 0' })
  stock: number;

  @IsOptional()
  @IsString({ message: 'SKU 编码必须为字符串' })
  @MaxLength(64, { message: 'SKU 编码不能超过 64 个字符' })
  skuCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 重量必须为数字' })
  @Min(0, { message: 'SKU 重量不能小于 0' })
  weightGram?: number;
}

/** 更新单个 SKU */
export class UpdateRewardProductSkuDto {
  @IsOptional()
  @IsString({ message: 'SKU 标题必须为字符串' })
  @MaxLength(100, { message: 'SKU 标题不能超过 100 个字符' })
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 价格必须为数字' })
  @Min(0, { message: 'SKU 价格不能小于 0' })
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 成本必须为数字' })
  @Min(0, { message: 'SKU 成本不能小于 0' })
  cost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'SKU 库存必须为整数' })
  @Min(0, { message: 'SKU 库存不能小于 0' })
  stock?: number;

  @IsOptional()
  @IsString({ message: 'SKU 编码必须为字符串' })
  @MaxLength(64, { message: 'SKU 编码不能超过 64 个字符' })
  skuCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'SKU 重量必须为数字' })
  @Min(0, { message: 'SKU 重量不能小于 0' })
  weightGram?: number;
}

export class UpdateRewardProductDto {
  @IsOptional()
  @IsString({ message: '商品标题必须为字符串' })
  @MaxLength(120, { message: '商品标题不能超过 120 个字符' })
  title?: string;

  @IsOptional()
  @IsString({ message: '商品副标题必须为字符串' })
  @MaxLength(200, { message: '商品副标题不能超过 200 个字符' })
  subtitle?: string;

  @IsOptional()
  @IsString({ message: '商品描述必须为字符串' })
  description?: string;

  @IsOptional()
  detailRich?: any;

  @IsOptional()
  @IsString({ message: '分类 ID 必须为字符串' })
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '基准售价必须为数字' })
  @Min(0, { message: '基准售价不能小于 0' })
  basePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '成本价必须为数字' })
  @Min(0, { message: '成本价不能小于 0' })
  cost?: number;

  @IsOptional()
  origin?: any;

  @IsOptional()
  attributes?: any;

  @IsOptional()
  @IsEnum(ProductStatus, { message: '商品状态不合法' })
  status?: ProductStatus;
}
