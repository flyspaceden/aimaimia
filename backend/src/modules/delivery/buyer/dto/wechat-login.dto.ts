import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @Length(1, 256)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;
}
