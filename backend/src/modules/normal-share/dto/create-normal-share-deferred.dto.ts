import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateNormalShareDeferredDto {
  @IsString()
  @MaxLength(32)
  code: string;

  @IsString()
  @MaxLength(1000)
  userAgent: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  screenWidth: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  screenHeight: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  language?: string;
}
