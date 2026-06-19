import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DeliveryUnitFieldType } from '../../../../generated/delivery-client';

export class UpdateUnitFieldConfigItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  fieldKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsEnum(DeliveryUnitFieldType)
  fieldType?: DeliveryUnitFieldType;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  placeholder?: string;

  @IsOptional()
  options?: unknown;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  showInApp?: boolean;

  @IsOptional()
  @IsBoolean()
  showInAdmin?: boolean;

  @IsOptional()
  @IsBoolean()
  includeInPdf?: boolean;

  @IsOptional()
  @IsBoolean()
  includeInExcel?: boolean;
}

export class UpdateUnitFieldConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateUnitFieldConfigItemDto)
  items: UpdateUnitFieldConfigItemDto[];
}
