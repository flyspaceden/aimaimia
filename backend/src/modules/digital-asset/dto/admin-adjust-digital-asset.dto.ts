import { IsIn, IsNumber, IsOptional, IsString, Length, Max } from 'class-validator';

export class AdminAdjustDigitalAssetDto {
  @IsIn(['CREDIT', 'DEBIT'])
  direction!: 'CREDIT' | 'DEBIT';

  @IsNumber({ maxDecimalPlaces: 2 })
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
