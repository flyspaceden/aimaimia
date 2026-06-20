import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateDeliverySellerProductSkuDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  supplyPriceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minOrderQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderStepQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGram?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDeliverySellerProductDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  productUnitId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
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
  detailRich?: unknown;

  @IsOptional()
  media?: unknown;

  @IsOptional()
  attributes?: unknown;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchKeywords?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unitName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minOrderQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderStepQuantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateDeliverySellerProductSkuDto)
  skus?: UpdateDeliverySellerProductSkuDto[];
}
