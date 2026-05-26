import { IsString, Matches } from 'class-validator';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const SMS_CODE_PATTERN = /^\d{6}$/;

export class SendBindPhoneCodeDto {
  @IsString()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone!: string;
}

export class BindPhoneDto {
  @IsString()
  @Matches(PHONE_PATTERN, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @Matches(SMS_CODE_PATTERN, { message: '短信验证码应为 6 位数字' })
  code!: string;
}

export class BindWechatDto {
  @IsString()
  code!: string;
}
