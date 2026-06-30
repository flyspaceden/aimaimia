import {
  IsString,
  IsOptional,
  IsNumberString,
  IsNotEmpty,
  MaxLength,
  IsBoolean,
  Matches,
} from 'class-validator';

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

export class AdminUpdateOrderReceiverInfoDto {
  @IsString({ message: 'recipientName 必须为字符串' })
  @IsNotEmpty({ message: '收件人不能为空' })
  @MaxLength(50, { message: 'recipientName 不能超过 50 个字符' })
  recipientName!: string;

  @IsString({ message: 'phone 必须为字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的手机号' })
  phone!: string;

  @IsString({ message: 'regionCode 必须为字符串' })
  @IsNotEmpty({ message: '请选择省/市/区' })
  @MaxLength(32, { message: 'regionCode 不能超过 32 个字符' })
  regionCode!: string;

  @IsString({ message: 'regionText 必须为字符串' })
  @IsNotEmpty({ message: '请选择省/市/区' })
  @MaxLength(120, { message: 'regionText 不能超过 120 个字符' })
  regionText!: string;

  @IsString({ message: 'detail 必须为字符串' })
  @IsNotEmpty({ message: '详细地址不能为空' })
  @MaxLength(200, { message: 'detail 不能超过 200 个字符' })
  detail!: string;
}
