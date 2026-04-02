import {
  IsString,
  IsOptional,
  IsIn,
  IsEmail,
  IsMobilePhone,
  Length,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegisterDto {
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

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;
}
