import {
  IsMobilePhone,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DeliverySellerSendForgotPasswordCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @IsNotEmpty()
  captchaId: string;

  @IsString()
  @Length(4, 6)
  captchaCode: string;
}

export class DeliverySellerListCompaniesForResetDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @Length(4, 6)
  code: string;
}

export class DeliverySellerResetForgotPasswordDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @Length(4, 6)
  code: string;

  @IsString()
  @IsNotEmpty()
  staffId: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;
}
