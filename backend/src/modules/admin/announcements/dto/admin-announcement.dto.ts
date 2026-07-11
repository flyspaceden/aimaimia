import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AnnouncementTargetDto {
  @IsOptional()
  @IsIn(['PRODUCT_DETAIL'])
  routeKey?: 'PRODUCT_DETAIL';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class AnnouncementTargetProductQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

export class AnnouncementAudienceDto {
  @IsIn(['ALL', 'VIP', 'NORMAL', 'BUYER_NOS'])
  type!: 'ALL' | 'VIP' | 'NORMAL' | 'BUYER_NOS';

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  buyerNos?: string[];
}

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsIn(['system', 'transaction', 'interaction'])
  category?: 'system' | 'transaction' | 'interaction';

  @IsOptional()
  @IsIn(['platform_announcement', 'platform_notice'])
  type?: 'platform_announcement' | 'platform_notice';

  @IsOptional()
  @IsIn(['NORMAL', 'IMPORTANT'])
  priority?: 'NORMAL' | 'IMPORTANT';

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementTargetDto)
  target?: AnnouncementTargetDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => AnnouncementAudienceDto)
  audience!: AnnouncementAudienceDto;
}

export class AnnouncementListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
