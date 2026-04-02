import { IsString, IsOptional, IsArray, IsEnum, MinLength } from 'class-validator';
import { AdminUserStatus } from '@prisma/client';

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  realName?: string;

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
