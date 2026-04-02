import { IsString, IsOptional } from 'class-validator';

/** 拒绝退款 */
export class RejectRefundDto {
  @IsString()
  reason: string;
}

/** 同意退款（可选备注） */
export class ApproveRefundDto {
  @IsOptional()
  @IsString()
  note?: string;
}
