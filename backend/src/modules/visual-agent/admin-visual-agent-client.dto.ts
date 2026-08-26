import { IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, ArrayMaxSize, ArrayMinSize } from 'class-validator';

export class ProvisionVisualAgentClientDto {
  @IsString()
  @MaxLength(120)
  tenantId: string;

  @IsString()
  @MaxLength(160)
  tenantName: string;

  @IsString()
  @MaxLength(120)
  clientId: string;

  @IsString()
  @MaxLength(160)
  clientName: string;

  @IsString()
  @MaxLength(120)
  adapterNamespace: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowedAdapterTypes: string[];
}

export class IssueVisualAgentClientKeyDto {
  @IsIn(['live', 'test'])
  environment: 'live' | 'test';

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
