import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class BindNormalShareDto {
  @IsString()
  @MaxLength(32)
  code: string;

  @IsOptional()
  @IsIn(['LANDING', 'APP', 'MINI_PROGRAM', 'DEFERRED', 'ADMIN'])
  source?: 'LANDING' | 'APP' | 'MINI_PROGRAM' | 'DEFERRED' | 'ADMIN';
}
