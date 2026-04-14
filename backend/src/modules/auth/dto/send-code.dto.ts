import { IsMobilePhone, IsString, Length } from 'class-validator';

export class SendSmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;
}

export class WeChatOAuthDto {
  @IsString()
  @Length(1, 256)
  code: string; // 微信授权码
}
