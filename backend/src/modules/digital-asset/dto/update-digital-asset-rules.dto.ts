import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DigitalAssetModuleSettingDto } from './update-digital-asset-settings.dto';

export class DigitalAssetCreditTierDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minAmount!: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxAmount!: number | null;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  multiplier!: number;
}

export class UpdateDigitalAssetRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DigitalAssetCreditTierDto)
  tiers!: DigitalAssetCreditTierDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DigitalAssetModuleSettingDto)
  modules!: DigitalAssetModuleSettingDto[];
}
