import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ImportShippingRuleDto {
  @IsIn(['csv', 'json'])
  format!: 'csv' | 'json';

  @IsString()
  payload!: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;
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
