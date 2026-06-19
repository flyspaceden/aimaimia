import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { DeliveryUnitFieldType } from '../../../../generated/delivery-client';

@ValidatorConstraint({ name: 'deliveryUnitFieldOptionsShape', async: false })
class DeliveryUnitFieldOptionsShapeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    if (value === undefined) {
      return true;
    }

    const dto = args.object as UpdateUnitFieldConfigItemDto;
    if (dto.fieldType !== DeliveryUnitFieldType.SELECT) {
      return false;
    }
    if (!Array.isArray(value)) {
      return false;
    }

    return value.every((item) => {
      if (typeof item === 'string') {
        return item.trim().length > 0;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      const option = item as Record<string, unknown>;
      return (
        typeof option.label === 'string' &&
        option.label.trim().length > 0 &&
        typeof option.value === 'string' &&
        option.value.trim().length > 0
      );
    });
  }

  defaultMessage(args: ValidationArguments) {
    const dto = args.object as UpdateUnitFieldConfigItemDto;
    if (dto.fieldType !== DeliveryUnitFieldType.SELECT) {
      return '只有 SELECT 字段允许配置 options';
    }
    return 'SELECT 字段的 options 必须是非空字符串数组或包含 label/value 的对象数组';
  }
}

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
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  placeholder?: string;

  @IsOptional()
  @Validate(DeliveryUnitFieldOptionsShapeConstraint)
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
