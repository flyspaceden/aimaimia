import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  DeliveryProductAuditStatus,
  DeliveryProductStatus,
} from '../../../../generated/delivery-client';

export class ListDeliveryProductsQueryDto {
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
