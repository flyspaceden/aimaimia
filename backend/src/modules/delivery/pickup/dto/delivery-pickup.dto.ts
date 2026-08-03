import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsString, Max, Min } from 'class-validator';

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

export class CreateDeliveryPickupSfShipmentDto {
  @Type(() => Number)
  @IsInt({ message: '顺丰产品代码必须是整数' })
  @Min(1, { message: '顺丰产品代码无效' })
  expressTypeId!: number;

  @Type(() => Number)
  @IsInt({ message: '包裹数量必须是整数' })
  @Min(1, { message: '包裹数量至少为 1' })
  @Max(999, { message: '包裹数量不能超过 999' })
  packageCount!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: '实际重量最多保留 3 位小数' })
  @Min(0.001, { message: '实际重量必须大于 0kg' })
  @Max(1000000, { message: '实际重量超出系统允许范围' })
  totalWeightKg!: number;
}
