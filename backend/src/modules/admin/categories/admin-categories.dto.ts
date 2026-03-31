import { IsString, IsOptional, IsInt, IsArray, IsIn, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

const RETURN_POLICIES = ['RETURNABLE', 'NON_RETURNABLE', 'INHERIT'] as const;

/** 创建分类 */
export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsIn(RETURN_POLICIES, { message: 'returnPolicy 必须为 RETURNABLE、NON_RETURNABLE 或 INHERIT' })
  returnPolicy?: 'RETURNABLE' | 'NON_RETURNABLE' | 'INHERIT';
}

/** 编辑分类 */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsIn(RETURN_POLICIES, { message: 'returnPolicy 必须为 RETURNABLE、NON_RETURNABLE 或 INHERIT' })
  returnPolicy?: 'RETURNABLE' | 'NON_RETURNABLE' | 'INHERIT';
}

/** 批量排序项 */
class SortItem {
  @IsString()
  id: string;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

/** 批量排序 */
export class BatchSortDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SortItem)
  items: SortItem[];
}
