import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { ProductVisualMode } from '@prisma/client';

export class GrantProductVisualTestAccessDto {
  @IsString()
  @MaxLength(120)
  companyId: string;

  @IsString()
  @MaxLength(120)
  staffId: string;

  @IsString()
  @MaxLength(120)
  productId: string;

  @IsEnum(ProductVisualMode)
  visualMode: ProductVisualMode;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  dailyCallLimit: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  weeklyCallLimit: number;

  @IsDateString()
  expiresAt: string;

  @IsBoolean()
  grantWelcomeCredits: boolean;
}
