import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateAddressDto {
  @IsOptional()
  @IsString({ message: 'recipientName 必须为字符串' })
  @MaxLength(50, { message: 'recipientName 不能超过 50 个字符' })
  recipientName?: string;

  @IsOptional()
  @IsString({ message: 'receiverName 必须为字符串' })
  @MaxLength(50, { message: 'receiverName 不能超过 50 个字符' })
  receiverName?: string;

  @IsString({ message: 'phone 必须为字符串' })
  @MaxLength(20, { message: 'phone 不能超过 20 个字符' })
  phone: string;

  @IsOptional()
  @IsString({ message: 'regionCode 必须为字符串' })
  @MaxLength(32, { message: 'regionCode 不能超过 32 个字符' })
  regionCode?: string;

  @IsOptional()
  @IsString({ message: 'regionText 必须为字符串' })
  @MaxLength(120, { message: 'regionText 不能超过 120 个字符' })
  regionText?: string;

  @IsOptional()
  @IsString({ message: 'province 必须为字符串' })
  @MaxLength(40, { message: 'province 不能超过 40 个字符' })
  province?: string;

  @IsOptional()
  @IsString({ message: 'city 必须为字符串' })
  @MaxLength(40, { message: 'city 不能超过 40 个字符' })
  city?: string;

  @IsOptional()
  @IsString({ message: 'district 必须为字符串' })
  @MaxLength(40, { message: 'district 不能超过 40 个字符' })
  district?: string;

  @IsString({ message: 'detail 必须为字符串' })
  @MaxLength(200, { message: 'detail 不能超过 200 个字符' })
  detail: string;

  @IsOptional()
  location?: any;

  @IsOptional()
  @IsBoolean({ message: 'isDefault 必须为布尔值' })
  isDefault?: boolean;
}
