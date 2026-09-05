import { IsEnum, IsString, MaxLength, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductVisualMode } from '@prisma/client';

export class ListProductVisualTasksQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class IssueProductVisualQuoteDto {
  @IsString()
  @MaxLength(120)
  sourceAssetId: string;

  @IsString()
  @MaxLength(120)
  planId: string;

  @IsEnum(ProductVisualMode)
  direction: ProductVisualMode;

  @IsString()
  @MaxLength(120)
  rateCode: string;

  @IsString()
  @MaxLength(160)
  idempotencyKey: string;
}

export class ConfirmProductVisualQuoteDto {
  @IsString()
  @MaxLength(128)
  quoteHash: string;
}

export class ListProductVisualRateCardsQueryDto {
  @IsString()
  @MaxLength(120)
  sourceAssetId: string;

  @IsString()
  @MaxLength(120)
  planId: string;

  @IsEnum(ProductVisualMode)
  direction: ProductVisualMode;
}
