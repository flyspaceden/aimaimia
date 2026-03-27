import { IsString, IsInt, IsOptional, MaxLength, Min, Max, Matches } from 'class-validator';

export class CreateDeferredLinkDto {
  @IsString()
  @Matches(/^[A-Z0-9]{8}$/, { message: '推荐码格式无效' })
  referralCode: string;

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
