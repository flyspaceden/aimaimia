import {
  IsString,
  IsEnum,
  IsOptional,
  IsEmail,
  MaxLength,
  MinLength,
  IsNotEmpty,
  IsObject,
  Matches,
  ValidateIf,
} from 'class-validator';
import { InvoiceType } from '@prisma/client';

export class CreateInvoiceProfileDto {
  @IsEnum(InvoiceType)
  @IsNotEmpty()
  type: InvoiceType;

  /** 发票抬头（个人姓名或企业名称） */
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  title: string;

  /** 企业税号（企业发票必填，统一社会信用代码 15-20 位） */
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

  /** 开户行信息（企业专用，{bankName, accountNo}） */
  @IsOptional()
  @IsObject()
  bankInfo?: Record<string, string>;

  /** 注册地址（企业专用） */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}
