import {
  IsString,
  IsIn,
  IsEmail,
  IsMobilePhone,
  Length,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @IsIn(['phone', 'email'])
  channel: 'phone' | 'email';

  @IsIn(['code', 'password'])
  mode: 'code' | 'password';

  @ValidateIf((o) => o.channel === 'phone')
  @IsMobilePhone('zh-CN')
  phone?: string;

  @ValidateIf((o) => o.channel === 'email')
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ValidateIf((o) => o.mode === 'code')
  @IsString()
  @Length(4, 8)
  code?: string;

  @ValidateIf((o) => o.mode === 'password')
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;
}
