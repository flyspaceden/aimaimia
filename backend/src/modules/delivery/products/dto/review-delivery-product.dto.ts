import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewDeliveryProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
