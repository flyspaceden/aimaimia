import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { VisualRateCardStatus } from '@prisma/client';

export class ConfigureVisualCreditWelcomePolicyDto {
  @IsBoolean()
  enabled: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  grantCredits: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  creditValueCents: number;

  @IsString()
  @MaxLength(120)
  policyVersion: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}

export class UpsertVisualRateCardDto {
  @IsString()
  @MaxLength(120)
  clientId: string;

  @IsString()
  @MaxLength(120)
  adapterNamespace: string;

  @IsString()
  @MaxLength(120)
  code: string;

  @IsString()
  @MaxLength(120)
  displayName: string;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsString()
  @MaxLength(120)
  modelProfile: string;

  @IsObject()
  outputSpec: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowedDirections: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowedRiskProfiles: string[];

  @IsString()
  @MaxLength(120)
  candidateRole: string;

  @IsBoolean()
  requiresHumanReview: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1)
  candidateCount: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  creditCost: number;

  @IsEnum(VisualRateCardStatus)
  status: VisualRateCardStatus;

  @IsString()
  @MaxLength(120)
  version: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}

export class AdminVisualCreditAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  availableDelta: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  reason: string;

  @IsString()
  @MaxLength(160)
  idempotencyKey: string;
}
