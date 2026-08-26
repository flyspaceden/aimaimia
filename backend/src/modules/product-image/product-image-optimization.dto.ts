import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestProductImageOptimizationDto {
  @IsString()
  sourceAssetId: string;

  @IsIn(['WHITE_BACKGROUND', 'FREE_TUNE'])
  intent: 'WHITE_BACKGROUND' | 'FREE_TUNE';

  /** Required for FREE_TUNE; the server revalidates all plan fields. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  planId?: string;

  @IsString()
  @MaxLength(128)
  idempotencyKey: string;

  @IsString()
  productId: string;
}

export class AdoptProductImageOptimizationDto {
  @IsString()
  productId: string;

  @IsBoolean()
  quantityConfirmed: boolean;

  @IsBoolean()
  labelsConfirmed: boolean;

  @IsBoolean()
  factsConfirmed: boolean;
}
