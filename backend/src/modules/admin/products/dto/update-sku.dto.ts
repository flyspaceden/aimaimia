import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class SkuUpdateItem {
  /** 已存在 SKU 的 id；缺省则视为新增 */
  @IsOptional()
  @IsString()
  id?: string;

  /** 规格名称，如 "500g 礼盒装" */
  @IsOptional()
  @IsString()
  specText?: string;

  /** 售价（元） */
  @IsNumber()
  @Min(0)
  price: number;

  /** 成本价（元），选填 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  /** 库存数量 */
  @IsNumber()
  stock: number;
}

export class UpdateProductSkusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SkuUpdateItem)
  skus: SkuUpdateItem[];
}
