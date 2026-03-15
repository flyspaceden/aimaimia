import { IsString, IsOptional, IsNumber, IsEnum, IsArray, IsObject, IsIn } from 'class-validator';
import { ProductStatus, ProductAuditStatus } from '@prisma/client';

export class AdminUpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  basePrice?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  origin?: any; // Json: 产地信息

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aiKeywords?: string[];

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductAuditStatus)
  auditStatus?: ProductAuditStatus;

  @IsOptional()
  @IsString()
  auditNote?: string;

  // 语义字段
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  flavorTags?: string[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  seasonalMonths?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  usageScenarios?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryTags?: string[];

  @IsOptional()
  @IsString()
  originRegion?: string;
}

/** H16: 商品状态切换 DTO（替换 @Body('status')） */
export class ToggleProductStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status: 'ACTIVE' | 'INACTIVE';
}

/** H16: 商品审核 DTO（替换 @Body('auditStatus') + @Body('auditNote')） */
export class AuditProductDto {
  @IsIn(['APPROVED', 'REJECTED'])
  auditStatus: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  auditNote?: string;
}
