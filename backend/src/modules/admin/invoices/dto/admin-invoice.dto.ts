import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

export class AdminInvoiceQueryDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  pageSize?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class IssueInvoiceDto {
  /** 开票模式：AUTO 使用配置 provider，MOCK 强制模拟开票，MANUAL 手工录入 */
  @IsOptional()
  @IsIn(['AUTO', 'MOCK', 'MANUAL'])
  mode?: 'AUTO' | 'MOCK' | 'MANUAL';

  /** 发票号码 */
  @ValidateIf((dto) => dto.mode === 'MANUAL')
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  invoiceNo?: string;

  /** 电子发票 PDF 地址 */
  @ValidateIf((dto) => dto.mode === 'MANUAL')
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  pdfUrl?: string;
}

export class FailInvoiceDto {
  /** 失败原因 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class InvoiceIssuerProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  taxNo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  registeredAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  registeredPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bankAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  drawer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  reviewer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  payee?: string;
}

export class UpdateInvoiceSettingsDto {
  @IsOptional()
  @IsIn(['MOCK'])
  providerMode?: 'MOCK';

  @IsOptional()
  @IsBoolean()
  allowVipPackage?: boolean;

  @IsOptional()
  @IsIn(['ORDER_ITEMS', 'MERGED_CATEGORY'])
  lineMode?: 'ORDER_ITEMS' | 'MERGED_CATEGORY';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.13)
  defaultTaxRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  defaultTaxClassificationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultGoodsName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarkTemplate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceIssuerProfileDto)
  issuerProfile?: InvoiceIssuerProfileDto;

  @IsOptional()
  @IsBoolean()
  autoIssue?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  autoIssueMaxAttempts?: number;
}
