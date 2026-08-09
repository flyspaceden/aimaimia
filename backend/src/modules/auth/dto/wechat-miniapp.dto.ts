import { IsString, Length, Matches } from 'class-validator';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const SMS_CODE_PATTERN = /^\d{6}$/;
const MINI_LOGIN_TICKET_PATTERN = /^[a-f0-9]{64}$/;

export class WechatMiniappLoginDto {
  @IsString()
  @Length(1, 256)
  code!: string;
}

export class WechatMiniappBindPhoneCodeDto {
  @IsString()
  @Matches(MINI_LOGIN_TICKET_PATTERN, { message: '小程序登录凭证格式不正确' })
  miniLoginTicket!: string;

  @IsString()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone!: string;
}

export class WechatMiniappBindPhoneDto extends WechatMiniappBindPhoneCodeDto {
  @IsString()
  @Matches(SMS_CODE_PATTERN, { message: '短信验证码应为 6 位数字' })
  code!: string;
}
