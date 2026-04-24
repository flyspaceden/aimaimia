import { IsString, Matches, Length, MinLength } from 'class-validator';

export class SellerSendForgotPasswordCodeDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  captchaId!: string;

  @IsString()
  @Length(4, 8)
  captchaCode!: string;
}

export class SellerListCompaniesForResetDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @Length(4, 8)
  code!: string;
}

export class SellerResetForgotPasswordDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @Length(4, 8)
  code!: string;

  @IsString()
  staffId!: string;

  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/, {
    message: '密码至少 6 位且必须包含大写字母、小写字母和数字',
  })
  newPassword!: string;
}
