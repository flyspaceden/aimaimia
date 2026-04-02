import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const MAX_BATCH_ORDER_ITEMS = 50;

/** 发货 */
export class SellerShipDto {}

/** 批量发货项 */
export class BatchShipItemDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;
}

/** 批量发货 */
export class BatchShipDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_ORDER_ITEMS, {
    message: `批量发货一次最多 ${MAX_BATCH_ORDER_ITEMS} 条`,
  })
  @ArrayUnique((item: BatchShipItemDto) => item.orderId, {
    message: '批量发货订单不可重复',
  })
  @ValidateNested({ each: true })
  @Type(() => BatchShipItemDto)
  items: BatchShipItemDto[];
}
