import { IsString, IsOptional } from 'class-validator';

export class CreateTraceBatchDto {
  @IsString()
  companyId: string;

  @IsString()
  batchCode: string;

  @IsOptional()
  meta?: any;
}

export class UpdateTraceBatchDto {
  @IsOptional()
  @IsString()
  batchCode?: string;

  @IsOptional()
  meta?: any;
}
