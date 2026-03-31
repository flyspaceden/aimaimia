import {
  IsEnum,
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
  IsUrl,
  Matches,
} from 'class-validator';
import { ReplacementReasonType } from '@prisma/client';

/**
 * 售后 DTO — 已迁移为统一售后流程（AfterSaleRequest）
 *
 * 必须上传问题照片，不再有退款金额字段。
 */
export class AfterSaleDto {
  @IsEnum(ReplacementReasonType, { message: 'reasonType 必须为有效的换货原因类型' })
  reasonType: ReplacementReasonType;

  @IsOptional()
  @IsString({ message: 'reason 必须为字符串' })
  @MaxLength(500, { message: 'reason 不能超过 500 个字符' })
  reason?: string;

  @IsArray({ message: 'photos 必须为数组' })
  @ArrayMinSize(1, { message: '请至少上传一张问题照片' })
  @ArrayMaxSize(10, { message: '最多上传 10 张照片' })
  @IsUrl({ protocols: ['http', 'https'], require_tld: false }, { each: true, message: 'photos 必须为有效 URL' })
  photos: string[];

  /** 具体商品项（null = 整单换货） */
  @IsOptional()
  @IsString({ message: 'orderItemId 必须为字符串' })
  @Matches(/^c[a-z0-9]{24}$/i, { message: 'orderItemId 必须为有效的 CUID' })
  orderItemId?: string;
}
