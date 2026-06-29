import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const DELIVERY_CATEGORY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class CreateDeliveryCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateDeliveryCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsIn(DELIVERY_CATEGORY_STATUSES)
  status?: 'ACTIVE' | 'INACTIVE';
}

class DeliveryCategorySortItem {
  @IsString()
  id: string;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class BatchSortDeliveryCategoriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryCategorySortItem)
  items: DeliveryCategorySortItem[];
}
