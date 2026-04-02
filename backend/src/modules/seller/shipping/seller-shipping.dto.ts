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

const MAX_BATCH_WAYBILL_ITEMS = 50;

/** 生成电子面单 */
export class GenerateWaybillDto {
  @IsString()
  @IsNotEmpty()
  carrierCode: string; // SF / YTO / ZTO / STO / YUNDA / JD / EMS
}

/** 批量生成面单项 */
export class BatchGenerateWaybillItemDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  carrierCode: string;
}

/** 批量生成电子面单 */
export class BatchGenerateWaybillDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_WAYBILL_ITEMS, {
    message: `批量生成面单一次最多 ${MAX_BATCH_WAYBILL_ITEMS} 条`,
  })
  @ArrayUnique((item: BatchGenerateWaybillItemDto) => item.orderId, {
    message: '批量生成面单订单不可重复',
  })
  @ValidateNested({ each: true })
  @Type(() => BatchGenerateWaybillItemDto)
  items: BatchGenerateWaybillItemDto[];
}
