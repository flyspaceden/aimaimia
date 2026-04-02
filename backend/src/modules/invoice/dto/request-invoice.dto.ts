import { IsString, IsNotEmpty } from 'class-validator';

export class RequestInvoiceDto {
  /** 订单 ID */
  @IsString()
  @IsNotEmpty()
  orderId: string;

  /** 发票抬头 ID */
  @IsString()
  @IsNotEmpty()
  profileId: string;
}
