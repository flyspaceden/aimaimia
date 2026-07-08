import { IsMobilePhone, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class SendSmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;
}

export class WeChatOAuthDto {
  @IsString()
  @Length(1, 256)
  code: string; // 微信授权码
}

export class H5WechatStartQueryDto {
  @IsString()
  @Length(8, 8)
  inviteCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  landingSessionId?: string;
}

export class H5WechatInviteLoginDto {
  @IsString()
  @Length(1, 256)
  wechatCode: string;

  @IsString()
  @Length(16, 128)
  state: string;

  @IsString()
  @Length(8, 8)
  inviteCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  landingSessionId?: string;
}
