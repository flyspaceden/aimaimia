import {
  IsInt,
  IsNumber,
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

  /**
   * 以下信号只用于微信 WebView → 系统浏览器的短时下载恢复。
   * 不单独作为身份凭证；后端仍要求同邀请码、同出口 IP、同屏幕上下文且唯一候选。
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  @Max(10)
  devicePixelRatio?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64)
  colorDepth?: number;

  @IsOptional()
  @IsInt()
  @Min(-1440)
  @Max(1440)
  timezoneOffset?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxTouchPoints?: number;
}
