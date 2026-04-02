import { IsString, IsOptional, IsNumberString, IsNotEmpty, MaxLength } from 'class-validator';

export class AdminShipDto {
  @IsString()
  carrierCode: string;

  @IsString()
  carrierName: string;

  @IsString()
  trackingNo: string;
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
