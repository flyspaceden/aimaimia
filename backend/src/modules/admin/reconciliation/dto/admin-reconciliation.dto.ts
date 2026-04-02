import { IsOptional, Matches } from 'class-validator';

export class AdminReconciliationQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 必须为 YYYY-MM-DD 格式' })
  date?: string;
}

