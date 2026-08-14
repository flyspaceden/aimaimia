import { Type } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum FulfillmentModeInput {
  DELIVERY = 'DELIVERY',
  PICKUP = 'PICKUP',
}

export class PickupSelectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  companyId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  pickupPointId!: string;
}

export class FulfillmentInputDto {
  @IsEnum(FulfillmentModeInput)
  mode!: FulfillmentModeInput;

  @ValidateIf((value) => value.mode === FulfillmentModeInput.DELIVERY)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  addressId?: string;

  @ValidateIf((value) => value.mode === FulfillmentModeInput.PICKUP)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  recipientName?: string;

  @ValidateIf((value) => value.mode === FulfillmentModeInput.PICKUP)
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的自提人手机号' })
  recipientPhone?: string;

  @ValidateIf((value) => value.mode === FulfillmentModeInput.PICKUP)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PickupSelectionDto)
  selections?: PickupSelectionDto[];
}

export type ResolvedFulfillmentInput =
  | { mode: 'DELIVERY'; addressId: string }
  | {
      mode: 'PICKUP';
      recipientName: string;
      recipientPhone: string;
      selections: PickupSelectionDto[];
    };

export function resolveFulfillmentInput(
  fulfillment?: FulfillmentInputDto,
  legacyAddressId?: string,
): ResolvedFulfillmentInput {
  if (!fulfillment) {
    if (!legacyAddressId?.trim()) {
      throw new BadRequestException('配送订单缺少收货地址');
    }
    return { mode: 'DELIVERY', addressId: legacyAddressId.trim() };
  }
  if (fulfillment.mode === FulfillmentModeInput.DELIVERY) {
    const addressId = fulfillment.addressId?.trim() || legacyAddressId?.trim();
    if (!addressId) throw new BadRequestException('配送订单缺少收货地址');
    return { mode: 'DELIVERY', addressId };
  }
  return {
    mode: 'PICKUP',
    recipientName: fulfillment.recipientName!.trim(),
    recipientPhone: fulfillment.recipientPhone!.trim(),
    selections: fulfillment.selections ?? [],
  };
}
