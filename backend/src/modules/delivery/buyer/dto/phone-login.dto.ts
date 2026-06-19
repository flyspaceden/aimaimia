import { IsMobilePhone, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const SMS_CODE_PATTERN = /^\d{6}$/;

export class PhoneLoginDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @Matches(SMS_CODE_PATTERN, { message: '短信验证码应为 6 位数字' })
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
