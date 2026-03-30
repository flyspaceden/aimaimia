import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ArbitrateAfterSaleDto {
  @IsIn(['APPROVED', 'REJECTED'], { message: 'status 必须为 APPROVED 或 REJECTED' })
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString({ message: 'reason 必须为字符串' })
  @MaxLength(500, { message: 'reason 不能超过 500 个字符' })
  reason?: string;
}
