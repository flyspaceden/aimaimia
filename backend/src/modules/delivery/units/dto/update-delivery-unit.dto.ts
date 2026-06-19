import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDeliveryUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  provinceCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provinceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cityCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cityName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  districtCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  districtName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detailAddress?: string;

  @IsOptional()
  @IsObject()
  extraFields?: Record<string, unknown>;
}
