import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InviteH5LandingDto {
  @IsString()
  @MaxLength(64)
  inviteCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  screenWidth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  screenHeight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  language?: string;
}
