import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

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
  @IsString({ message: 'signature 必须为字符串' })
  @MaxLength(512, { message: 'signature 不能超过 512 个字符' })
  signature?: string;
}
