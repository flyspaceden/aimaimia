import { IsString, IsOptional, IsNumberString, IsNotEmpty, MaxLength, IsBoolean } from 'class-validator';

/**
 * 管理后台发货 DTO
 *
 * Bug 86: 支持两种发货方式
 * - useCarrierAuto=true（推荐 VIP_PACKAGE）：调顺丰 SF API 自动取号 + 生成电子面单 + OSS 持久化
 * - useCarrierAuto=false（默认，兼容现有手填单号链路）：手填快递公司 + 运单号
 */
export class AdminShipDto {
  @IsOptional()
  @IsBoolean()
  useCarrierAuto?: boolean;

  /** 承运商编码；useCarrierAuto=true 时可省略默认 'SF'，false 时必传 */
  @IsOptional()
  @IsString()
  carrierCode?: string;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @IsString()
  trackingNo?: string;
}

/** H16: 取消订单 DTO（替换 @Body('reason')） */
export class CancelOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AdminOrderQueryDto {
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

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  paymentChannel?: string;
}
