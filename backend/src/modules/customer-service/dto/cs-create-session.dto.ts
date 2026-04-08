import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CsSessionSource } from '@prisma/client';

export class CreateCsSessionDto {
  @IsEnum(CsSessionSource)
  source: CsSessionSource;

  @IsOptional()
  @IsString()
  sourceId?: string;
}
