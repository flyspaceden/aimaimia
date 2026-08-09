import { Type } from "class-transformer";
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

/**
 * 小程序团购结算只接受业务选择，不接受支付渠道、OpenID 或优惠字段。
 * 支付渠道固定为微信 JSAPI，付款人 OpenID 由当前 JWT 会话在服务端解析。
 */
export class MiniProgramGroupBuyCheckoutDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  activityId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  addressId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shareCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedTotal?: number;
}
