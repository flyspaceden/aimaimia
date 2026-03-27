import { IsString, IsInt, IsOptional, MaxLength, Min, Max } from 'class-validator';

export class MatchDeferredLinkDto {
  @IsString()
  @MaxLength(500)
  userAgent: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  screenWidth: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  screenHeight: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;
}
