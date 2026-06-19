import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class CreateDeliveryCartItemDto {
  @IsString({ message: 'skuId 必须为字符串' })
  @IsNotEmpty({ message: 'skuId 不能为空' })
  @MaxLength(64, { message: 'skuId 不能超过 64 个字符' })
  skuId: string;

  @Type(() => Number)
  @IsInt({ message: 'quantity 必须为整数' })
  @Min(1, { message: 'quantity 必须大于 0' })
  quantity: number;
}
