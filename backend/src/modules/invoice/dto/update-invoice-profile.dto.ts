import {
  IsString,
  IsEnum,
  IsOptional,
  IsEmail,
  IsNotEmpty,
  MaxLength,
  MinLength,
  IsObject,
  Matches,
  ValidateIf,
} from 'class-validator';
import { InvoiceType } from '@prisma/client';

export class UpdateInvoiceProfileDto {
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title?: string;

  /** 企业发票时税号必填 */
  @ValidateIf((o) => o.type === 'COMPANY')
  @IsString()
  @IsNotEmpty({ message: '企业发票必须填写税号' })
  @Matches(/^[A-Z0-9]{15,20}$/, { message: '税号格式不正确' })
  taxNo?: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone?: string;

  @IsOptional()
  @IsObject()
  bankInfo?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}
