import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';

export class RequestProductImageOptimizationDto {
  @IsString()
  sourceAssetId: string;

  @IsIn(['WHITE_BACKGROUND'])
  intent: 'WHITE_BACKGROUND';

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
