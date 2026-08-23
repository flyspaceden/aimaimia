import { IsString, IsOptional, IsArray, IsEnum, IsDateString, IsIn, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatar?: string;

  @IsOptional()
  @IsIn(['default', 'vip'])
  avatarFrameId?: 'default' | 'vip';

  @IsOptional()
  @IsEnum(['UNKNOWN', 'MALE', 'FEMALE'])
  gender?: 'UNKNOWN' | 'MALE' | 'FEMALE';

  @IsOptional()
  @IsDateString()
  birthday?: string; // 'YYYY-MM-DD' 格式
}
