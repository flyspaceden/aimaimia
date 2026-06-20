import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateDeliverySkuStockDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
