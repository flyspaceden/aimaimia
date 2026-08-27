import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVisualAgentPlanDto {
  @IsString()
  @MaxLength(120)
  assetId: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  requestedDirection?: string;
}

export class IssueVisualAgentQuoteDto {
  @IsString()
  @MaxLength(120)
  planId: string;

  @IsString()
  @MaxLength(120)
  rateCode: string;

  @IsString()
  @MaxLength(160)
  idempotencyKey: string;
}

export class ConfirmVisualAgentTaskDto {
  @IsString()
  @MaxLength(128)
  quoteHash: string;
}

export class CreateVisualAgentAdoptIntentDto {
  @IsString()
  @MaxLength(120)
  externalObjectVersion: string;

  @IsBoolean()
  quantityConfirmed: boolean;

  @IsBoolean()
  labelsConfirmed: boolean;

  @IsBoolean()
  factsConfirmed: boolean;
}
