import { IsEnum, IsString, MaxLength } from 'class-validator';
import { ProductVisualMode } from '@prisma/client';

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
