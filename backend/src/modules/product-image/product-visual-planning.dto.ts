import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProductVisualMode } from '@prisma/client';

export class CreateProductVisualPlanDto {
  @IsString()
  sourceAssetId: string;

  @IsOptional()
  @IsEnum(ProductVisualMode)
  requestedMode?: ProductVisualMode;
}
