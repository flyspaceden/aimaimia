import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class MarkDeliverySettlementPaidDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  settledAmountCents: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
