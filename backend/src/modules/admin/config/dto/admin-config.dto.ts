import {
  IsString,
  IsOptional,
  IsDefined,
  IsArray,
  IsBoolean,
  IsNumber,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateConfigDto {
  /** 配置值（具体类型由配置键决定，在 Service 层做业务验证） */
  @IsDefined({ message: '配置值 value 不能为空' })
  value: any;

  @IsOptional()
  @IsString()
  changeNote?: string;

  /** MARKUP_RATE 专用：确认将当前普通商品统一重算为新售价 */
  @IsOptional()
  @IsBoolean()
  repriceExisting?: boolean;

  /** MARKUP_RATE 影响预览返回的防并发 token */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  markupPreviewToken?: string;
}

export class BatchUpdateConfigItem {
  @IsString({ message: '配置项 key 必须为字符串' })
  key: string;

  @IsDefined({ message: '配置值 value 不能为空' })
  value: any;
}

/**
 * 批量更新配置 DTO
 * 用于需要原子性校验的场景（如 VIP/普通用户利润七分比例同时调整）
 * 全部 updates 在单个事务内 upsert，最后一次性校验约束（例如比例之和 = 1.0）
 */
export class BatchUpdateConfigDto {
  @IsArray({ message: 'updates 必须为数组' })
  @ArrayMinSize(1, { message: '至少需要包含一项更新' })
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateConfigItem)
  updates: BatchUpdateConfigItem[];

  @IsOptional()
  @IsString()
  changeNote?: string;

  @IsOptional()
  @IsBoolean()
  repriceExisting?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  markupPreviewToken?: string;
}

export class PreviewMarkupRepriceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  markupRate: number;
}

export class RollbackConfigVersionDto {
  @IsOptional()
  @IsBoolean()
  repriceExisting?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  markupPreviewToken?: string;
}
