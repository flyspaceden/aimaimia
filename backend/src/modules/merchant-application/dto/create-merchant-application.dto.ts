import { IsString, IsNotEmpty, IsMobilePhone, IsEmail, IsOptional } from 'class-validator';

export class CreateMerchantApplicationDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsMobilePhone('zh-CN')
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  captchaId: string;

  @IsString()
  @IsNotEmpty()
  captchaCode: string;
}
