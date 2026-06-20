import { IsIn, IsISO8601, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PaymentCallbackDto {
  @IsString({ message: 'merchantOrderNo 必须为字符串' })
  @MaxLength(128, { message: 'merchantOrderNo 不能超过 128 个字符' })
  merchantOrderNo: string;

  @IsString({ message: 'providerTxnId 必须为字符串' })
  @MaxLength(128, { message: 'providerTxnId 不能超过 128 个字符' })
  providerTxnId: string;

  @IsIn(['SUCCESS', 'FAILED'], { message: 'status 必须为 SUCCESS 或 FAILED' })
  status: 'SUCCESS' | 'FAILED';

  @IsOptional()
  @IsISO8601({}, { message: 'paidAt 必须为 ISO8601 时间格式' })
  paidAt?: string;

  @IsOptional()
  rawPayload?: any;

  @IsOptional()
  @IsString({ message: 'paymentChannel 必须为字符串' })
  @IsIn(['ALIPAY', 'WECHAT_PAY'], { message: 'paymentChannel 必须是 ALIPAY 或 WECHAT_PAY' })
  paymentChannel?: 'ALIPAY' | 'WECHAT_PAY';

  @IsOptional()
  @IsInt({ message: 'claimedAmountCents 必须为整数分' })
  @Min(0, { message: 'claimedAmountCents 不能小于 0' })
  claimedAmountCents?: number;

  @IsOptional()
  @IsString({ message: 'signature 必须为字符串' })
  @MaxLength(512, { message: 'signature 不能超过 512 个字符' })
  signature?: string;
}
