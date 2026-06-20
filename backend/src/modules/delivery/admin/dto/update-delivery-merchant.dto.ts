import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateDeliveryMerchantDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'ACTIVE', 'SUSPENDED'])
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  servicePhone?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  defaultMarkupBps?: number;
}
