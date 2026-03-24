import { IsString, IsNotEmpty, IsMobilePhone, IsEmail, IsOptional, MaxLength } from 'class-validator';

export class CreateMerchantApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contactName: string;

  @IsMobilePhone('zh-CN')
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  captchaId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  captchaCode: string;
}
