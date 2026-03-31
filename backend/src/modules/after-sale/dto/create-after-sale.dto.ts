import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AfterSaleType, ReplacementReasonType } from '@prisma/client';

export class CreateAfterSaleDto {
  /** 指定退货/换货的商品项 ID */
  @IsNotEmpty({ message: 'orderItemId 不能为空' })
  @IsString({ message: 'orderItemId 必须为字符串' })
  orderItemId: string;

  /** 售后类型 */
  @IsEnum(AfterSaleType, { message: 'afterSaleType 必须为有效的售后类型' })
  afterSaleType: AfterSaleType;

  /**
   * 标准化理由类型
   * 质量问题退货/换货时必填，无理由退货时可选
   */
  @ValidateIf((o) =>
    o.afterSaleType === AfterSaleType.QUALITY_RETURN ||
    o.afterSaleType === AfterSaleType.QUALITY_EXCHANGE,
  )
  @IsNotEmpty({ message: '质量问题售后必须选择理由类型' })
  @IsEnum(ReplacementReasonType, { message: 'reasonType 必须为有效的理由类型' })
  reasonType?: ReplacementReasonType;

  /** 补充说明（OTHER 类型时的自由文本） */
  @IsOptional()
  @IsString({ message: 'reason 必须为字符串' })
  @MaxLength(500, { message: 'reason 不能超过 500 个字符' })
  reason?: string;

  /** 问题照片 URL 列表 */
  @IsArray({ message: 'photos 必须为数组' })
  @ArrayMinSize(1, { message: '请至少上传 1 张照片' })
  @ArrayMaxSize(10, { message: '最多上传 10 张照片' })
  @IsUrl(
    { protocols: ['http', 'https'], require_tld: false },
    { each: true, message: 'photos 必须为有效 URL' },
  )
  photos: string[];
}
