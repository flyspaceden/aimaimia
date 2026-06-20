import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateDeliveryProductSkuDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  supplyPriceCents: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  basePriceCents: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;

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

  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGram: number;
}

export class CreateDeliveryProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productUnitId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
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
  detailRich?: unknown;

  @IsOptional()
  media?: unknown;

  @IsOptional()
  attributes?: unknown;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchKeywords?: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unitName: string;

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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryProductSkuDto)
  skus: CreateDeliveryProductSkuDto[];
}

export class CreateAdminDeliveryProductDto extends CreateDeliveryProductDto {
  @IsString()
  @IsNotEmpty()
  merchantId: string;
}
