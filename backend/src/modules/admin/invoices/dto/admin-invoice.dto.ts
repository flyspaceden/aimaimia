import { IsString, IsOptional, IsNumberString, IsNotEmpty, IsEnum, MaxLength } from 'class-validator';
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
  /** 发票号码 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  invoiceNo: string;

  /** 电子发票 PDF 地址 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  pdfUrl: string;
}

export class FailInvoiceDto {
  /** 失败原因 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
