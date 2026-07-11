import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  OrderProfitAdjustmentStatus,
  OrderProfitReconciliationStatus,
} from '@prisma/client';

export class ProfitCostCorrectionDto {
  @IsString()
  @MinLength(1)
  orderItemId!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  unitCostCents!: number;
}

export class RecalculateProfitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProfitCostCorrectionDto)
  costCorrections!: ProfitCostCorrectionDto[];
}

export class ReviewProfitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
}

export class ListProfitReconciliationsDto {
  @IsOptional()
  @IsEnum(OrderProfitReconciliationStatus)
  status?: OrderProfitReconciliationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ListProfitAdjustmentsDto {
  @IsOptional()
  @IsEnum(OrderProfitAdjustmentStatus)
  status?: OrderProfitAdjustmentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
