import { IsString, IsOptional, IsArray, IsEnum, IsDateString } from 'class-validator';

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
  avatar?: string;

  @IsOptional()
  @IsString()
  avatarFrameId?: string;

  @IsOptional()
  @IsEnum(['UNKNOWN', 'MALE', 'FEMALE'])
  gender?: 'UNKNOWN' | 'MALE' | 'FEMALE';

  @IsOptional()
  @IsDateString()
  birthday?: string; // 'YYYY-MM-DD' 格式
}
