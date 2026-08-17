import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PickupPointCoverage, PickupPointKind } from '@prisma/client';

const parseBooleanQueryFlag = ({ value, obj, key }: {
  value: unknown;
  obj?: Record<string, unknown>;
  key: string;
}) => {
  const rawValue = obj?.[key] ?? value;
  if (rawValue === true || rawValue === 'true') return true;
  if (rawValue === false || rawValue === 'false') return false;
  return value;
};

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

export class AdminCreatePickupPointDto extends CreatePickupPointDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  companyId!: string;

  @IsOptional()
  @IsEnum(PickupPointKind)
  kind?: PickupPointKind;

  @IsOptional()
  @IsEnum(PickupPointCoverage)
  coverage?: PickupPointCoverage;

  @IsOptional()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  serviceCompanyIds?: string[];
}

export class AdminUpdatePickupPointDto extends UpdatePickupPointDto {
  @IsOptional()
  @IsEnum(PickupPointCoverage)
  coverage?: PickupPointCoverage;

  @IsOptional()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  serviceCompanyIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminPickupPointReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class AdminPickupPointQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  companyId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @Transform(parseBooleanQueryFlag)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(parseBooleanQueryFlag)
  @IsBoolean()
  isDeleted?: boolean;

  @IsOptional()
  @IsEnum(PickupPointKind)
  kind?: PickupPointKind;
}

export class AdminPickupCompanyOptionQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
