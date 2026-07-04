import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ExchangeGrowthItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;
}
