import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/** 创建溯源批次 */
export class CreateTraceBatchDto {
  @IsString()
  @IsNotEmpty()
  batchCode: string;

  @IsOptional()
  meta?: any; // JSON { origin, farmingMethod, feed, inspection, ... }
}

/** 更新溯源批次 */
export class UpdateTraceBatchDto {
  @IsOptional()
  @IsString()
  batchCode?: string;

  @IsOptional()
  meta?: any;
}
