import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewDeliveryMerchantApplicationDto {
  @IsString()
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectReason?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;
}
