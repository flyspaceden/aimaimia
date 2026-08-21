import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
export class ChangePasswordDto {
  @IsString() @MinLength(6) @MaxLength(128) oldPassword!: string;
  @IsString() @MinLength(6) @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/, { message: '新密码至少 6 位且必须包含大写字母、小写字母和数字' })
  newPassword!: string;
}
