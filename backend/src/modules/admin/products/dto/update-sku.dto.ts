import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
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

  /** 包装后重量（克），用于计算运费和顺丰面单 */
  @Type(() => Number)
  @IsInt({ message: 'SKU 重量必须是整数克' })
  @IsPositive({ message: 'SKU 重量必须大于 0 克' })
  weightGram: number;

  /** 单笔限购数量，null/不传表示不限 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '单笔限购必须是整数' })
  @Min(1, { message: '单笔限购最少为 1 件' })
  maxPerOrder?: number;
}

export class UpdateProductSkusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SkuUpdateItem)
  skus: SkuUpdateItem[];
}
