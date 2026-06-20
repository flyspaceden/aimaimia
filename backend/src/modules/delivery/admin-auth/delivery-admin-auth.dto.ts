import { IsNotEmpty, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class DeliveryAdminLoginDto {
  @IsString()
  @MaxLength(64)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @IsString()
  @MaxLength(64)
  captchaId: string;

  @IsString()
  @Length(4, 6)
  captchaCode: string;
}

export class DeliveryAdminSmsCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}

export class DeliveryAdminLoginByPhoneCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @Length(4, 6)
  code: string;
}

export class DeliveryAdminRefreshDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @MaxLength(512)
  refreshToken: string;
}

export class DeliveryAdminChangePasswordDto {
  @IsString()
  @MaxLength(128)
  oldPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;
}

export class DeliveryAdminBindPhoneSmsCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}

export class DeliveryAdminChangePhoneDto {
  @IsString()
  @Length(4, 6)
  oldPhoneCode: string;

  @IsString()
  @Matches(/^1\d{10}$/, { message: '新手机号格式不正确' })
  newPhone: string;

  @IsString()
  @Length(4, 6)
  newPhoneCode: string;
}
