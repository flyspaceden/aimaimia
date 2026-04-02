import { IsString, IsOptional, IsInt, IsIn, Min } from 'class-validator';

export class JoinGroupDto {
  @IsString()
  companyId: string;

  @IsString()
  groupId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  headcount?: number;

  @IsOptional()
  @IsIn(['consumer', 'buyer', 'student', 'media', 'investor', 'other'])
  identity?: string;

  @IsOptional()
  @IsString()
  contactName?: string;
}
