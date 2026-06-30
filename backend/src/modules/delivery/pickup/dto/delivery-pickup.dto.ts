import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class DeliveryPickupPlanItemDto {
  @IsString({ message: 'cartItemId 必须为字符串' })
  cartItemId!: string;

  @Type(() => Number)
  @IsInt({ message: 'batchNo 必须是整数' })
  @Min(1, { message: 'batchNo 至少为 1' })
  batchNo!: number;

  @Type(() => Number)
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 至少为 1' })
  quantity!: number;
}
