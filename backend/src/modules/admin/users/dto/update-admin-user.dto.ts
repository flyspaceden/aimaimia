import { IsString, IsOptional, IsArray, IsEnum, MinLength, Matches } from 'class-validator';
import { AdminUserStatus } from '@prisma/client';

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  realName?: string;

  /** 手机号（用于短信登录），1 开头的 11 位数字 */
  @IsOptional()
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确，必须为 1 开头的 11 位数字' })
  phone?: string;

  @IsOptional()
  @IsEnum(AdminUserStatus)
  status?: AdminUserStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  newPassword: string;
}
