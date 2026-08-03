import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class UpdateDeliveryConfigItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  key: string;

  @IsDefined()
  value: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(['SYSTEM', 'CUSTOMER_SERVICE', 'MANIFEST', 'UNIT'])
  scope?: 'SYSTEM' | 'CUSTOMER_SERVICE' | 'MANIFEST' | 'UNIT';
}

export class UpdateDeliveryConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => UpdateDeliveryConfigItemDto)
  items: UpdateDeliveryConfigItemDto[];
}

export { UpdateDeliveryConfigItemDto };
