import { IsNotEmpty, IsString, IsMobilePhone, Length, MaxLength, MinLength, Matches } from 'class-validator';

/** 发送验证码（方案 A：无图形码，靠后端速率限制保护） */
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

// ===================== C40c7 账号安全 =====================

/** 修改密码（旧密码 + 新密码） */
export class SellerChangePasswordDto {
  @IsString()
  @MaxLength(128)
  oldPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;
}

/** 给新手机号发绑定验证码（已登录态调用） */
export class SellerBindPhoneSmsCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}

/** 修改手机号（旧手机验证码 + 新手机号 + 新手机验证码） */
export class SellerChangePhoneDto {
  @IsString()
  @Length(4, 8)
  oldPhoneCode: string;

  @IsString()
  @Matches(/^1\d{10}$/, { message: '新手机号格式不正确' })
  newPhone: string;

  @IsString()
  @Length(4, 8)
  newPhoneCode: string;
}
