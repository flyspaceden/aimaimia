import { IsMobilePhone, IsOptional, IsString, MaxLength } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @MaxLength(128)
  openid: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  unionid?: string;

  @IsOptional()
  @IsMobilePhone('zh-CN')
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;
}
