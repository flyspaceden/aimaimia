import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RegenerateDeliveryManifestColumnDto {
  @IsString()
  key!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}

export class RegenerateDeliveryManifestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegenerateDeliveryManifestColumnDto)
  columns?: RegenerateDeliveryManifestColumnDto[];
}
