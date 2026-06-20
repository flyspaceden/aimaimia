import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryManifestApiType } from '../delivery-manifest.definitions';

export class DeliveryManifestCustomizationEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string;

  @IsString()
  @MaxLength(40)
  label!: string;

  @IsString()
  @MaxLength(200)
  value!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}

export class UpsertDeliveryManifestCustomizationDto {
  @IsIn(['BUYER_FULL', 'SELLER_FULFILLMENT'])
  manifestType!: DeliveryManifestApiType;

  @IsString()
  @MaxLength(40)
  targetId!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DeliveryManifestCustomizationEntryDto)
  entries!: DeliveryManifestCustomizationEntryDto[];
}
