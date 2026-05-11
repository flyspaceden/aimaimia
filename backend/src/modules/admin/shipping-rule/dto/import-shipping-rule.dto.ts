import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { CreateShippingRuleDto } from './create-shipping-rule.dto';

function parseImportBoolean(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return true;
    if (normalized === 'true' || normalized === '1' || normalized === '是') return true;
    if (normalized === 'false' || normalized === '0' || normalized === '否') return false;
  }
  return value;
}

export class ImportShippingRuleDto {
  @IsIn(['csv', 'json'])
  format!: 'csv' | 'json';

  @IsString()
  payload!: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;
}

export class ImportShippingRuleRowDto extends CreateShippingRuleDto {
  @IsOptional()
  @Transform(({ value }) => parseImportBoolean(value))
  @IsBoolean({ message: 'isActive 必须为布尔值或 true/false、1/0、是/否' })
  isActive?: boolean;
}

export type ImportPreview = {
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  errors: Array<{ row: number; message: string }>;
};

export type ImportShippingRuleResult = ImportPreview & {
  created: number;
  updated: number;
};
