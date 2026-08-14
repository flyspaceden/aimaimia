import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PickupLocationDto {
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  poiName?: string;
}

export class PickupBusinessHoursDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  summary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  holidayNotice?: string;
}

export class CreatePickupPointDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) contactName!: string;
  @IsString() @Matches(/^1[3-9]\d{9}$/) contactPhone!: string;
  @IsString() @IsNotEmpty() @MaxLength(32) regionCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) regionText!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) detail!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PickupLocationDto)
  location?: PickupLocationDto;

  @ValidateNested()
  @Type(() => PickupBusinessHoursDto)
  businessHours!: PickupBusinessHoursDto;

  @IsOptional() @IsString() @MaxLength(500) pickupNotice?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePickupPointDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50) contactName?: string;
  @IsOptional() @IsString() @Matches(/^1[3-9]\d{9}$/) contactPhone?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(32) regionCode?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) regionText?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) detail?: string;
  @IsOptional() @ValidateNested() @Type(() => PickupLocationDto) location?: PickupLocationDto | null;
  @IsOptional() @ValidateNested() @Type(() => PickupBusinessHoursDto) businessHours?: PickupBusinessHoursDto;
  @IsOptional() @IsString() @MaxLength(500) pickupNotice?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
