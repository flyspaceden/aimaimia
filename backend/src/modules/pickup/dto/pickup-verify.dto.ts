import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyPickupDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: '取货码必须为 8 位数字' })
  @MaxLength(16)
  pickupCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  qrPayload?: string;
}
