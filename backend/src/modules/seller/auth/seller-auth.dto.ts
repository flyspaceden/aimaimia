import { IsNotEmpty, IsString, IsMobilePhone, Length, MaxLength, MinLength, Matches } from 'class-validator';

/** 发送验证码 */
export class SellerSmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  captchaId: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  captchaCode: string;
}

/** 手机号 + 验证码登录 */
export class SellerLoginDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 8)
  code: string;
}

/** 手机号 + 密码登录 */
export class SellerPasswordLoginDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  captchaId: string;

  @IsString()
  @IsNotEmpty()
  @Length(4, 6)
  captchaCode: string;
}

/** 多企业用户选择企业 */
export class SellerSelectCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  tempToken: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  companyId: string;
}

/** 刷新 Token */
export class SellerRefreshDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @MaxLength(512)
  refreshToken: string;
}
