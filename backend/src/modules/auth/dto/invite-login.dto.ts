import { IsMobilePhone, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class InviteLoginDto {
  @IsMobilePhone('zh-CN')
  phone: string;

  @IsString()
  @Length(4, 8)
  code: string;

  @IsString()
  @MaxLength(64)
  inviteCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  landingSessionId?: string;
}
