import { IsMobilePhone, IsOptional, IsString, MaxLength } from 'class-validator';

export class PhoneLoginDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @MaxLength(10)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;
}
