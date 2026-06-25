import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GroupBuyActivityStatus } from '@prisma/client';

export class GroupBuyTierConfigDto {
  @Type(() => Number)
  @IsInt({ message: '档位序号必须为整数' })
  @Min(1, { message: '档位序号必须从 1 开始' })
  sequence: number;

  @Type(() => Number)
  @IsInt({ message: '返还比例格式不正确' })
  @Min(1, { message: '返还比例必须大于 0' })
  basisPoints: number;

  @IsOptional()
  @IsString({ message: '档位说明必须为字符串' })
  @MaxLength(60, { message: '档位说明不能超过 60 个字符' })
  label?: string;
}

export class GroupBuyActivityItemInputDto {
  @IsString({ message: '商品 ID 必须为字符串' })
  @IsNotEmpty({ message: '商品 ID 不能为空' })
  productId: string;

  @IsString({ message: 'SKU ID 必须为字符串' })
  @IsNotEmpty({ message: 'SKU ID 不能为空' })
  skuId: string;

  @Type(() => Number)
  @IsInt({ message: '商品数量必须为整数' })
  @Min(1, { message: '商品数量必须大于 0' })
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder?: number;
}

export class CreateGroupBuyActivityDto {
  @IsString({ message: '活动标题必须为字符串' })
  @IsNotEmpty({ message: '活动标题不能为空' })
  @MaxLength(120, { message: '活动标题不能超过 120 个字符' })
  title: string;

  @IsOptional()
  @IsString({ message: '团购详情介绍必须为字符串' })
  @MaxLength(2000, { message: '团购详情介绍不能超过 2000 个字符' })
  description?: string | null;

  @IsOptional()
  @IsString({ message: '商品 ID 必须为字符串' })
  productId?: string;

  @IsOptional()
  @IsString({ message: 'SKU ID 必须为字符串' })
  skuId?: string;

  @IsOptional()
  @IsArray({ message: '团购商品组合必须为数组' })
  @ArrayMaxSize(50, { message: '团购商品组合不能超过 50 个' })
  @ValidateNested({ each: true })
  @Type(() => GroupBuyActivityItemInputDto)
  items?: GroupBuyActivityItemInputDto[];

  @Type(() => Number)
  @IsNumber({}, { message: '团购价格必须为数字' })
  @Min(0.01, { message: '团购价格必须大于 0' })
  price: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: '包邮配置必须为布尔值' })
  freeShipping?: boolean;

  @IsOptional()
  @IsEnum(GroupBuyActivityStatus, { message: '活动状态不合法' })
  status?: GroupBuyActivityStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: '开始时间格式不正确' })
  startAt?: Date;

  @Type(() => Date)
  @IsDate({ message: '结束时间格式不正确' })
  endAt?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  displayOrder?: number;

  @IsArray({ message: '返还档位必须为数组' })
  @ArrayMinSize(1, { message: '至少需要一个返还档位' })
  @ArrayMaxSize(20, { message: '返还档位不能超过 20 个' })
  @ValidateNested({ each: true })
  @Type(() => GroupBuyTierConfigDto)
  tiers: GroupBuyTierConfigDto[];
}

export class UpdateGroupBuyActivityDto {
  @IsOptional()
  @IsString({ message: '活动标题必须为字符串' })
  @MaxLength(120, { message: '活动标题不能超过 120 个字符' })
  title?: string;

  @IsOptional()
  @IsString({ message: '团购详情介绍必须为字符串' })
  @MaxLength(2000, { message: '团购详情介绍不能超过 2000 个字符' })
  description?: string | null;

  @IsOptional()
  @IsString({ message: '商品 ID 必须为字符串' })
  productId?: string;

  @IsOptional()
  @IsString({ message: 'SKU ID 必须为字符串' })
  skuId?: string;

  @IsOptional()
  @IsArray({ message: '团购商品组合必须为数组' })
  @ArrayMaxSize(50, { message: '团购商品组合不能超过 50 个' })
  @ValidateNested({ each: true })
  @Type(() => GroupBuyActivityItemInputDto)
  items?: GroupBuyActivityItemInputDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '团购价格必须为数字' })
  @Min(0.01, { message: '团购价格必须大于 0' })
  price?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: '包邮配置必须为布尔值' })
  freeShipping?: boolean;

  @IsOptional()
  @IsEnum(GroupBuyActivityStatus, { message: '活动状态不合法' })
  status?: GroupBuyActivityStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: '开始时间格式不正确' })
  startAt?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: '结束时间格式不正确' })
  endAt?: Date | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须为整数' })
  displayOrder?: number;

  @IsOptional()
  @IsArray({ message: '返还档位必须为数组' })
  @ArrayMinSize(1, { message: '至少需要一个返还档位' })
  @ArrayMaxSize(20, { message: '返还档位不能超过 20 个' })
  @ValidateNested({ each: true })
  @Type(() => GroupBuyTierConfigDto)
  tiers?: GroupBuyTierConfigDto[];
}

export class UpdateGroupBuyActivityStatusDto {
  @IsEnum(GroupBuyActivityStatus, { message: '活动状态不合法' })
  status: GroupBuyActivityStatus;
}

export class UpdateGroupBuySettingsDto {
  @Type(() => Number)
  @IsInt({ message: '每月发起次数必须为整数' })
  @Min(1, { message: '每月发起次数至少为 1 次' })
  @Max(100, { message: '每月发起次数不能超过 100 次' })
  maxMonthlyLaunches: number;
}
