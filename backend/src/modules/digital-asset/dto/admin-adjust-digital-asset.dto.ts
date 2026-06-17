import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class AdminAdjustDigitalAssetDto {
  @IsIn(['CREDIT', 'DEBIT'])
  direction!: 'CREDIT' | 'DEBIT';

  @IsIn(['SEED_ASSET', 'CREDIT_ASSET'])
  subjectType!: 'SEED_ASSET' | 'CREDIT_ASSET';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999999)
  amount!: number;

  @IsString()
  @Length(5, 200)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  clientIdempotencyKey?: string;
}
