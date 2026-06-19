import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeliveryUnitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  contactName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  contactPhone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  provinceCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  provinceName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  cityCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  cityName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  districtCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  districtName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  detailAddress: string;

  @IsOptional()
  @IsObject()
  extraFields?: Record<string, unknown>;
}
