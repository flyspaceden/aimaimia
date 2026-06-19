import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateDeliveryCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  servicePhone?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  defaultMarkupBps?: number;
}
