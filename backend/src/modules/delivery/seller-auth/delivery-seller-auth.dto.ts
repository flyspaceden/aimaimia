import {
  IsMobilePhone,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DeliverySellerSmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;
}

export class DeliverySellerLoginDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @Length(4, 6)
  code: string;
}

export class DeliverySellerPasswordLoginDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @IsString()
  @IsNotEmpty()
  captchaId: string;

  @IsString()
  @Length(4, 6)
  captchaCode: string;
}

export class DeliverySellerSelectCompanyDto {
  @IsString()
  @IsNotEmpty()
  tempToken: string;

  @IsString()
  @IsNotEmpty()
  companyId: string;
}

export class DeliverySellerRefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class DeliverySellerChangePasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  oldPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;
}

export class DeliverySellerBindPhoneSmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;
}

export class DeliverySellerChangePhoneDto {
  @IsString()
  @Length(4, 6)
  oldPhoneCode: string;

  @IsMobilePhone('zh-CN')
  newPhone: string;

  @IsString()
  @Length(4, 6)
  newPhoneCode: string;
}

export class DeliverySellerChangeNicknameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nickname: string;
}
