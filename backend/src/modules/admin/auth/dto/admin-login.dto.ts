import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @MaxLength(64)
  username: string;

  @IsString()
  @MaxLength(128)
  @MinLength(6)
  password: string;

  @IsString()
  @MaxLength(64)
  captchaId: string;

  @IsString()
  @Length(4, 6)
  captchaCode: string;
}

export class AdminSendCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @MaxLength(64)
  captchaId: string;

  @IsString()
  @Length(4, 6)
  captchaCode: string;
}

export class AdminLoginByPhoneCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @Length(4, 6)
  code: string;
}
