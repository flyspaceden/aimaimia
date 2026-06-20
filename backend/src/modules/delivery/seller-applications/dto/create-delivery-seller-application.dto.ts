import { IsEmail, IsMobilePhone, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeliverySellerApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contactName: string;

  @IsMobilePhone('zh-CN')
  contactPhone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  licenseFileUrl?: string;
}
