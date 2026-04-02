import { IsString, IsOptional, IsEnum, IsNumberString } from 'class-validator';
import { RefundStatus } from '@prisma/client';

export class AdminRefundQueryDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}

export class ArbitrateRefundDto {
  @IsEnum(RefundStatus)
  status: RefundStatus; // APPROVED 或 REJECTED

  @IsOptional()
  @IsString()
  reason?: string;
}
