import {
  IsString,
  IsMobilePhone,
  Length,
  MaxLength,
  MinLength,
  IsIn,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @IsIn(['code', 'password'])
  mode: 'code' | 'password';

  @IsMobilePhone('zh-CN')
  phone: string;

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
