import { IsString, MinLength, IsOptional, IsArray, Matches } from 'class-validator';

export class CreateAdminUserDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  realName?: string;

  /** 手机号（用于短信登录），1 开头的 11 位数字 */
  @IsOptional()
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确，必须为 1 开头的 11 位数字' })
  phone?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];
}
