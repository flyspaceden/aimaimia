import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  IsArray,
  IsObject,
  ValidateNested,
  Min,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 产地字段结构（替代 any） */
export class ProductOriginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  text: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}

/** 创建 SKU */
export class CreateSkuDto {
  @IsString()
  @IsNotEmpty()
  specName: string; // 规格名（如 "5斤装"）

  @IsNumber()
  @Min(0.01)
  cost: number; // 成本价（必填，售价由系统自动计算 = cost × markupRate）

  @IsNumber()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrder?: number; // 单笔限购，null/不传 = 不限制

  @IsOptional()
  @IsNumber()
  weightGram?: number; // 重量(克)
}

/** 创建商品 */
export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string; // AI 搜索依赖，必填

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  basePrice?: number; // 可选，未提供时自动取规格最低售价

  @IsString()
  @IsNotEmpty()
  categoryId: string; // 分类必选

  @IsOptional()
  @IsString()
  returnPolicy?: string; // RETURNABLE / NON_RETURNABLE / INHERIT（默认）

  @IsObject()
  @ValidateNested()
  @Type(() => ProductOriginDto)
  origin: ProductOriginDto; // JSON { text, lat, lng }，产地必填

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSkuDto)
  skus: CreateSkuDto[];

  @IsOptional()
  attributes?: any; // JSON 自定义属性 { key: value }

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aiKeywords?: string[]; // AI 搜索关键词

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @IsOptional()
  @IsArray()
  flavorTags?: string[];

  @IsOptional()
  @IsArray()
  seasonalMonths?: number[];

  @IsOptional()
  @IsArray()
  usageScenarios?: string[];

  @IsOptional()
  @IsArray()
  dietaryTags?: string[];

  @IsOptional()
  @IsString()
  originRegion?: string;
}

/** 编辑商品 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  basePrice?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  returnPolicy?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductOriginDto)
  origin?: ProductOriginDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  attributes?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aiKeywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @IsOptional()
  @IsArray()
  flavorTags?: string[];

  @IsOptional()
  @IsArray()
  seasonalMonths?: number[];

  @IsOptional()
  @IsArray()
  usageScenarios?: string[];

  @IsOptional()
  @IsArray()
  dietaryTags?: string[];

  @IsOptional()
  @IsString()
  originRegion?: string;
}

/** 更新 SKU 列表 */
export class UpdateSkusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SkuItemDto)
  skus: SkuItemDto[];
}

export class SkuItemDto {
  @IsOptional()
  @IsString()
  id?: string; // 已有 SKU 的 ID（无则新建）

  @IsString()
  @IsNotEmpty()
  specName: string;

  @IsNumber()
  @Min(0.01)
  cost: number; // 成本价（必填，售价由系统自动计算 = cost × markupRate）

  @IsNumber()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrder?: number;

  @IsOptional()
  @IsNumber()
  weightGram?: number;
}

/** 商品状态变更 */
export class ProductStatusDto {
  @IsString()
  @IsNotEmpty()
  status: 'ACTIVE' | 'INACTIVE';
}

/** 草稿 SKU（所有字段可选，规格不完整也能存） */
export class DraftSkuDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  specName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  cost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrder?: number;

  @IsOptional()
  @IsNumber()
  weightGram?: number;
}

/** 创建草稿：仅标题必填 */
export class CreateDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  returnPolicy?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductOriginDto)
  origin?: ProductOriginDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftSkuDto)
  skus?: DraftSkuDto[];

  @IsOptional()
  attributes?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aiKeywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @IsOptional()
  @IsArray()
  flavorTags?: string[];

  @IsOptional()
  @IsArray()
  seasonalMonths?: number[];

  @IsOptional()
  @IsArray()
  usageScenarios?: string[];

  @IsOptional()
  @IsArray()
  dietaryTags?: string[];

  @IsOptional()
  @IsString()
  originRegion?: string;
}

/** 更新草稿：全部可选（title 若传需非空） */
export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  returnPolicy?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductOriginDto)
  origin?: ProductOriginDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftSkuDto)
  skus?: DraftSkuDto[];

  @IsOptional()
  attributes?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aiKeywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @IsOptional()
  @IsArray()
  flavorTags?: string[];

  @IsOptional()
  @IsArray()
  seasonalMonths?: number[];

  @IsOptional()
  @IsArray()
  usageScenarios?: string[];

  @IsOptional()
  @IsArray()
  dietaryTags?: string[];

  @IsOptional()
  @IsString()
  originRegion?: string;
}
