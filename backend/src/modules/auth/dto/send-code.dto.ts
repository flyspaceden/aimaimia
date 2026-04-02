import { IsEmail, IsMobilePhone, IsString, Length, MaxLength } from 'class-validator';

export class SendSmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;
}

export class SendEmailCodeDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class WeChatOAuthDto {
  @IsString()
  @Length(1, 256)
  code: string; // 微信授权码
}
