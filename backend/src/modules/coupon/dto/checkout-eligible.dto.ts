import {
  IsNumber,
  IsPositive,
  IsArray,
  IsString,
} from 'class-validator';

/** 结算时查询可用红包请求 DTO */
export class CheckoutEligibleDto {
  @IsNumber()
  @IsPositive()
  orderAmount: number; // 订单金额（不含运费）

  @IsArray()
  @IsString({ each: true })
  categoryIds: string[]; // 商品所属分类 ID 列表

  @IsArray()
  @IsString({ each: true })
  companyIds: string[]; // 商品所属店铺 ID 列表
}
