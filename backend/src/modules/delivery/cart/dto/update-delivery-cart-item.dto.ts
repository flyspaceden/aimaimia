import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateDeliveryCartItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'quantity 必须为整数' })
  @Min(1, { message: 'quantity 必须大于 0' })
  quantity?: number;

  @IsOptional()
  @IsBoolean({ message: 'isSelected 必须为布尔值' })
  isSelected?: boolean;
}
