import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/** 修改密码（旧密码 + 新密码） */
export class AdminChangePasswordDto {
  @IsString()
  @MaxLength(128)
  oldPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;
}

/** 给新手机号发绑定验证码（已登录态调用） */
export class AdminBindPhoneSmsCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}

/** 修改手机号（旧手机验证码 + 新手机号 + 新手机验证码） */
export class AdminChangePhoneDto {
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
