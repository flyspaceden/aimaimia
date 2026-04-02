import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LotteryPrizeType } from '@prisma/client';

// ============================================================
// 创建奖品 DTO — 白名单模式，只允许以下字段通过
// 业务约束（type ↔ productId/skuId 联动）在 Service 层校验
// ============================================================
export class CreateLotteryPrizeDto {
  /** 奖品名称 */
  @IsString()
  @IsNotEmpty({ message: '奖品名称不能为空' })
  name: string;

  /** 奖品类型 */
  @IsEnum(LotteryPrizeType, {
    message: `奖品类型必须为 ${Object.values(LotteryPrizeType).join(' / ')}`,
  })
  type: LotteryPrizeType;

  /** 中奖概率 (0-100) */
  @IsNumber({}, { message: '概率必须为数字' })
  @Min(0, { message: '概率不能小于0' })
  @Max(100, { message: '概率不能大于100' })
  probability: number;

  /** 关联商品 ID（DISCOUNT_BUY / THRESHOLD_GIFT 必填，NO_PRIZE 必须为空） */
  @IsOptional()
  @IsString({ message: 'productId 必须为字符串' })
  productId?: string;

  /** 关联 SKU ID（DISCOUNT_BUY / THRESHOLD_GIFT 必填，NO_PRIZE 必须为空） */
  @IsOptional()
  @IsString({ message: 'skuId 必须为字符串' })
  skuId?: string;

  /** 奖品价格（DISCOUNT_BUY 时为特价，THRESHOLD_GIFT 时为 0） */
  @IsOptional()
  @IsNumber({}, { message: 'prizePrice 必须为数字' })
  @Min(0, { message: 'prizePrice 不能为负数' })
  prizePrice?: number;

  /** 奖品原价（管理员配置的展示划线价，如蜂蜜市场价） */
  @IsOptional()
  @IsNumber({}, { message: 'originalPrice 必须为数字' })
  @Min(0, { message: 'originalPrice 不能为负数' })
  originalPrice?: number;

  /** 消费门槛（仅 THRESHOLD_GIFT 类型） */
  @IsOptional()
  @IsNumber({}, { message: 'threshold 必须为数字' })
  @Min(0, { message: 'threshold 不能为负数' })
  threshold?: number;

  /** 奖品数量 */
  @IsOptional()
  @IsInt({ message: 'prizeQuantity 必须为整数' })
  @Min(1, { message: 'prizeQuantity 不能小于1' })
  prizeQuantity?: number;

  /** 每日最大中奖数 */
  @IsOptional()
  @IsInt({ message: 'dailyLimit 必须为整数' })
  @Min(0, { message: 'dailyLimit 不能为负数' })
  dailyLimit?: number;

  /** 总中奖数限制 */
  @IsOptional()
  @IsInt({ message: 'totalLimit 必须为整数' })
  @Min(0, { message: 'totalLimit 不能为负数' })
  totalLimit?: number;

  /** 排序（转盘展示顺序） */
  @IsOptional()
  @IsInt({ message: 'sortOrder 必须为整数' })
  sortOrder?: number;

  /** F3: 可配置过期时间（小时），null 表示不过期 */
  @IsOptional()
  @IsInt({ message: 'expirationHours 必须为整数' })
  @Min(1, { message: 'expirationHours 不能小于1小时' })
  expirationHours?: number;

  /** 是否启用 */
  @IsOptional()
  @IsBoolean({ message: 'isActive 必须为布尔值' })
  isActive?: boolean;
}

// ============================================================
// 更新奖品 DTO — 所有字段可选（手写 Partial，不依赖 @nestjs/mapped-types）
// ============================================================
export class UpdateLotteryPrizeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '奖品名称不能为空' })
  name?: string;

  @IsOptional()
  @IsEnum(LotteryPrizeType, {
    message: `奖品类型必须为 ${Object.values(LotteryPrizeType).join(' / ')}`,
  })
  type?: LotteryPrizeType;

  @IsOptional()
  @IsNumber({}, { message: '概率必须为数字' })
  @Min(0, { message: '概率不能小于0' })
  @Max(100, { message: '概率不能大于100' })
  probability?: number;

  @IsOptional()
  @IsString({ message: 'productId 必须为字符串' })
  productId?: string | null;

  @IsOptional()
  @IsString({ message: 'skuId 必须为字符串' })
  skuId?: string | null;

  @IsOptional()
  @IsNumber({}, { message: 'prizePrice 必须为数字' })
  @Min(0, { message: 'prizePrice 不能为负数' })
  prizePrice?: number;

  @IsOptional()
  @IsNumber({}, { message: 'originalPrice 必须为数字' })
  @Min(0, { message: 'originalPrice 不能为负数' })
  originalPrice?: number | null;

  @IsOptional()
  @IsNumber({}, { message: 'threshold 必须为数字' })
  @Min(0, { message: 'threshold 不能为负数' })
  threshold?: number;

  @IsOptional()
  @IsInt({ message: 'prizeQuantity 必须为整数' })
  @Min(1, { message: 'prizeQuantity 不能小于1' })
  prizeQuantity?: number;

  @IsOptional()
  @IsInt({ message: 'dailyLimit 必须为整数' })
  @Min(0, { message: 'dailyLimit 不能为负数' })
  dailyLimit?: number;

  @IsOptional()
  @IsInt({ message: 'totalLimit 必须为整数' })
  @Min(0, { message: 'totalLimit 不能为负数' })
  totalLimit?: number;

  @IsOptional()
  @IsInt({ message: 'sortOrder 必须为整数' })
  sortOrder?: number;

  /** F3: 可配置过期时间（小时），null 表示清除过期时间（不过期） */
  @IsOptional()
  @IsInt({ message: 'expirationHours 必须为整数' })
  @Min(1, { message: 'expirationHours 不能小于1小时' })
  expirationHours?: number | null;

  @IsOptional()
  @IsBoolean({ message: 'isActive 必须为布尔值' })
  isActive?: boolean;
}

// ============================================================
// 批量概率调整子项
// ============================================================
export class BatchProbabilityItemDto {
  @IsString()
  @IsNotEmpty({ message: '奖品 ID 不能为空' })
  id: string;

  @IsNumber({}, { message: '概率必须为数字' })
  @Min(0, { message: '概率不能为负数' })
  @Max(100, { message: '概率不能大于100' })
  probability: number;
}

// ============================================================
// 批量概率调整 DTO
// ============================================================
export class BatchUpdateProbabilitiesDto {
  @IsArray({ message: 'items 必须为数组' })
  @ValidateNested({ each: true })
  @Type(() => BatchProbabilityItemDto)
  items: BatchProbabilityItemDto[];
}
