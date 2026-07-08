import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CaptainProfileStatus } from '@prisma/client';

export class CaptainPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;
}

export class ListCaptainProfilesQueryDto extends CaptainPaginationQueryDto {
  @IsOptional()
  @IsEnum(CaptainProfileStatus)
  status?: CaptainProfileStatus;

  @IsOptional()
  @IsString()
  month?: string;
}

export class CreateCaptainProfileDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  captainCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string | null;
}

export class UpdateCaptainProfileStatusDto {
  @IsEnum(CaptainProfileStatus)
  status: CaptainProfileStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string | null;
}

export class ListCaptainOrdersQueryDto extends CaptainPaginationQueryDto {
  @IsOptional()
  @IsString()
  captainUserId?: string;

  @IsOptional()
  @IsString()
  buyerUserId?: string;

  @IsOptional()
  @IsString()
  month?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ListCaptainLedgersQueryDto extends CaptainPaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  settlementId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ListCaptainSettlementsQueryDto extends CaptainPaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  month?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateCaptainSettingsDto {
  @IsObject()
  value: Record<string, any>;
}
