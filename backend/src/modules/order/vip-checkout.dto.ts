import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/** VIP 礼包结算请求 */
export class VipCheckoutDto {
  /** 选中的 VIP 档位 ID */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  packageId: string;

  /** 选中的 VIP 赠品方案 ID */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  giftOptionId: string;

  /** 收货地址 ID */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  addressId: string;

  /** 支付渠道: wechat / alipay / bankcard */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentChannel?: string;

  /** 幂等键 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  /** 前端展示的总金额，后端校验一致性 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedTotal?: number;
}
