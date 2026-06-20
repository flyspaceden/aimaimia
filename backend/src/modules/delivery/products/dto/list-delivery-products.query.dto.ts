import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import {
  DeliveryProductAuditStatus,
  DeliveryProductStatus,
} from '../../../../generated/delivery-client';

export class ListDeliveryProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsEnum(DeliveryProductStatus)
  status?: DeliveryProductStatus;

  @IsOptional()
  @IsEnum(DeliveryProductAuditStatus)
  auditStatus?: DeliveryProductAuditStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}
