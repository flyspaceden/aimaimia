import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class BindNormalShareDto {
  @IsString()
  @MaxLength(32)
  code: string;

  @IsOptional()
  @IsIn(['LANDING', 'APP', 'DEFERRED', 'ADMIN'])
  source?: 'LANDING' | 'APP' | 'DEFERRED' | 'ADMIN';
}
