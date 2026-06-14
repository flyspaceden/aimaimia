import { IsArray, IsBoolean, IsIn, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DigitalAssetModuleSettingDto {
  @IsIn(['assetValue', 'level', 'benefits', 'equity'])
  key!: 'assetValue' | 'level' | 'benefits' | 'equity';

  @IsString()
  @Length(1, 20)
  title!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Length(1, 80)
  description!: string;
}

export class UpdateDigitalAssetSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DigitalAssetModuleSettingDto)
  modules!: DigitalAssetModuleSettingDto[];
}
