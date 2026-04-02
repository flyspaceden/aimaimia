import { IsNotEmpty, IsString, IsMobilePhone, Length, MaxLength, MinLength } from 'class-validator';

/** 发送验证码 */
export class SellerSmsCodeDto {
  @IsMobilePhone('zh-CN')
  phone: string;
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
